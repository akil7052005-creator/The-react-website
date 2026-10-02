import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Prisma } from '@prisma/client'
import {
  amountInWords,
  autoRenewSchema,
  buyCreditsSchema,
  cancelSubscriptionSchema,
  changePlanSchema,
  CREDIT_PACKS,
  listQuerySchema,
  makeInvoiceSchema,
  MESSAGE_TEMPLATE_KEYS,
  PAYMENT_METHODS,
  recordPaymentSchema,
  type ListQuery,
  type PlatformInvoiceDto,
} from '@weddyzone/shared'
import { z } from 'zod'
import { StudioId } from '../auth/auth.decorators'
import { notFound } from '../common/errors'
import { paginate, skipTake, startOfMonthUtc } from '../common/util'
import { config } from '../config'
import { ApiListQuery, ApiZodBody, zod } from '../common/zod'
import { messageDto } from '../core/messaging.service'
import { PlansService } from '../core/plans.service'
import { PrismaService } from '../prisma/prisma.service'
import { InvoicesService } from './invoices.service'
import { SubscriptionsService } from './subscriptions.service'

@ApiTags('plans')
@Controller()
export class PlansController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly subs: SubscriptionsService,
  ) {}

  @Get('plans')
  async list() {
    return (await this.plans.list()).map((p) => this.plans.toDto(p))
  }

  @Get('subscription')
  overview(@StudioId() studioId: string) {
    return this.subs.overview(studioId)
  }

  @Get('subscription/payments')
  @ApiListQuery()
  payments(@StudioId() studioId: string, @Query(zod(listQuerySchema)) q: ListQuery) {
    return this.subs.paymentHistory(studioId, q)
  }

  @Post('subscription/change')
  @HttpCode(200)
  @ApiZodBody(changePlanSchema)
  change(@StudioId() studioId: string, @Body(zod(changePlanSchema)) body: z.output<typeof changePlanSchema>) {
    return this.subs.changePlan(studioId, body.planCode, body.cycle, body.couponCode)
  }

  /** Cancel at the end of the period; the studio tells us why (shown to admins). */
  @Post('subscription/cancel')
  @HttpCode(200)
  @ApiZodBody(cancelSubscriptionSchema)
  cancel(@StudioId() studioId: string, @Body(zod(cancelSubscriptionSchema)) body: z.output<typeof cancelSubscriptionSchema>) {
    return this.subs.cancel(studioId, body.reason, body.details)
  }

  @Post('subscription/auto-renew')
  @HttpCode(200)
  @ApiZodBody(autoRenewSchema)
  autoRenew(@StudioId() studioId: string, @Body(zod(autoRenewSchema)) body: z.output<typeof autoRenewSchema>) {
    return this.subs.setAutoRenew(studioId, body.autoRenew)
  }

  @Get('me/subscription')
  banner(@StudioId() studioId: string) {
    return this.subs.banner(studioId)
  }

  /** Weddyzone's GST tax invoice for one of the studio's plan payments. */
  @Get('subscription/payments/:id/invoice')
  async invoice(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string): Promise<PlatformInvoiceDto> {
    const p = await this.prisma.payment.findFirst({ where: { id, studioId, purpose: 'SUBSCRIPTION', status: 'SUCCESS' }, include: { studio: true } })
    if (!p?.invoiceNumber) throw notFound('Invoice')
    const c = config()
    const taxable = p.amount - p.gst
    const intra = !!c.PLATFORM_STATE_CODE && c.PLATFORM_STATE_CODE === p.studio.stateCode
    const half = Math.floor(p.gst / 2)
    const address = [p.studio.addressLine1, p.studio.addressLine2, p.studio.city, p.studio.pincode].filter(Boolean).join(', ')
    return {
      number: p.invoiceNumber,
      date: (p.paidAt ?? p.createdAt).toISOString(),
      seller: { name: c.PLATFORM_LEGAL_NAME, gstin: c.PLATFORM_GSTIN ?? null, address: c.PLATFORM_ADDRESS ?? null, stateCode: c.PLATFORM_STATE_CODE ?? null },
      buyer: { name: p.studio.name, gstin: p.studio.gstin, address: address || null, stateCode: p.studio.stateCode, email: p.studio.email },
      description: p.description,
      sac: '998314',
      taxablePaise: taxable,
      cgstPaise: intra ? half : 0,
      sgstPaise: intra ? p.gst - half : 0,
      igstPaise: intra ? 0 : p.gst,
      totalPaise: p.amount,
      totalInWords: amountInWords(p.amount),
      paymentRef: p.gatewayPaymentId,
    }
  }

  @Post('subscription/resume')
  @HttpCode(200)
  resume(@StudioId() studioId: string) {
    return this.subs.resume(studioId)
  }
}

const messageQuery = listQuerySchema.extend({
  type: z.enum(MESSAGE_TEMPLATE_KEYS).optional().or(z.literal('').transform(() => undefined)),
})

@ApiTags('whatsapp')
@Controller('credits')
export class CreditsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subs: SubscriptionsService,
  ) {}

  @Get()
  async balance(@StudioId() studioId: string) {
    const [studio, spent] = await Promise.all([
      this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { creditBalance: true } }),
      this.prisma.creditLedger.aggregate({
        where: { studioId, reason: 'MESSAGE', createdAt: { gte: startOfMonthUtc() } },
        _sum: { delta: true },
      }),
    ])
    return { balance: studio.creditBalance, spentThisMonth: Math.abs(spent._sum.delta ?? 0), packs: CREDIT_PACKS, testMode: true }
  }

  @Post('purchase')
  @HttpCode(200)
  @ApiZodBody(buyCreditsSchema)
  buy(@StudioId() studioId: string, @Body(zod(buyCreditsSchema)) body: z.output<typeof buyCreditsSchema>) {
    return this.subs.buyCredits(studioId, body.packCode)
  }

  @Get('messages')
  @ApiListQuery()
  async messages(@StudioId() studioId: string, @Query(zod(messageQuery)) q: z.output<typeof messageQuery>) {
    const text = q.search ? { contains: q.search, mode: 'insensitive' as const } : undefined
    const where: Prisma.WhatsAppMessageWhereInput = {
      studioId,
      ...(q.type ? { templateKey: q.type } : {}),
      ...(q.status === 'SENT' || q.status === 'FAILED' ? { status: q.status } : {}),
      ...(text ? { OR: [{ toName: text }, { toPhone: { contains: q.search!.replace(/\D/g, '') || q.search } }] } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.whatsAppMessage.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.prisma.whatsAppMessage.count({ where }),
    ])
    return paginate(rows.map(messageDto), total, q)
  }
}

const markPaidSchema = z.object({ method: z.enum(PAYMENT_METHODS).default('UPI') })

@ApiTags('invoices')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @ApiListQuery()
  list(@StudioId() studioId: string, @Query(zod(listQuerySchema)) q: ListQuery) {
    return this.invoices.list(studioId, q)
  }

  @Get('summary')
  summary(@StudioId() studioId: string) {
    return this.invoices.summary(studioId)
  }

  @Post()
  @ApiZodBody(makeInvoiceSchema('33'))
  async create(@StudioId() studioId: string, @Body() raw: unknown) {
    return this.invoices.create(studioId, await this.invoices.validateBody(studioId, raw))
  }

  @Get(':id')
  get(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.detail(studioId, id)
  }

  @Post(':id/payments')
  @ApiZodBody(recordPaymentSchema)
  pay(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Body(zod(recordPaymentSchema)) body: z.output<typeof recordPaymentSchema>) {
    return this.invoices.recordPayment(studioId, id, body)
  }

  @Post(':id/mark-paid')
  @HttpCode(200)
  @ApiZodBody(markPaidSchema)
  markPaid(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Body(zod(markPaidSchema)) body: z.output<typeof markPaidSchema>) {
    return this.invoices.markPaid(studioId, id, body.method)
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.cancel(studioId, id)
  }

  @Post(':id/send')
  @HttpCode(200)
  send(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.send(studioId, id)
  }
}
