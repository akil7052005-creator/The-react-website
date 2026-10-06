import type { DashboardWorkflowDto, SelectionEffectiveStatus } from '@weddyzone/shared'
import { startOfMonthUtc } from '../common/util'
import type { PrismaService } from '../prisma/prisma.service'
import { activityStatus, RESET_ACTIONS } from '../selections/selection-log'

/** The dashboard's live part: what clients did in their galleries, and what was added this month. */
export async function dashboardWorkflow(prisma: PrismaService, studioId: string, now = new Date()): Promise<DashboardWorkflowDto> {
  const monthStart = startOfMonthUtc(now)
  const live = { studioId, deletedAt: null }
  const [activity, eventsCreated, selectionsCreated] = await Promise.all([
    prisma.selectionLog.findMany({
      // What clients did, plus the studio's resets of their selections.
      where: { selection: live, OR: [{ actor: 'CLIENT' }, { actor: 'STUDIO', action: { in: [...RESET_ACTIONS] } }] },
      include: { selection: { include: { event: { include: { client: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    prisma.event.count({ where: { ...live, createdAt: { gte: monthStart } } }),
    prisma.selection.count({ where: { ...live, createdAt: { gte: monthStart } } }),
  ])
  return {
    activity: activity.map((l) => ({
      id: l.id,
      selectionId: l.selectionId,
      eventTitle: l.selection.event.title,
      clientName: l.selection.event.client.name,
      action: l.action,
      detail: l.detail,
      at: l.createdAt.toISOString(),
      // The status when it happened, not now: a later submit doesn't change an earlier "Opened the gallery".
      status: (l.status as SelectionEffectiveStatus | null) ?? activityStatus(l.action) ?? undefined,
      reopened: false,
    })),
    createdThisMonth: { events: eventsCreated, selections: selectionsCreated },
  }
}
