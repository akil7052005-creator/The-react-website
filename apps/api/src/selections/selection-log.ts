import type { SelectionEffectiveStatus, SelectionLogDto } from '@weddyzone/shared'
import type { PrismaService, Tx } from '../prisma/prisma.service'

export type LogActor = SelectionLogDto['actor']

/** Client Activity entry for Reset Selection (Shortlist or Reject all). */
export const REOPENED_ACTION = 'Selection reopened by studio'
/** Log actions of studio resets shown in Client Activity: the current one and the older wording. */
export const RESET_ACTIONS = [REOPENED_ACTION, 'Selection reset — shortlist kept', 'Selection reset — all picks rejected'] as const

/**
 * The status a Client Activity entry shows, saved with it: In Progress when the client opens the
 * gallery or starts picking, Selected when they submit, Pending (DRAFT) when the studio reopens it.
 */
export function activityStatus(action: string): SelectionEffectiveStatus | null {
  if (action === 'Opened the gallery' || action === 'Started picking') return 'IN_PROGRESS'
  if (action === 'Submitted') return 'SUBMITTED'
  if ((RESET_ACTIONS as readonly string[]).includes(action)) return 'DRAFT'
  return null
}

/** Records what happened to a selection (shown on the event page as the change log). */
export function writeLog(db: Tx | PrismaService, selectionId: string, actor: LogActor, action: string, detail?: string | null) {
  return db.selectionLog.create({ data: { selectionId, actor, action, detail: detail ?? null, status: activityStatus(action) } })
}

export const logDto = (l: { id: string; actor: string; action: string; detail: string | null; createdAt: Date }): SelectionLogDto => ({
  id: l.id,
  actor: (['STUDIO', 'CLIENT', 'SYSTEM'].includes(l.actor) ? l.actor : 'SYSTEM') as LogActor,
  action: l.action,
  detail: l.detail,
  createdAt: l.createdAt.toISOString(),
})
