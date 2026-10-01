import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import {
  computeInvoiceTotals,
  financialYearStart,
  formatInvoiceNumber,
  makeInvoiceSchema,
  toPaise,
  todayIST,
  type InvoiceDetailDto,
  type InvoiceDto,
  type InvoiceEffectiveStatus,
  type InvoiceOutput,
  type InvoiceSummaryDto,
  type ListQuery,
  type recordPaymentSchema,
} from '@weddyzone/shared'
import type { z } from 'zod'
import { badRequest, conflict, notFound } from '../common/errors'
import { nextSequence, paginate, skipTake, toDate, toIso } from '../common/util'
import { clientRef, eventRef } from '../core/mappers'
import { MessagingService } from '../core/messaging.service'
import { NotificationsService } from '../core/notifications.service'
import { StudioMapper } from '../core/studio.mapper'
import { PrismaService, type Tx } from '../prisma/prisma.service'

const include = { client: true, event: true } satisfies Prisma.InvoiceInclude
type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof include }>

/** OVERDUE is derived on read: unpaid and the due date is before today (IST). */
export function invoiceStatus(i: { status: InvoiceRow['status']; dueDate: Date }, today = todayIST()): InvoiceEffectiveStatus {
  if (i.status === 'PENDING' && toIso(i.dueDate) < today) return 'OVERDUE'
  return i.status
}

const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studios: StudioMapper,
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationsService,
  ) {}

  toDto(i: InvoiceRow): InvoiceDto {
    return {
      id: i.id,
      number: i.number,
      client: { ...clientRef(i.client), email: i.client.email, gstin: i.client.gstin, city: i.client.city, stateCode: i.client.stateCode },
      event: i.event ? eventRef(i.event) : null,
      issueDate: toIso(i.issueDate),
      dueDate: toIso(i.dueDate),
      placeOfSupply: i.placeOfSupply,
      supplyType: i.supplierState === i.placeOfSupply ? 'INTRA' : 'INTER',
      subtotalPaise: i.subtotal,
      cgstPaise: i.cgst,
      sgstPaise: i.sgst,
      igstPaise: i.igst,
      totalPaise: i.total,
      amountPaidPaise: i.amountPaid,
      balancePaise: i.status === 'CANCELLED' ? 0 : i.total - i.amountPaid,
      status: invoiceStatus(i),
      notes: i.notes,
      createdAt: i.createdAt.toISOString(),
    }
  }

  private statusWhere(status: string | undefined): Prisma.InvoiceWhereInput {
    const today = toDate(todayIST())
    switch (status) {
      case 'PENDING':
        return { status: 'PENDING', dueDate: { gte: today } }
      case 'OVERDUE':
        return { status: 'PENDING', dueDate: { lt: today } }
      case 'UNPAID':
        return { status: 'PENDING' }
      case 'PAID':
        return { status: 'PAID' }
      case 'CANCELLED':
        return { status: 'CANCELLED' }
      default:
        return {}
    }
  }

  async list(studioId: string, q: ListQuery) {
    const text = q.search ? { contains: q.search, mode: 'insensitive' as const } : undefined
    const where: Prisma.InvoiceWhereInput = {
      studioId,
      deletedAt: null,
      ...this.statusWhere(q.status),
      ...(text ? { OR: [{ number: text }, { client: { name: text } }, { event: { title: text } }] } : {}),
    }
    const dir = q.sort?.startsWith('-') ? 'desc' : 'asc'
    const field = q.sort?.replace('-', '')
    const orderBy: Prisma.InvoiceOrderByWithRelationInput[] =
      field === 'dueDate' ? [{ dueDate: dir }] : field === 'total' ? [{ total: dir }] : [{ issueDate: 'desc' }, { number: 'desc' }]
    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({ where, include, orderBy, ...skipTake(q) }),
      this.prisma.invoice.count({ where }),
    ])
    return paginate(rows.map((r) => this.toDto(r)), total, q)
  }

  async summary(studioId: string): Promise<InvoiceSummaryDto> {
    const rows = await this.prisma.invoice.findMany({
      where: { studioId, deletedAt: null },
      select: { status: true, dueDate: true, total: true, amountPaid: true },
    })
    const s: InvoiceSummaryDto = {
      outstandingPaise: 0,
      overduePaise: 0,
      collectedPaise: 0,
      counts: { all: rows.length, pending: 0, overdue: 0, paid: 0, cancelled: 0 },
    }
    for (const r of rows) {
      const st = invoiceStatus(r)
      s.collectedPaise += r.status === 'CANCELLED' ? 0 : r.amountPaid
      if (st === 'PENDING') {
        s.outstandingPaise += r.total - r.amountPaid
        s.counts.pending++
      } else if (st === 'OVERDUE') {
        s.overduePaise += r.total - r.amountPaid
        s.counts.overdue++
      } else if (st === 'PAID') s.counts.paid++
      else s.counts.cancelled++
    }
    return s
  }

  private async find(studioId: string, id: string) {
    const i = await this.prisma.invoice.findFirst({ where: { id, studioId, deletedAt: null }, include })
    if (!i) throw notFound('Invoice')
    return i
  }

  async detail(studioId: string, id: string): Promise<InvoiceDetailDto> {
    const i = await this.find(studioId, id)
    const [items, milestones, payments, studio] = await Promise.all([
      this.prisma.invoiceItem.findMany({ where: { invoiceId: id }, orderBy: { position: 'asc' } }),
      this.prisma.milestone.findMany({ where: { invoiceId: id }, orderBy: { position: 'asc' } }),
      this.prisma.invoicePayment.findMany({ where: { invoiceId: id }, orderBy: { paidOn: 'asc' } }),
      this.studios.dto(studioId),
    ])
    return {
      ...this.toDto(i),
      items: items.map((it) => ({
        id: it.id,
        description: it.description,
        sac: it.sac,
        qty: it.qty,
        ratePaise: it.rate,
        gstRate: it.gstRate,
        taxablePaise: it.taxable,
        taxPaise: it.tax,
        totalPaise: it.total,
      })),
      milestones: milestones.map((m) => ({ id: m.id, label: m.label, amountPaise: m.amount, dueDate: toIso(m.dueDate), paidAt: m.paidAt?.toISOString() ?? null })),
      payments: payments.map((p) => ({
        id: p.id,
        amountPaise: p.amount,
        method: p.method,
        paidOn: toIso(p.paidOn),
        reference: p.reference,
        createdAt: p.createdAt.toISOString(),
      })),
      studio,
    }
  }

  /** Validates with the studio's own state (decides CGST+SGST vs IGST for the milestone check). */
  async validateBody(studioId: string, raw: unknown): Promise<InvoiceOutput> {
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId } })
    if (!studio.stateCode) {
      throw badRequest("Add your studio's state in My Profile before creating invoices — it decides CGST/SGST vs IGST.")
    }
    return makeInvoiceSchema(studio.stateCode).parse(raw ?? {})
  }

  /**
   * Creates the invoice and takes the next number in the financial-year series
   * inside the same transaction, so numbers are gap-free and never duplicated.
   */
  async create(studioId: string, body: InvoiceOutput) {
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId } })
    const client = await this.prisma.client.findFirst({ where: { id: body.clientId, studioId, deletedAt: null } })
    if (!client) throw badRequest('Client not found', { clientId: 'Select one of your clients' })
    if (body.eventId) {
      const event = await this.prisma.event.findFirst({ where: { id: body.eventId, studioId, deletedAt: null } })
      if (!event) throw badRequest('Event not found', { eventId: 'Select one of your events' })
    }
    const lines = body.items.map((i) => ({ qty: i.qty, ratePaise: toPaise(i.rate), gstRate: i.gstRate }))
    const totals = computeInvoiceTotals(lines, studio.stateCode, body.placeOfSupply)
    const fy = financialYearStart(body.issueDate)

    const created = await this.prisma.$transaction(async (tx: Tx) => {
      const seq = await nextSequence(tx, studioId, `INV-${fy}`, 1)
      return tx.invoice.create({
        data: {
          studioId,
          number: formatInvoiceNumber(fy, seq),
          clientId: client.id,
          eventId: body.eventId ?? null,
          issueDate: toDate(body.issueDate),
          dueDate: toDate(body.dueDate),
          placeOfSupply: body.placeOfSupply,
          supplierState: studio.stateCode,
          subtotal: totals.subtotalPaise,
          cgst: totals.cgstPaise,
          sgst: totals.sgstPaise,
          igst: totals.igstPaise,
          total: totals.totalPaise,
          notes: body.notes ?? null,
          items: {
            create: body.items.map((it, idx) => ({
              position: idx,
              description: it.description,
              sac: it.sac,
              qty: it.qty,
              rate: toPaise(it.rate),
              gstRate: it.gstRate,
              taxable: totals.lines[idx].taxablePaise,
              tax: totals.lines[idx].cgstPaise + totals.lines[idx].sgstPaise + totals.lines[idx].igstPaise,
              total: totals.lines[idx].totalPaise,
            })),
          },
          milestones: {
            create: body.milestones.map((m, idx) => ({ position: idx, label: m.label, amount: toPaise(m.amount), dueDate: toDate(m.dueDate) })),
          },
        },
        include,
      })
    })
    return this.toDto(created)
  }

  /** Records a (partial) payment. Milestones are marked paid in order as payments cover them. */
  async recordPayment(studioId: string, id: string, body: z.output<typeof recordPaymentSchema>) {
    const inv = await this.find(studioId, id)
    if (inv.status === 'CANCELLED') throw conflict('This invoice is cancelled')
    if (inv.status === 'PAID') throw conflict('This invoice is already fully paid')
    const amount = toPaise(body.amount)
    const balance = inv.total - inv.amountPaid
    if (amount > balance) {
      throw badRequest('Payment is more than the balance due', { amount: `The balance due is ${inr(balance)}` })
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.invoicePayment.create({
        data: { invoiceId: id, amount, method: body.method, paidOn: toDate(body.paidOn), reference: body.reference ?? null },
      })
      const paidTotal = inv.amountPaid + amount
      const fullyPaid = paidTotal >= inv.total
      const milestones = await tx.milestone.findMany({ where: { invoiceId: id }, orderBy: { position: 'asc' } })
      let covered = 0
      for (const m of milestones) {
        covered += m.amount
        if (!m.paidAt && covered <= paidTotal) await tx.milestone.update({ where: { id: m.id }, data: { paidAt: new Date() } })
      }
      return tx.invoice.update({
        where: { id },
        data: { amountPaid: paidTotal, ...(fullyPaid ? { status: 'PAID', paidAt: new Date() } : {}) },
        include,
      })
    })
    if (updated.status === 'PAID') {
      await this.notifications.notify(studioId, {
        type: 'INVOICE_PAID',
        title: updated.client.name,
        body: `paid invoice ${updated.number} in full (${inr(updated.total)})`,
        link: `/billing?invoice=${updated.id}`,
        icon: 'credit-card',
      })
    }
    return this.toDto(updated)
  }

  async markPaid(studioId: string, id: string, method: z.output<typeof recordPaymentSchema>['method']) {
    const inv = await this.find(studioId, id)
    if (inv.status !== 'PENDING') throw conflict(inv.status === 'PAID' ? 'This invoice is already paid' : 'This invoice is cancelled')
    return this.recordPayment(studioId, id, { amount: (inv.total - inv.amountPaid) / 100, method, paidOn: todayIST(), reference: undefined })
  }

  async cancel(studioId: string, id: string) {
    const inv = await this.find(studioId, id)
    if (inv.status === 'CANCELLED') throw conflict('This invoice is already cancelled')
    if (inv.amountPaid > 0) {
      throw conflict('Payments were recorded on this invoice, so it cannot be cancelled. Issue a credit note outside the app instead.')
    }
    const updated = await this.prisma.invoice.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date() }, include })
    return this.toDto(updated)
  }

  async send(studioId: string, id: string) {
    const inv = await this.find(studioId, id)
    if (inv.status === 'CANCELLED') throw conflict('This invoice is cancelled')
    const dto = this.toDto(inv)
    return this.messaging.send(studioId, {
      templateKey: 'INVOICE_SEND',
      toName: inv.client.name,
      toPhone: inv.client.phone,
      vars: {
        invoiceNumber: inv.number,
        amount: inr(inv.total),
        balance: inr(dto.balancePaise),
        dueDate: new Date(inv.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
        eventTitle: inv.event?.title ?? '',
      },
      ref: { type: 'invoice', id: inv.id },
    })
  }
}
