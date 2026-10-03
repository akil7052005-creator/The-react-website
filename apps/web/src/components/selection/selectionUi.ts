import type { QueryClient } from '@tanstack/react-query'
import type { SelectionEffectiveStatus } from '@weddyzone/shared'

/** Badge colour per status: grey before sharing, orange while waiting on the client, green when done. */
export const SELECTION_TONE: Record<SelectionEffectiveStatus, 'muted' | 'info' | 'pending' | 'done' | 'expired'> = {
  DRAFT: 'muted',
  UPLOADING: 'info',
  SENT: 'pending',
  IN_PROGRESS: 'pending',
  SUBMITTED: 'done',
  DELIVERED: 'done',
  EXPIRED: 'expired',
}

/** The event page of a selection. */
export const selectionPath = (id: string) => `/photo-selection/${id}`

/** Everything that shows selection data, refreshed after a change. */
export function refreshSelection(qc: QueryClient, id?: string) {
  qc.invalidateQueries({ queryKey: ['selections'] })
  qc.invalidateQueries({ queryKey: ['selections-summary'] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
  if (id) {
    qc.invalidateQueries({ queryKey: ['selection', id] })
    qc.invalidateQueries({ queryKey: ['selection-overview', id] })
    qc.invalidateQueries({ queryKey: ['selection-photos', id] })
  }
}

/** "Haldi 320" style counts, Indian grouping. */
export const count = (n: number) => new Intl.NumberFormat('en-IN').format(n)
