import { formatINR, todayIST, type AttentionItemDto, type DashboardWorkflowDto } from '@weddyzone/shared'
import { daysBetween, startOfMonthUtc, toDate, toIso } from '../common/util'
import type { PrismaService } from '../prisma/prisma.service'
import { formatDeadline } from '../selections/selections.service'

const DAY = 86_400_000
/** Galleries expiring within this many days need attention. */
export const EXPIRY_WARNING_DAYS = 7
const OPEN = ['UPLOADING', 'SENT', 'IN_PROGRESS'] as const

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The workflow part of the dashboard: needs attention, next events, client activity, this month, checklist. */
export async function dashboardWorkflow(prisma: PrismaService, studioId: string, now = new Date()): Promise<DashboardWorkflowDto> {
  const today = todayIST(now)
  const todayDate = toDate(today)
  const warnUntil = toDate(todayIST(new Date(now.getTime() + EXPIRY_WARNING_DAYS * DAY)))
  const monthStart = startOfMonthUtc(now)
  const nextMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1))
  const live = { studioId, deletedAt: null }

  const [submitted, expiring, unpaid, upcoming, activity, eventsThisMonth, photosThisMonth, submittedThisMonth, billed, anyEvent, anyPhoto, anyShared, uploadTarget] =
    await Promise.all([
      prisma.selection.findMany({
        where: { ...live, status: 'SUBMITTED' },
        include: { event: { include: { client: true } } },
        orderBy: { submittedAt: 'desc' },
        take: 10,
      }),
      prisma.selection.findMany({
        where: { ...live, status: { in: [...OPEN] }, deadline: { gte: todayDate, lte: warnUntil } },
        include: { event: { include: { client: true } } },
        orderBy: { deadline: 'asc' },
        take: 10,
      }),
      prisma.invoice.findMany({
        where: { ...live, status: 'PENDING' },
        include: { client: true },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
      prisma.event.findMany({
        where: { ...live, date: { gte: todayDate }, status: { notIn: ['CANCELLED', 'DELIVERED'] } },
        include: { client: true, selections: { where: { deletedAt: null }, select: { id: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        take: 5,
      }),
      prisma.selectionLog.findMany({
        where: { actor: 'CLIENT', selection: live },
        include: { selection: { include: { event: { include: { client: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      prisma.event.count({ where: { ...live, date: { gte: monthStart, lt: nextMonthStart } } }),
      prisma.photo.count({ where: { studioId, deletedAt: null, selectionId: { not: null }, createdAt: { gte: monthStart } } }),
      prisma.selection.count({ where: { ...live, submittedAt: { gte: monthStart } } }),
      prisma.invoice.aggregate({ where: { ...live, status: { not: 'CANCELLED' }, issueDate: { gte: monthStart, lt: nextMonthStart } }, _sum: { total: true } }),
      prisma.event.count({ where: live, take: 1 }),
      prisma.photo.count({ where: { studioId, deletedAt: null, selectionId: { not: null } }, take: 1 }),
      prisma.selection.count({ where: { ...live, sharedAt: { not: null } }, take: 1 }),
      prisma.selection.findFirst({
        where: { ...live, status: { in: ['DRAFT', ...OPEN] }, deadline: { gte: todayDate } },
        include: { event: true },
        orderBy: { updatedAt: 'desc' },
      }),
    ])

  const picks = submitted.length
    ? await prisma.$queryRaw<{ selection_id: string; n: bigint }[]>`
        SELECT selection_id, COUNT(DISTINCT photo_id) AS n FROM photo_picks
        WHERE selection_id = ANY(${submitted.map((s) => s.id)}::uuid[]) GROUP BY selection_id`
    : []

  const needsAttention: AttentionItemDto[] = [
    ...submitted.map((s) => ({
      kind: 'SUBMITTED' as const,
      id: s.id,
      title: `${s.event.client.name} submitted their picks`,
      detail: `${s.event.title} · ${Number(picks.find((p) => p.selection_id === s.id)?.n ?? 0)} of ${s.quota} photos`,
      link: `/photo-selection/${s.id}`,
      at: s.submittedAt?.toISOString() ?? null,
    })),
    ...expiring.map((s) => {
      const days = daysBetween(today, toIso(s.deadline))
      return {
        kind: 'EXPIRING' as const,
        id: s.id,
        title: `Gallery ${days === 0 ? 'expires today' : `expires in ${plural(days, 'day')}`}`,
        detail: `${s.event.title} · ${s.event.client.name}`,
        link: `/photo-selection/${s.id}?tab=settings`,
        at: s.deadline.toISOString(),
      }
    }),
    ...unpaid
      .filter((i) => i.total > i.amountPaid)
      .map((i) => {
        const overdue = toIso(i.dueDate) < today
        return {
          kind: 'UNPAID' as const,
          id: i.id,
          title: `${formatINR(i.total - i.amountPaid)} unpaid · ${i.client.name}`,
          detail: `${i.number} · ${overdue ? 'overdue since' : 'due'} ${formatDeadline(toIso(i.dueDate))}`,
          link: `/billing?invoice=${i.id}`,
          at: i.dueDate.toISOString(),
        }
      }),
  ]

  return {
    needsAttention,
    upcoming: upcoming.map((e) => ({
      id: e.id,
      title: e.title,
      type: e.type,
      date: toIso(e.date),
      daysLeft: daysBetween(today, toIso(e.date)),
      clientName: e.client.name,
      city: e.city,
      selectionId: e.selections[0]?.id ?? null,
    })),
    activity: activity.map((l) => ({
      id: l.id,
      selectionId: l.selectionId,
      eventTitle: l.selection.event.title,
      clientName: l.selection.event.client.name,
      action: l.action,
      detail: l.detail,
      at: l.createdAt.toISOString(),
    })),
    thisMonth: { events: eventsThisMonth, photosUploaded: photosThisMonth, selectionsSubmitted: submittedThisMonth, billedPaise: billed._sum.total ?? 0 },
    checklist: { eventCreated: anyEvent > 0, photosUploaded: anyPhoto > 0, selectionShared: anyShared > 0 },
    uploadTarget: uploadTarget ? { id: uploadTarget.id, title: uploadTarget.event.title } : null,
  }
}
