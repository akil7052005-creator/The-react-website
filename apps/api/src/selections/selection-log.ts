import type { SelectionLogDto } from '@weddyzone/shared'
import type { PrismaService, Tx } from '../prisma/prisma.service'

export type LogActor = SelectionLogDto['actor']

/** Records what happened to a selection (shown on the event page as the change log). */
export function writeLog(db: Tx | PrismaService, selectionId: string, actor: LogActor, action: string, detail?: string | null) {
  return db.selectionLog.create({ data: { selectionId, actor, action, detail: detail ?? null } })
}

export const logDto = (l: { id: string; actor: string; action: string; detail: string | null; createdAt: Date }): SelectionLogDto => ({
  id: l.id,
  actor: (['STUDIO', 'CLIENT', 'SYSTEM'].includes(l.actor) ? l.actor : 'SYSTEM') as LogActor,
  action: l.action,
  detail: l.detail,
  createdAt: l.createdAt.toISOString(),
})
