import { Injectable, Logger } from '@nestjs/common'
import { config } from '../config'
import { render, waLink } from '../core/messaging.service'
import { PrismaService } from '../prisma/prisma.service'

/**
 * Wedmanage's own WhatsApp messages to studios (plan reminders, expiry, failed payments).
 * They use the same template table as studio messages but are sent from the platform's number:
 * no studio credits are spent and nothing is written to the studio's message log.
 */
export const PLATFORM_TEMPLATE_KEYS = [
  'PLAN_EXPIRY_REMINDER',
  'PLAN_EXPIRED_GRACE',
  'PLAN_READ_ONLY',
  'PLAN_PAYMENT_FAILED',
  'PLAN_RENEWED',
  'PLAN_PURCHASED',
  'PLAN_WINBACK',
] as const
export type PlatformTemplateKey = (typeof PLATFORM_TEMPLATE_KEYS)[number]

/**
 * Order of the template's {{variables}} — WhatsApp Cloud API templates take positional
 * parameters, so the approved template in Meta's dashboard must use them in this order.
 */
export const PLATFORM_TEMPLATE_PARAMS: Record<PlatformTemplateKey, string[]> = {
  PLAN_EXPIRY_REMINDER: ['studioName', 'planName', 'date', 'link'],
  PLAN_EXPIRED_GRACE: ['studioName', 'planName', 'date', 'graceDays', 'link'],
  PLAN_READ_ONLY: ['studioName', 'planName', 'link'],
  PLAN_PAYMENT_FAILED: ['studioName', 'planName', 'link'],
  PLAN_RENEWED: ['studioName', 'planName', 'date'],
  PLAN_PURCHASED: ['studioName', 'planName', 'date', 'invoiceNumber'],
  PLAN_WINBACK: ['studioName', 'percent', 'code', 'date', 'link'],
}

export interface PlatformWhatsApp {
  template: PlatformTemplateKey
  vars: Record<string, string>
}

export interface PlatformSendResult {
  body: string
  link: string
  /** False when no WhatsApp Cloud API is configured: the message is recorded but not delivered. */
  delivered: boolean
}

const GRAPH_URL = 'https://graph.facebook.com/v21.0'

@Injectable()
export class PlatformWhatsAppService {
  private readonly logger = new Logger('PlatformWhatsApp')

  constructor(private readonly prisma: PrismaService) {}

  /** True when the WhatsApp Cloud API is set up. Without it no WhatsApp alert is attempted. */
  isConfigured(): boolean {
    const c = config()
    return Boolean(c.WHATSAPP_CLOUD_TOKEN && c.WHATSAPP_PHONE_NUMBER_ID)
  }

  async renderMessage(msg: PlatformWhatsApp): Promise<string> {
    const t = await this.prisma.whatsAppTemplate.findUnique({ where: { key: msg.template } })
    return t ? render(t.body, msg.vars) : Object.values(msg.vars).join(' · ')
  }

  /**
   * Sends any approved template with positional body parameters (e.g. a studio's selection reminder).
   * Throws when the Cloud API isn't set up or refuses the message.
   */
  async sendTemplate(toPhone: string, name: string, params: string[]): Promise<void> {
    const c = config()
    if (!this.isConfigured()) throw new Error('WhatsApp Cloud API is not configured')
    const digits = toPhone.replace(/\D/g, '')
    const res = await fetch(`${GRAPH_URL}/${c.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.WHATSAPP_CLOUD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: digits.length === 10 ? `91${digits}` : digits,
        type: 'template',
        template: { name, language: { code: c.WHATSAPP_TEMPLATE_LANG }, components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] },
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      throw new Error(`WhatsApp Cloud API responded ${res.status}: ${err?.error?.message ?? res.statusText}`)
    }
  }

  /** Sends through the WhatsApp Cloud API; throws (with the reason) when it can't. */
  async send(toPhone: string, msg: PlatformWhatsApp): Promise<PlatformSendResult> {
    const body = await this.renderMessage(msg)
    const link = waLink(toPhone, body)
    const c = config()
    if (!this.isConfigured()) return { body, link, delivered: false }
    const digits = toPhone.replace(/\D/g, '')
    const to = digits.length === 10 ? `91${digits}` : digits
    const res = await fetch(`${GRAPH_URL}/${c.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.WHATSAPP_CLOUD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: msg.template.toLowerCase(),
          language: { code: c.WHATSAPP_TEMPLATE_LANG },
          components: [
            {
              type: 'body',
              parameters: PLATFORM_TEMPLATE_PARAMS[msg.template].map((k) => ({ type: 'text', text: msg.vars[k] ?? '' })),
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      const reason = `WhatsApp Cloud API responded ${res.status}: ${err?.error?.message ?? res.statusText}`
      this.logger.error(reason)
      throw new Error(reason)
    }
    return { body, link, delivered: true }
  }
}
