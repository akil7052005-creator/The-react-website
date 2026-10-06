import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { todayIST } from '@weddyzone/shared'
import { toDate } from '../common/util'
import { config } from '../config'
import { PlatformWhatsAppService } from '../infra/platform-whatsapp.service'
import { PrismaService } from '../prisma/prisma.service'
import { writeLog } from './selection-log'
import { SelectionsService } from './selections.service'

const DAY = 86_400_000
const HOUR = 3_600_000
/** Automatic reminders: the first after 3 quiet days, the second after 7. Never more. */
export const AUTO_REMINDER_DAYS = [3, 7] as const
/** A reminder the studio sent by hand in this window holds the automatic one back. */
const MANUAL_GRACE_MS = 2 * DAY

export interface ReminderReport {
  skipped?: 'whatsapp-not-configured'
  checked: number
  sent: number
  failed: number
  noCredits: number
}

/**
 * Reminds clients who went quiet on a shared selection: 3 and then 7 days after their last visit (or
 * the share, if they never opened it). Uses the studio's normal reminder (same template, 1 credit,
 * in the message log and the selection's change log). Only runs when the WhatsApp Cloud API is set
 * up, because only then does the message actually reach the client; otherwise it does nothing.
 */
@Injectable()
export class SelectionRemindersService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('SelectionReminders')
  private timers: NodeJS.Timeout[] = []
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly selections: SelectionsService,
    private readonly whatsapp: PlatformWhatsAppService,
  ) {}

  onApplicationBootstrap() {
    const c = config()
    if (!c.JOBS_ENABLED || c.NODE_ENV === 'test') return
    const first = setTimeout(() => void this.tick(), 2 * 60_000)
    const every = setInterval(() => void this.tick(), HOUR)
    first.unref()
    every.unref()
    this.timers.push(first, every)
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t))
  }

  private async tick() {
    if (this.running) return
    this.running = true
    try {
      const r = await this.run()
      if (r.sent || r.failed) this.logger.log(`Auto reminders: ${r.sent} sent, ${r.failed} failed, ${r.noCredits} without credits`)
    } catch (e) {
      this.logger.error(`Auto reminders failed: ${(e as Error).stack ?? e}`)
    } finally {
      this.running = false
    }
  }

  /** One pass. `now` is injectable for tests. */
  async run(now = new Date()): Promise<ReminderReport> {
    const report: ReminderReport = { checked: 0, sent: 0, failed: 0, noCredits: 0 }
    if (!this.whatsapp.isConfigured()) return { ...report, skipped: 'whatsapp-not-configured' }
    const today = toDate(todayIST(now))
    const rows = await this.prisma.selection.findMany({
      where: {
        deletedAt: null,
        status: { in: ['SENT', 'IN_PROGRESS'] },
        deadline: { gte: today },
        autoReminders: { lt: AUTO_REMINDER_DAYS.length },
        sharedAt: { not: null },
      },
      select: { id: true, studioId: true, autoReminders: true, sharedAt: true, lastClientVisitAt: true, lastRemindedAt: true },
    })
    const template = await this.prisma.whatsAppTemplate.findUnique({ where: { key: 'SELECTION_REMINDER' } })
    const cost = template?.creditCost ?? 1
    for (const s of rows) {
      report.checked++
      const lastActivity = Math.max(s.sharedAt!.getTime(), s.lastClientVisitAt?.getTime() ?? 0)
      const quietDays = (now.getTime() - lastActivity) / DAY
      if (quietDays < AUTO_REMINDER_DAYS[s.autoReminders]) continue
      if (s.lastRemindedAt && now.getTime() - s.lastRemindedAt.getTime() < MANUAL_GRACE_MS) continue
      const which = `${AUTO_REMINDER_DAYS[s.autoReminders]}-day reminder`
      const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: s.studioId }, select: { creditBalance: true, name: true } })
      if (studio.creditBalance < cost) {
        report.noCredits++
        await this.prisma.selection.update({ where: { id: s.id }, data: { autoReminders: { increment: 1 } } })
        await writeLog(this.prisma, s.id, 'SYSTEM', 'Automatic reminder skipped', `${which}: not enough WhatsApp credits`)
        continue
      }
      try {
        const m = await this.selections.reminderMessage(s.studioId, s.id)
        // Deliver first, charge after: a failed delivery costs nothing.
        await this.whatsapp.sendTemplate(m.toPhone, 'selection_reminder', [
          m.toName,
          studio.name,
          String(m.vars.picked),
          String(m.vars.quota),
          String(m.vars.eventTitle),
          String(m.vars.deadline),
          String(m.vars.link),
        ])
        await this.selections.send(s.studioId, s.id, 'reminder', { actor: 'SYSTEM', detail: `Automatic ${which}` })
        report.sent++
      } catch (e) {
        report.failed++
        await writeLog(this.prisma, s.id, 'SYSTEM', 'Automatic reminder failed', `${which}: ${(e as Error).message}`.slice(0, 300))
      }
      await this.prisma.selection.update({ where: { id: s.id }, data: { autoReminders: { increment: 1 } } })
    }
    return report
  }
}
