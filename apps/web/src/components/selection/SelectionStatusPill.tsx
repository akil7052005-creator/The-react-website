import type { SelectionEffectiveStatus } from '@weddyzone/shared'
import { canReopen, REOPEN_HINT, selectionPill } from './selectionUi'

/**
 * A selection's status pill. "Selected" is a button: it opens Reset Selection (Shortlist / Reject
 * all) so the customer gets another chance to select. Other statuses are plain text.
 */
export function SelectionStatusPill({
  selection,
  className,
  onReopen,
}: {
  selection: { status: SelectionEffectiveStatus; reopened?: boolean }
  /** Base class: pl-status (table) or psx-status (event page). The tone is added. */
  className: string
  onReopen?: () => void
}) {
  const pill = selectionPill(selection)
  if (onReopen && canReopen(selection.status)) {
    return (
      <button type="button" className={`${className} ${pill.tone} is-action`} title={REOPEN_HINT} aria-label={`${pill.label}: ${REOPEN_HINT}`} onClick={onReopen}>
        {pill.label}
      </button>
    )
  }
  return <span className={`${className} ${pill.tone}`}>{pill.label}</span>
}
