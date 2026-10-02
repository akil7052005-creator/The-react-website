import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiConsumes, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { Faq, Plan, Prisma, TicketStatus } from '@prisma/client'
import {
  faqSchema,
  listQuerySchema,
  PLAN_CODES,
  TICKET_STATUSES,
  ticketReplySchema,
  ticketSchema,
  ticketStatusSchema,
  toPaise,
  updatePlanSchema,
  type AdminFaqDto,
  type AdminPlanDto,
  type ListQuery,
  type TicketDetailDto,
  type TicketDto,
} from '@weddyzone/shared'
import type { Request } from 'express'
import { z } from 'zod'
import { AuthUser, CurrentUser, Roles, StudioId } from '../auth/auth.decorators'
import { badRequest, notFound } from '../common/errors'
import { nextSequence, paginate, skipTake } from '../common/util'
import { ApiListQuery, ApiZodBody, zod } from '../common/zod'
import { config } from '../config'
import { AuditService } from '../core/audit.service'
import { FilesService, fileUrls, type UploadedFile as Upload } from '../core/files.service'
import { NotificationsService } from '../core/notifications.service'
import { PlansService } from '../core/plans.service'
import { PrismaService } from '../prisma/prisma.service'
import { uploadOptions } from '../studio/upload-options'

const ticketInclude = { studio: { select: { name: true } } } satisfies Prisma.TicketInclude
type TicketRow = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  toDto(t: TicketRow, admin = false): TicketDto {
    return {
      id: t.id,
      code: t.code,
      subject: t.subject,
      category: t.category,
      priority: t.priority,
      status: t.status,
      ...(admin ? { studioName: t.studio.name } : {}),
      createdAt: t.createdAt.toISOString(),
      lastActivityAt: t.lastActivityAt.toISOString(),
    }
  }

  async list(where: Prisma.TicketWhereInput, q: ListQuery, admin = false) {
    const text = q.search ? { contains: q.search, mode: 'insensitive' as const } : undefined
    const full: Prisma.TicketWhereInput = {
      ...where,
      ...(q.status && (TICKET_STATUSES as readonly string[]).includes(q.status) ? { status: q.status as TicketStatus } : {}),
      ...(q.status === 'active' ? { status: { in: ['OPEN', 'IN_PROGRESS'] } } : {}),
      ...(text ? { OR: [{ subject: text }, { code: text }] } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.ticket.findMany({ where: full, include: ticketInclude, orderBy: { lastActivityAt: 'desc' }, ...skipTake(q) }),
      this.prisma.ticket.count({ where: full }),
    ])
    return paginate(rows.map((t) => this.toDto(t, admin)), total, q)
  }

  async find(where: Prisma.TicketWhereInput) {
    const t = await this.prisma.ticket.findFirst({ where, include: ticketInclude })
    if (!t) throw notFound('Ticket')
    return t
  }

  async detail(t: TicketRow, admin = false): Promise<TicketDetailDto> {
    const messages = await this.prisma.ticketMessage.findMany({
      where: { ticketId: t.id },
      include: { author: { select: { name: true } }, attachment: true },
      orderBy: { createdAt: 'asc' },
    })
    return {
      ...this.toDto(t, admin),
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        authorName: m.fromSupport ? 'Weddyzone Support' : m.author.name,
        fromSupport: m.fromSupport,
        attachmentUrl: m.attachment && !admin ? fileUrls.studio(m.attachment.id) : null,
        attachmentName: m.attachment?.originalName ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
    }
  }

  async create(studioId: string, userId: string, body: z.output<typeof ticketSchema>, file: Upload | undefined) {
    const attachment = file ? await this.files.store(studioId, 'ATTACHMENT', file, 'attachment') : null
    const t = await this.prisma.$transaction(async (tx) => {
      const seq = await nextSequence(tx, studioId, 'TKT', 101)
      return tx.ticket.create({
        data: {
          studioId,
          code: `TKT-${seq}`,
          subject: body.subject,
          category: body.category,
          priority: body.priority,
          attachmentFileId: attachment?.id,
          messages: { create: { authorUserId: userId, body: body.description, attachmentFileId: attachment?.id } },
        },
        include: ticketInclude,
      })
    })
    return this.toDto(t)
  }

  async reply(t: TicketRow, userId: string, body: string, file: Upload | undefined, fromSupport: boolean) {
    const attachment = file ? await this.files.store(t.studioId, 'ATTACHMENT', file, 'attachment') : null
    const nextStatus: TicketStatus = fromSupport ? (t.status === 'OPEN' ? 'IN_PROGRESS' : t.status) : t.status === 'RESOLVED' || t.status === 'CLOSED' ? 'OPEN' : t.status
    await this.prisma.$transaction([
      this.prisma.ticketMessage.create({ data: { ticketId: t.id, authorUserId: userId, fromSupport, body, attachmentFileId: attachment?.id } }),
      this.prisma.ticket.update({ where: { id: t.id }, data: { lastActivityAt: new Date(), status: nextStatus } }),
    ])
    if (fromSupport) {
      await this.notifications.notify(t.studioId, {
        type: 'TICKET_REPLY',
        title: 'Weddyzone Support',
        body: `replied to ${t.code}: ${t.subject}`,
        link: `/support?ticket=${t.id}`,
        icon: 'headset',
      })
    }
    return this.detail(await this.find({ id: t.id }), fromSupport)
  }

  async setStatus(t: TicketRow, status: TicketStatus) {
    await this.prisma.ticket.update({ where: { id: t.id }, data: { status, lastActivityAt: new Date() } })
    return this.toDto(await this.find({ id: t.id }))
  }
}

const studioStatusSchema = z.object({ status: z.enum(['OPEN', 'RESOLVED']) })

@ApiTags('support')
@Controller('tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @ApiListQuery()
  list(@StudioId() studioId: string, @Query(zod(listQuerySchema)) q: ListQuery) {
    return this.support.list({ studioId }, q)
  }

  /** multipart/form-data: subject, category, priority, description and an optional `attachment` (image/PDF ≤ 10 MB). */
  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('attachment', uploadOptions(10)))
  create(@StudioId() studioId: string, @CurrentUser() user: AuthUser, @UploadedFile() file: Upload | undefined, @Body() raw: unknown) {
    return this.support.create(studioId, user.userId, ticketSchema.parse(raw ?? {}), file)
  }

  @Get(':id')
  async get(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.detail(await this.support.find({ id, studioId }))
  }

  @Post(':id/messages')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('attachment', uploadOptions(10)))
  async reply(
    @StudioId() studioId: string,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Upload | undefined,
    @Body() raw: unknown,
  ) {
    const t = await this.support.find({ id, studioId })
    return this.support.reply(t, user.userId, ticketReplySchema.parse(raw ?? {}).body, file, false)
  }

  /** Studios can mark their own ticket resolved or reopen it. */
  @Patch(':id/status')
  @ApiZodBody(studioStatusSchema)
  async status(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Body(zod(studioStatusSchema)) body: z.output<typeof studioStatusSchema>) {
    return this.support.setStatus(await this.support.find({ id, studioId }), body.status)
  }
}

/**
 * Platform admin endpoints (the /admin area of the web app): every studio's tickets, FAQs and plans.
 * Only SUPER_ADMIN users get in, and every change is written to the admin audit log.
 */
@ApiTags('admin')
@Roles('SUPER_ADMIN')
@Throttle({ default: { limit: config().RATE_LIMIT_ADMIN_PER_MIN, ttl: 60_000 } })
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: SupportService,
    private readonly plans: PlansService,
    private readonly audit: AuditService,
  ) {}

  @Get('tickets')
  @ApiListQuery()
  tickets(@Query(zod(listQuerySchema)) q: ListQuery) {
    return this.support.list({}, q, true)
  }

  @Get('tickets/:id')
  async ticket(@Param('id', ParseUUIDPipe) id: string) {
    return this.support.detail(await this.support.find({ id }), true)
  }

  @Post('tickets/:id/messages')
  @ApiZodBody(ticketReplySchema)
  async reply(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(ticketReplySchema)) body: z.output<typeof ticketReplySchema>,
  ) {
    const t = await this.support.find({ id })
    const result = await this.support.reply(t, user.userId, body.body, undefined, true)
    await this.audit.record(user.userId, req, { action: 'ticket.reply', target: { type: 'ticket', id: t.id }, summary: `Replied to ${t.code} (${t.studio.name})` })
    return result
  }

  @Patch('tickets/:id/status')
  @ApiZodBody(ticketStatusSchema)
  async status(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(ticketStatusSchema)) body: z.output<typeof ticketStatusSchema>,
  ) {
    const t = await this.support.find({ id })
    const result = await this.support.setStatus(t, body.status)
    await this.audit.record(user.userId, req, { action: 'ticket.status', target: { type: 'ticket', id: t.id }, summary: `Set ${t.code} from ${t.status} to ${body.status}` })
    return result
  }

  @Get('faqs')
  async faqs(): Promise<AdminFaqDto[]> {
    const rows = await this.prisma.faq.findMany({ orderBy: [{ category: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }] })
    return rows.map(faqDto)
  }

  @Post('faqs')
  @ApiZodBody(faqSchema)
  async createFaq(@CurrentUser() user: AuthUser, @Req() req: Request, @Body(zod(faqSchema)) body: z.output<typeof faqSchema>) {
    const faq = await this.prisma.faq.create({ data: body })
    await this.audit.record(user.userId, req, { action: 'faq.create', target: { type: 'faq', id: faq.id }, summary: `Added FAQ "${faq.question}"` })
    return faqDto(faq)
  }

  @Patch('faqs/:id')
  @ApiZodBody(faqSchema)
  async updateFaq(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(faqSchema)) body: z.output<typeof faqSchema>,
  ) {
    const before = await this.prisma.faq.findUnique({ where: { id } })
    if (!before) throw notFound('FAQ')
    const faq = await this.prisma.faq.update({ where: { id }, data: body })
    const published = before.isPublished !== faq.isPublished ? (faq.isPublished ? ' (published)' : ' (unpublished)') : ''
    await this.audit.record(user.userId, req, { action: 'faq.update', target: { type: 'faq', id }, summary: `Edited FAQ "${faq.question}"${published}` })
    return faqDto(faq)
  }

  @Delete('faqs/:id')
  async deleteFaq(@CurrentUser() user: AuthUser, @Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const faq = await this.prisma.faq.findUnique({ where: { id } })
    if (!faq) throw notFound('FAQ')
    await this.prisma.faq.delete({ where: { id } })
    await this.audit.record(user.userId, req, { action: 'faq.delete', target: { type: 'faq', id }, summary: `Deleted FAQ "${faq.question}"` })
    return { ok: true }
  }

  /** Every plan, hidden ones included. */
  @Get('plans')
  async planList(): Promise<AdminPlanDto[]> {
    return (await this.plans.listAll()).map((p) => this.plans.toAdminDto(p))
  }

  @Patch('plans/:code')
  @HttpCode(200)
  @ApiZodBody(updatePlanSchema)
  async updatePlan(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('code') code: string,
    @Body(zod(updatePlanSchema)) body: z.output<typeof updatePlanSchema>,
  ): Promise<AdminPlanDto> {
    if (!(PLAN_CODES as readonly string[]).includes(code)) throw badRequest('Unknown plan code')
    const plan = await this.plans.byCode(code as (typeof PLAN_CODES)[number])
    const updated = await this.prisma.plan.update({
      where: { id: plan.id },
      data: {
        name: body.name,
        tagline: body.tagline,
        monthlyPrice: body.monthlyPrice === null ? null : toPaise(body.monthlyPrice),
        yearlyPrice: toPaise(body.yearlyPrice),
        limits: body.limits,
        features: body.features,
        comingSoon: body.comingSoon,
        popular: body.popular,
        isActive: body.isActive,
      },
    })
    await this.audit.record(user.userId, req, { action: 'plan.update', target: { type: 'plan', id: plan.id }, summary: planChangeSummary(plan, updated) })
    return this.plans.toAdminDto(updated)
  }
}

function faqDto(f: Faq): AdminFaqDto {
  return {
    id: f.id,
    category: f.category,
    question: f.question,
    answer: f.answer,
    position: f.position,
    isPublished: f.isPublished,
    helpfulYes: f.helpfulYes,
    helpfulNo: f.helpfulNo,
    updatedAt: f.updatedAt.toISOString(),
  }
}

/** "Studio: yearly price ₹59,990 → ₹54,990; popular on" — what changed, for the audit log. */
function planChangeSummary(before: Plan, after: Plan): string {
  const rupees = (p: number | null) => (p === null ? 'none' : `₹${(p / 100).toLocaleString('en-IN')}`)
  const changes: string[] = []
  if (before.name !== after.name) changes.push(`name "${before.name}" → "${after.name}"`)
  if (before.tagline !== after.tagline) changes.push('tagline')
  if (before.monthlyPrice !== after.monthlyPrice) changes.push(`monthly price ${rupees(before.monthlyPrice)} → ${rupees(after.monthlyPrice)}`)
  if (before.yearlyPrice !== after.yearlyPrice) changes.push(`yearly price ${rupees(before.yearlyPrice)} → ${rupees(after.yearlyPrice)}`)
  if (JSON.stringify(before.limits) !== JSON.stringify(after.limits)) changes.push('limits')
  if (JSON.stringify(before.features) !== JSON.stringify(after.features)) changes.push('features')
  if (JSON.stringify(before.comingSoon) !== JSON.stringify(after.comingSoon)) changes.push(`coming soon: ${(after.comingSoon as string[]).join(', ') || 'none'}`)
  if (before.popular !== after.popular) changes.push(`popular ${after.popular ? 'on' : 'off'}`)
  if (before.isActive !== after.isActive) changes.push(after.isActive ? 'shown to studios' : 'hidden from studios')
  return `${before.name}: ${changes.join('; ') || 'saved with no changes'}`
}
