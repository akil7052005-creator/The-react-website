import { Injectable, Logger } from '@nestjs/common'
import nodemailer, { type Transporter } from 'nodemailer'
import { config } from '../config'

export interface MailMessage {
  to: string
  subject: string
  text: string
}

/**
 * Sends email through SMTP when SMTP_HOST is set; otherwise logs the message
 * (development: password-reset links show up in the API console).
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
    const transporter = this.getTransporter()
    if (!transporter) {
      if (config().NODE_ENV !== 'test') {
        this.logger.log(`\n--- Email (console mode) ---\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n----------------------------`)
      }
      return
    }
    try {
      await transporter.sendMail({ from: config().SMTP_FROM, ...msg })
    } catch (e) {
      // Never leak mail failures to the caller (e.g. forgot-password must not reveal anything).
      this.logger.error(`Failed to send email to ${msg.to}: ${(e as Error).message}`)
    }
  }
}
