import { Injectable } from '@nestjs/common'
import type { WhatsAppMessage } from '@prisma/client'
import {
  MESSAGE_TYPE_LABELS,
  type MessagePreviewDto,
  type MessageTemplateKey,
  type SendResultDto,
  type WhatsAppMessageDto,
} from '@weddyzone/shared'
import { notFound } from '../common/errors'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from './ledger.service'

export interface OutgoingMessage {
  templateKey: MessageTemplateKey
  toName: string
  toPhone: string
  vars: Record<string, string | number>
  ref?: { type: string; id: string }
}

/**
 * WhatsApp stand-in. Builds the message from a template and returns a
 * https://wa.me/<phone>?text=<message> link that opens WhatsApp on the
 * studio's own device. Credits are deducted and the message is logged as SENT,
 * so balances and the message log behave exactly as they will with the real
 * WhatsApp Business API (a drop-in replacement of `deliver`).
 */
export abstract class MessagingService {
  abstract preview(studioId: string, msg: OutgoingMessage): Promise<MessagePreviewDto>
  abstract send(studioId: string, msg: OutgoingMessage): Promise<SendResultDto>
}

export function render(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => (vars[key] !== undefined ? String(vars[key]) : ''))
}

export function waLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

export function messageDto(m: WhatsAppMessage): WhatsAppMessageDto {
  const key = m.templateKey as MessageTemplateKey
  return {
    id: m.id,
    toName: m.toName,
    toPhone: m.toPhone,
    templateKey: key,
    typeLabel: MESSAGE_TYPE_LABELS[key] ?? m.templateKey,
    body: m.body,
    credits: m.credits,
    status: m.status,
    link: m.link,
    createdAt: m.createdAt.toISOString(),
  }
}

@Injectable()
export class WaMeMessagingService extends MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {
    super()
  }

  private async template(key: MessageTemplateKey) {
    const t = await this.prisma.whatsAppTemplate.findUnique({ where: { key } })
    if (!t) throw notFound('Message template')
    return t
  }

  async preview(studioId: string, msg: OutgoingMessage): Promise<MessagePreviewDto> {
    const [t, studio] = await Promise.all([
      this.template(msg.templateKey),
      this.prisma.studio.findUniqueOrThrow({ where: { id: studioId } }),
    ])
    const body = render(t.body, { studioName: studio.name, clientName: msg.toName, ...msg.vars })
    return {
      studioName: studio.name,
      toName: msg.toName,
      eventTitle: String(msg.vars.eventTitle ?? msg.vars.albumTitle ?? ''),
      body,
      link: String(msg.vars.link ?? ''),
      creditCost: t.creditCost,
    }
  }

  async send(studioId: string, msg: OutgoingMessage): Promise<SendResultDto> {
    const t = await this.template(msg.templateKey)
    return this.prisma.$transaction(async (tx) => {
      const studio = await tx.studio.findUniqueOrThrow({ where: { id: studioId } })
      const body = render(t.body, { studioName: studio.name, clientName: msg.toName, ...msg.vars })
      const link = waLink(msg.toPhone, body)
      const message = await tx.whatsAppMessage.create({
        data: {
          studioId,
          templateKey: msg.templateKey,
          toName: msg.toName,
          toPhone: msg.toPhone,
          body,
          link,
          credits: t.creditCost,
          status: 'SENT',
          refType: msg.ref?.type,
          refId: msg.ref?.id,
        },
      })
      // Throws INSUFFICIENT_CREDITS (and rolls back the message) when the balance is too low.
      const creditBalance = await this.ledger.applyCredits(tx, studioId, -t.creditCost, 'MESSAGE', { type: 'message', id: message.id })
      return { message: messageDto(message), waLink: link, creditBalance }
    })
  }
}
