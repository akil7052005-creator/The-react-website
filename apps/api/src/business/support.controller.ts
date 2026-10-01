import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiConsumes, ApiTags } from '@nestjs/swagger'
import type { Prisma, TicketStatus } from '@prisma/client'
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
  type ListQuery,
  type TicketDetailDto,
  type TicketDto,
} from '@weddyzone/shared'
import { z } from 'zod'
import { AuthUser, CurrentUser, Roles, StudioId } from '../auth/auth.decorators'
import { badRequest, notFound } from '../common/errors'
import { nextSequence, paginate, skipTake } from '../common/util'
import { ApiListQuery, ApiZodBody, zod } from '../common/zod'
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

/** Platform staff endpoints: reply to any studio's tickets, manage FAQs and plans. */
@ApiTags('admin')
@Roles('SUPER_ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: SupportService,
    private readonly plans: PlansService,
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
  async reply(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zod(ticketReplySchema)) body: z.output<typeof ticketReplySchema>) {
    return this.support.reply(await this.support.find({ id }), user.userId, body.body, undefined, true)
  }

  @Patch('tickets/:id/status')
  @ApiZodBody(ticketStatusSchema)
  async status(@Param('id', ParseUUIDPipe) id: string, @Body(zod(ticketStatusSchema)) body: z.output<typeof ticketStatusSchema>) {
    return this.support.setStatus(await this.support.find({ id }), body.status)
  }

  @Get('faqs')
  faqs() {
    return this.prisma.faq.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] })
  }

  @Post('faqs')
  @ApiZodBody(faqSchema)
  createFaq(@Body(zod(faqSchema)) body: z.output<typeof faqSchema>) {
    return this.prisma.faq.create({ data: body })
  }

  @Patch('faqs/:id')
  @ApiZodBody(faqSchema)
  async updateFaq(@Param('id', ParseUUIDPipe) id: string, @Body(zod(faqSchema)) body: z.output<typeof faqSchema>) {
    if (!(await this.prisma.faq.findUnique({ where: { id } }))) throw notFound('FAQ')
    return this.prisma.faq.update({ where: { id }, data: body })
  }

  @Delete('faqs/:id')
  async deleteFaq(@Param('id', ParseUUIDPipe) id: string) {
    if (!(await this.prisma.faq.findUnique({ where: { id } }))) throw notFound('FAQ')
    await this.prisma.faq.delete({ where: { id } })
    return { ok: true }
  }

  @Patch('plans/:code')
  @HttpCode(200)
  @ApiZodBody(updatePlanSchema)
  async updatePlan(@Param('code') code: string, @Body(zod(updatePlanSchema)) body: z.output<typeof updatePlanSchema>) {
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
        popular: body.popular,
        isActive: body.isActive,
      },
    })
    return this.plans.toDto(updated)
  }
}
