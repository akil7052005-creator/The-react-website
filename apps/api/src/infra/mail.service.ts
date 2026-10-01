import { Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import nodemailer, { type Transporter } from 'nodemailer'
import { emailFailed } from '../common/errors'
import { config } from '../config'

export interface MailMessage {
  to: string
  subject: string
  text: string
}

const RESEND_URL = 'https://api.resend.com/emails'

/**
 * Sends email through Resend when RESEND_API_KEY is set, otherwise through SMTP when SMTP_HOST is
 * set, otherwise logs the message (development: password-reset links show up in the API console).
 * A delivery failure throws `emailFailed()` (503) so the user is told instead of waiting for an
 * email that will never arrive.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail')
  private transporter: Transporter | null = null
  /** Last message sent — used by tests to read reset links. */
  lastMessage: MailMessage | null = null

  private getTransporter(): Transporter | null {
    const c = config()
    if (!c.SMTP_HOST) return null
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: c.SMTP_HOST,
        port: c.SMTP_PORT,
        secure: c.SMTP_PORT === 465,
        auth: c.SMTP_USER ? { user: c.SMTP_USER, pass: c.SMTP_PASS } : undefined,
      })
    }
    return this.transporter
  }

  async send(msg: MailMessage): Promise<void> {
    this.lastMessage = msg
    const c = config()
    const from = c.MAIL_FROM ?? c.SMTP_FROM
    try {
      if (c.RESEND_API_KEY) return await this.sendWithResend(c.RESEND_API_KEY, from, msg)
      const transporter = this.getTransporter()
      if (transporter) {
        await transporter.sendMail({ from, ...msg })
        return
      }
    } catch (e) {
      // The provider's reason goes to the log only; the user gets a plain "try again" message.
      this.logger.error(`Failed to send email "${msg.subject}" to ${msg.to}: ${(e as Error).message}`)
      throw emailFailed()
    }
    this.logToConsole(msg)
  }

  private async sendWithResend(apiKey: string, from: string, msg: MailMessage) {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string; name?: string } | null
      throw new Error(`Resend responded ${res.status}${body?.name ? ` ${body.name}` : ''}: ${body?.message ?? res.statusText}`)
    }
  }

  private logToConsole(msg: MailMessage) {
    if (config().NODE_ENV !== 'test') {
      this.logger.log(`\n--- Email (console mode) ---\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n----------------------------`)
    }
    const outbox = config().MAIL_OUTBOX_DIR
    if (outbox) {
      mkdirSync(outbox, { recursive: true })
      writeFileSync(join(outbox, `${Date.now()}-${randomUUID()}.json`), JSON.stringify({ ...msg, sentAt: new Date().toISOString() }))
    }
  }
}
