import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Prisma } from '@prisma/client'
import {
  clientSchema,
  createEventSchema,
  EVENT_STATUSES,
  listQuerySchema,
  todayIST,
  updateEventSchema,
  type ListQuery,
} from '@weddyzone/shared'
import type { z } from 'zod'
import { StudioId } from '../auth/auth.decorators'
import { badRequest, notFound } from '../common/errors'
import { nextSequence, orderBy, paginate, skipTake, toDate } from '../common/util'
import { ApiListQuery, ApiZodBody, zod } from '../common/zod'
import { clientDto, eventDto } from '../core/mappers'
import { NotificationsService } from '../core/notifications.service'
import { UsageService } from '../core/usage.service'
import { PrismaService } from '../prisma/prisma.service'

@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiListQuery()
  async list(@StudioId() studioId: string, @Query(zod(listQuerySchema)) q: ListQuery) {
    const text = q.search ? { contains: q.search, mode: 'insensitive' as const } : undefined
    const digits = q.search?.replace(/\D/g, '') ?? ''
    const where: Prisma.ClientWhereInput = {
      studioId,
      deletedAt: null,
      ...(text ? { OR: [{ name: text }, { email: text }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.client.findMany({ where, ...skipTake(q), orderBy: orderBy(q.sort, ['name', 'createdAt'], { name: 'asc' }) }),
      this.prisma.client.count({ where }),
    ])
    return paginate(rows.map(clientDto), total, q)
  }

  @Get(':id')
  async get(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.prisma.client.findFirst({ where: { id, studioId, deletedAt: null } })
    if (!c) throw notFound('Client')
    return clientDto(c)
  }

  @Post()
  @ApiZodBody(clientSchema)
  async create(@StudioId() studioId: string, @Body(zod(clientSchema)) body: z.output<typeof clientSchema>) {
    const c = await this.prisma.client.create({ data: { studioId, ...body } })
    return clientDto(c)
  }

  @Patch(':id')
  @ApiZodBody(clientSchema)
  async update(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Body(zod(clientSchema)) body: z.output<typeof clientSchema>) {
    await this.get(studioId, id)
    const c = await this.prisma.client.update({
      where: { id },
      data: { ...body, email: body.email ?? null, city: body.city ?? null, stateCode: body.stateCode ?? null, gstin: body.gstin ?? null, notes: body.notes ?? null },
    })
    return clientDto(c)
  }

  @Delete(':id')
  async remove(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.get(studioId, id)
    const active = await this.prisma.event.count({ where: { clientId: id, deletedAt: null } })
    if (active > 0) throw badRequest(`This client has ${active} event${active > 1 ? 's' : ''}. Delete or reassign them first.`)
    await this.prisma.client.update({ where: { id }, data: { deletedAt: new Date() } })
    return { ok: true }
  }
}

const eventInclude = { client: true } as const

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly notifications: NotificationsService,
  ) {}

  private async clientOf(studioId: string, clientId: string) {
    const c = await this.prisma.client.findFirst({ where: { id: clientId, studioId, deletedAt: null } })
    if (!c) throw badRequest('Client not found', { clientId: 'Select one of your clients' })
    return c
  }

  @Get()
  @ApiListQuery()
  async list(@StudioId() studioId: string, @Query(zod(listQuerySchema)) q: ListQuery) {
    const text = q.search ? { contains: q.search, mode: 'insensitive' as const } : undefined
    const where: Prisma.EventWhereInput = {
      studioId,
      deletedAt: null,
      ...(q.status === 'upcoming'
        ? { date: { gte: toDate(todayIST()) }, status: { notIn: ['CANCELLED', 'DELIVERED'] } }
        : q.status && (EVENT_STATUSES as readonly string[]).includes(q.status)
          ? { status: q.status as (typeof EVENT_STATUSES)[number] }
          : {}),
      ...(text ? { OR: [{ title: text }, { code: text }, { city: text }, { venue: text }, { client: { name: text } }] } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        include: eventInclude,
        ...skipTake(q),
        orderBy: orderBy(q.sort, ['date', 'createdAt', 'title'], { date: 'desc' }),
      }),
      this.prisma.event.count({ where }),
    ])
    return paginate(rows.map(eventDto), total, q)
  }

  @Get(':id')
  async get(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    const e = await this.prisma.event.findFirst({ where: { id, studioId, deletedAt: null }, include: eventInclude })
    if (!e) throw notFound('Event')
    return eventDto(e)
  }

  @Post()
  @ApiZodBody(createEventSchema)
  async create(@StudioId() studioId: string, @Body(zod(createEventSchema)) body: z.output<typeof createEventSchema>) {
    await this.clientOf(studioId, body.clientId)
    const e = await this.prisma.$transaction(async (tx) => {
      await this.usage.assertCanCreateEvent(studioId, tx)
      const seq = await nextSequence(tx, studioId, 'EVT', 1001)
      const created = await tx.event.create({
        data: { studioId, code: `EVT-${seq}`, ...body, date: toDate(body.date) },
        include: eventInclude,
      })
      await this.notifications.notify(
        studioId,
        { type: 'EVENT_CREATED', title: created.client.name, body: `booked ${created.title}`, link: `/?event=${created.id}`, icon: 'calendar-plus' },
        tx,
      )
      return created
    })
    return eventDto(e)
  }

  @Patch(':id')
  @ApiZodBody(updateEventSchema)
  async update(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Body(zod(updateEventSchema)) body: z.output<typeof updateEventSchema>) {
    await this.get(studioId, id)
    await this.clientOf(studioId, body.clientId)
    const e = await this.prisma.event.update({
      where: { id },
      data: { ...body, date: toDate(body.date), guests: body.guests ?? null, notes: body.notes ?? null },
      include: eventInclude,
    })
    return eventDto(e)
  }

  @Delete(':id')
  async remove(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.get(studioId, id)
    await this.prisma.event.update({ where: { id }, data: { deletedAt: new Date() } })
    return { ok: true }
  }
}
