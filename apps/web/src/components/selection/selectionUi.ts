import type { QueryClient } from '@tanstack/react-query'
import type { SelectionEffectiveStatus } from '@weddyzone/shared'

export interface StatusPill {
  label: string
  /** pending (amber) · shared (blue) · progress · submitted (green) · downloaded (grey). */
  tone: 'pending' | 'shared' | 'progress' | 'submitted' | 'downloaded'
}

/**
 * Status names, the same on every page (table, event page, dashboard, Client Activity):
 * Pending → Shared → In Progress → Selected → Downloaded (or Expired).
 */
export const SELECTION_STATUS_PILL: Record<SelectionEffectiveStatus, StatusPill> = {
  DRAFT: { label: 'Pending', tone: 'pending' },
  UPLOADING: { label: 'Pending', tone: 'pending' },
  SENT: { label: 'Shared', tone: 'shared' },
  IN_PROGRESS: { label: 'In Progress', tone: 'progress' },
  SUBMITTED: { label: 'Selected', tone: 'submitted' },
  DELIVERED: { label: 'Downloaded', tone: 'downloaded' },
  EXPIRED: { label: 'Expired', tone: 'downloaded' },
}

/**
 * The pill for a selection. Reopened by the studio (Reset Selection / Unlock) and not submitted again:
 * Pending, until the customer submits and it shows Selected again.
 */
export function selectionPill(s: { status: SelectionEffectiveStatus; reopened?: boolean }): StatusPill {
  if (s.reopened && s.status !== 'EXPIRED') return SELECTION_STATUS_PILL.DRAFT
  return SELECTION_STATUS_PILL[s.status]
}

/** Selected or Downloaded: the studio can click it to reopen the selection. */
export const canReopen = (s: SelectionEffectiveStatus) => s === 'SUBMITTED' || s === 'DELIVERED'
export const REOPEN_HINT = 'Give the customer another chance to select'

/** How often the selection pages check for the customer's picks and submit (no manual refresh). */
export const LIVE_POLL_MS = 5_000

/** The client has submitted: there is something to download. */
export const hasSubmitted = (s: SelectionEffectiveStatus) => s === 'SUBMITTED' || s === 'DELIVERED'

/** The event page of a selection. */
export const selectionPath = (id: string) => `/photo-selection/${id}`

/** Everything that shows selection data, refreshed after a change. */
export function refreshSelection(qc: QueryClient, id?: string) {
  qc.invalidateQueries({ queryKey: ['selections'] })
  qc.invalidateQueries({ queryKey: ['selections-summary'] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
  // The plan meter (events and uploads used this month).
  qc.invalidateQueries({ queryKey: ['subscription', 'usage'] })
  if (id) {
    qc.invalidateQueries({ queryKey: ['selection', id] })
    qc.invalidateQueries({ queryKey: ['selection-overview', id] })
    qc.invalidateQueries({ queryKey: ['selection-photos', id] })
  }
}

/** "Haldi 320" style counts, Indian grouping. */
export const count = (n: number) => new Intl.NumberFormat('en-IN').format(n)
