import { Injectable, Logger } from '@nestjs/common'
import type { Notification, NotificationChannel } from '@prisma/client'
import type { NotificationType } from '@weddyzone/shared'
import { config } from '../config'
import { MailService } from '../infra/mail.service'
import { PlatformWhatsAppService, type PlatformWhatsApp } from '../infra/platform-whatsapp.service'
import { PrismaService, type Tx } from '../prisma/prisma.service'

export interface AlertSpec {
  to: { type: 'ADMIN' } | { type: 'STUDIO'; studioId: string }
  channels: NotificationChannel[]
  /**
   * Makes the alert exactly-once: each recipient/channel row gets `${dedupe}:${recipient}:${channel}`
   * as a unique key, so a re-run of the job (or a retried webhook) inserts nothing and sends nothing.
   * Leave out for alerts an admin sends on purpose ("Send reminder now").
   */
  dedupe?: string
  type: NotificationType
  title: string
  message: string
  link?: string
  icon?: string
  subscriptionId?: string
  /** Email subject and body; defaults to the title and message. */
  email?: { subject: string; text: string }
  whatsapp?: PlatformWhatsApp
}

/** Rows that still need sending after the transaction that created them commits. */
export interface QueuedAlert {
  row: Notification
  spec: AlertSpec
}

/** Shown for a WhatsApp alert that was not attempted because no provider is configured. */
export const WHATSAPP_SKIPPED = 'Skipped – not configured'

/**
 * Sends platform alerts to studios and admins, in-app, by email and on WhatsApp. Every alert is
 * first written as a Notification row (one per channel) — that row is both the claim that makes
 * it exactly-once and the record of what was sent, shown on the admin subscription page.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger('Alerts')

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly whatsapp: PlatformWhatsAppService,
  ) {}

  /**
   * Writes the alert's rows. Call inside the transaction that caused it, then `dispatch` the
   * result after commit, so an email never goes out for a change that was rolled back.
   * Returns only rows that were newly inserted: an already-sent dedupe key yields nothing.
   */
  async queue(spec: AlertSpec, db: Tx | PrismaService = this.prisma): Promise<QueuedAlert[]> {
    const recipient = spec.to.type
    const now = new Date()
    // No WhatsApp provider: don't attempt (or record) WhatsApp alerts at all. Once one is configured,
    // the next job run sends the WhatsApp alert for the stage that is due then.
    const channels = spec.channels.filter((c) => c !== 'WHATSAPP' || this.whatsapp.isConfigured())
    if (!channels.length) return []
    const rows = await db.notification.createManyAndReturn({
      data: channels.map((channel) => ({
        recipientType: recipient,
        studioId: spec.to.type === 'STUDIO' ? spec.to.studioId : null,
        channel,
        type: spec.type,
        title: spec.title,
        body: spec.message,
        link: spec.link,
        icon: spec.icon ?? 'bell',
        subscriptionId: spec.subscriptionId,
        dedupeKey: spec.dedupe ? `${spec.dedupe}:${recipient}:${channel}` : null,
        // In-app alerts are delivered the moment they exist.
        sentAt: channel === 'IN_APP' ? now : null,
      })),
      skipDuplicates: true,
    })
    return rows.map((row) => ({ row, spec }))
  }

  /** Delivers queued email and WhatsApp rows and records the outcome on each row. Never throws. */
  async dispatch(queued: QueuedAlert[]): Promise<void> {
    for (const { row, spec } of queued) {
      if (row.channel === 'IN_APP') continue
      try {
        if (row.channel === 'EMAIL') await this.sendEmail(spec)
        else await this.sendWhatsApp(row, spec)
        await this.prisma.notification.update({ where: { id: row.id }, data: { sentAt: new Date(), error: null } })
      } catch (e) {
        const error = (e as Error).message.slice(0, 500)
        this.logger.warn(`Alert ${row.type} (${row.channel}) to ${row.recipientType} not delivered: ${error}`)
        await this.prisma.notification.update({ where: { id: row.id }, data: { error } }).catch(() => undefined)
      }
    }
  }

  /** queue + dispatch, for alerts not tied to a transaction. */
  async send(spec: AlertSpec): Promise<QueuedAlert[]> {
    const queued = await this.queue(spec)
    await this.dispatch(queued)
    return queued
  }

  whatsappConfigured(): boolean {
    return this.whatsapp.isConfigured()
  }

  /** Every platform admin's email, plus ADMIN_ALERT_EMAILS. */
  async adminEmails(): Promise<string[]> {
    const admins = await this.prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { email: true } })
    const extra = config()
      .ADMIN_ALERT_EMAILS.split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
    return [...new Set([...admins.map((a) => a.email.toLowerCase()), ...extra])]
  }

  private async studioContact(studioId: string) {
    const studio = await this.prisma.studio.findUniqueOrThrow({
      where: { id: studioId },
      include: { users: { where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' }, take: 1 } },
    })
    const owner = studio.users[0]
    return { email: owner?.email ?? studio.email, phone: studio.phone ?? owner?.phone ?? null }
  }

  private async sendEmail(spec: AlertSpec) {
    const subject = spec.email?.subject ?? spec.title
    const link = spec.link ? `\n\n${spec.link.startsWith('http') ? spec.link : `${config().APP_URL}${spec.link}`}` : ''
    const text = spec.email?.text ?? `${spec.message}${link}`
    const recipients = spec.to.type === 'ADMIN' ? await this.adminEmails() : [(await this.studioContact(spec.to.studioId)).email]
    const to = recipients.filter((e): e is string => !!e)
    if (!to.length) throw new Error('No email address on file')
    for (const address of to) await this.mail.send({ to: address, subject, text })
  }

  private async sendWhatsApp(row: Notification, spec: AlertSpec) {
    if (spec.to.type !== 'STUDIO' || !spec.whatsapp) throw new Error('WhatsApp alerts go to studios only')
    const { phone } = await this.studioContact(spec.to.studioId)
    if (!phone) throw new Error('No phone number on file')
    const result = await this.whatsapp.send(phone, spec.whatsapp)
    // Keep the exact text (and the wa.me link) that was or would have been sent.
    await this.prisma.notification.update({ where: { id: row.id }, data: { body: result.body, link: result.link } })
    if (!result.delivered) throw new Error('Not delivered: WhatsApp Cloud API is not configured (set WHATSAPP_CLOUD_TOKEN)')
  }
}
