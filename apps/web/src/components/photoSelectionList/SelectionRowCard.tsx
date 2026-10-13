import * as Dialog from '@radix-ui/react-dialog'
import type { SelectionDto } from '@weddyzone/shared'
import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { canReopen, REOPEN_HINT, selectionPath, selectionPill } from '../selection/selectionUi'
import { SelectionStatusPill } from '../selection/SelectionStatusPill'
import { formatDate, formatNumber } from '../../utils/format'

/**
 * The Photo Selection list on phones (≤ 640px): one card per table row and a ⋮ sheet with the
 * rest of the row's actions. Layout only: every button calls the list page's own handlers
 * (Send, Reset Selection, Delete, Download Selected) or opens the same pages as the table.
 */

const PHONE_QUERY = '(max-width: 640px)'
const phoneNow = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(PHONE_QUERY).matches)

export function useIsPhoneList() {
  const [phone, setPhone] = useState(phoneNow)
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_QUERY)
    if (!mq) return
    const on = () => setPhone(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}

/** The three phone filters: Pending (still with the customer), Selected (submitted), Downloaded. */
export type PhoneGroup = 'pending' | 'selected' | 'downloaded' | 'expired'
export function phoneGroup(s: SelectionDto): PhoneGroup {
  const label = selectionPill(s).label
  if (label === 'Selected') return 'selected'
  if (label === 'Downloaded') return 'downloaded'
  if (label === 'Expired') return 'expired'
  return 'pending'
}

const CAPTION: Record<PhoneGroup, string> = {
  pending: 'Waiting for customer',
  selected: 'Submitted · ready to download',
  downloaded: 'Delivered',
  expired: 'Gallery expired',
}

export interface RowHandlers {
  onSend: (s: SelectionDto) => void
  onReopen: (s: SelectionDto) => void
  onDownload: (s: SelectionDto) => void
  onMore: (s: SelectionDto) => void
}

export function SelectionRowCard({ s, onSend, onReopen, onDownload, onMore }: { s: SelectionDto } & RowHandlers) {
  const group = phoneGroup(s)
  const pill = selectionPill(s)
  const open = selectionPath(s.id)
  const pct = s.quota > 0 ? Math.min(100, Math.round((s.pickedCount / s.quota) * 100)) : null
  const title = s.event.title
  return (
    <article className={`plc tone-${pill.tone}`} aria-label={`${s.client.name}, ${title}`}>
      <div className="plc-top">
        <span className="plc-avatar" aria-hidden="true">
          {(s.client.name.trim()[0] ?? '?').toUpperCase()}
        </span>
        <Link to={open} className="plc-who">
          <strong className="plc-name">{s.client.name}</strong>
          <span className="plc-sub">
            {title} · {formatDate(s.createdAt)}
          </span>
        </Link>
        <SelectionStatusPill selection={s} className="pl-status plc-badge" onReopen={() => onReopen(s)} />
      </div>
      <p className="plc-counts">
        <span className="plc-count">
          <i className="bi bi-folder2" aria-hidden="true" /> {formatNumber(s.folderCount ?? 0)} {s.folderCount === 1 ? 'folder' : 'folders'}
        </span>
        <span className="plc-count">
          <i className="bi bi-image" aria-hidden="true" /> {formatNumber(s.photoCount)} {s.photoCount === 1 ? 'photo' : 'photos'}
        </span>
        <span className="plc-count">
          <i className="bi bi-check-lg" aria-hidden="true" /> {formatNumber(s.pickedCount)}
          {s.quota > 0 ? ` / ${formatNumber(s.quota)}` : ''} picked
        </span>
      </p>
      <div className="plc-progress">
        <div className="plc-bar" role="progressbar" aria-label="Photos picked" aria-valuemin={0} aria-valuemax={s.quota || undefined} aria-valuenow={s.pickedCount}>
          <span style={{ width: `${pct ?? (s.pickedCount > 0 ? 100 : 0)}%` }} />
        </div>
        <span className="plc-caption">
          {CAPTION[group]}
          {pct !== null && <strong> · {pct}%</strong>}
        </span>
      </div>
      <div className="plc-actions">
        {group === 'pending' && (
          <>
            <Link className="plc-btn" to={open} aria-label={`Upload & Download: ${title}`}>
              <i className="bi bi-cloud-arrow-up" aria-hidden="true" /> Upload
            </Link>
            <button type="button" className="plc-btn send" onClick={() => onSend(s)} aria-label={`Send code ${s.code} to ${s.client.name}`}>
              <i className="bi bi-whatsapp" aria-hidden="true" /> Send
            </button>
          </>
        )}
        {group === 'selected' && (
          <button type="button" className="plc-btn accent wide" onClick={() => onDownload(s)}>
            <i className="bi bi-download" aria-hidden="true" /> Download Selected ({formatNumber(s.pickedCount)})
          </button>
        )}
        {group === 'downloaded' && (
          <Link className="plc-btn wide" to={`${open}?view=selected`}>
            <i className="bi bi-eye" aria-hidden="true" /> View picks
          </Link>
        )}
        {group === 'expired' && (
          <Link className="plc-btn wide" to={open}>
            <i className="bi bi-box-arrow-up-right" aria-hidden="true" /> Open event
          </Link>
        )}
        <button type="button" className="plc-btn more" onClick={() => onMore(s)} aria-label={`More actions for ${title}`} aria-haspopup="dialog">
          <i className="bi bi-three-dots-vertical" aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}

/**
 * The ⋮ sheet's open/close, with the phone's Back button closing it: opening adds a history entry
 * (same address), and closing any other way steps back over it.
 */
export function useRowSheet() {
  const [row, setRow] = useState<SelectionDto | null>(null)
  const pushed = useRef(false)
  useEffect(() => {
    if (!row) return
    const onPop = () => {
      pushed.current = false
      setRow(null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [row])
  const open = useCallback((s: SelectionDto) => {
    if (!pushed.current) {
      window.history.pushState({ ...(window.history.state as object | null), plSheet: true }, '')
      pushed.current = true
    }
    setRow(s)
  }, [])
  const close = useCallback(() => {
    setRow(null)
    if (pushed.current) {
      pushed.current = false
      window.history.back()
    }
  }, [])
  /** Leaving for another page: that page takes the sheet's history entry. */
  const leave = useCallback(() => {
    pushed.current = false
    setRow(null)
  }, [])
  return { row, open, close, leave }
}

export function RowActionsSheet({
  s,
  onClose,
  onLeave,
  onSend,
  onReopen,
  onDelete,
  onCopyCode,
}: {
  s: SelectionDto
  onClose: () => void
  onLeave: () => void
  onSend: (s: SelectionDto) => void
  onReopen: (s: SelectionDto) => void
  onDelete: (s: SelectionDto) => void
  onCopyCode: (code: string) => void
}) {
  const navigate = useNavigate()
  const sheet = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; dy: number } | null>(null)
  const go = (to: string) => {
    onLeave()
    navigate(to, { replace: true })
  }
  const then = (fn: () => void) => () => {
    onClose()
    fn()
  }
  const reopenable = canReopen(s.status)
  const path = selectionPath(s.id)

  // Swipe down on the sheet (from its top, or anywhere while it isn't scrolled) closes it.
  const onTouchStart = (e: TouchEvent) => {
    if ((sheet.current?.scrollTop ?? 0) > 0) return
    drag.current = { y: e.touches[0].clientY, dy: 0 }
  }
  const onTouchMove = (e: TouchEvent) => {
    if (!drag.current || !sheet.current) return
    drag.current.dy = Math.max(0, e.touches[0].clientY - drag.current.y)
    sheet.current.style.transform = `translateY(${drag.current.dy}px)`
  }
  const onTouchEnd = () => {
    if (!drag.current || !sheet.current) return
    const far = drag.current.dy > 80
    drag.current = null
    sheet.current.style.transform = ''
    if (far) onClose()
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="plc-sheet-overlay" />
        <Dialog.Content ref={sheet} className="plc-sheet" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} aria-describedby={undefined}>
          <span className="plc-sheet-handle" aria-hidden="true" />
          <Dialog.Title className="plc-sheet-title">
            {s.client.name}
            <span>{s.event.title}</span>
          </Dialog.Title>
          <div className="plc-sheet-list">
            <button type="button" onClick={() => go(path)}>
              <i className="bi bi-box-arrow-up-right" aria-hidden="true" /> Open event
            </button>
            <button type="button" onClick={() => go(path)}>
              <i className="bi bi-cloud-arrow-up" aria-hidden="true" /> Upload more
            </button>
            <button type="button" onClick={then(() => onSend(s))}>
              <i className="bi bi-send" aria-hidden="true" /> Send again <small>WhatsApp · SMS · Copy · QR</small>
            </button>
            <button type="button" onClick={then(() => onCopyCode(s.code))}>
              <i className="bi bi-clipboard" aria-hidden="true" /> Copy code <small>{s.code}</small>
            </button>
            <button type="button" onClick={then(() => onReopen(s))} disabled={!reopenable} title={REOPEN_HINT}>
              <i className="bi bi-arrow-counterclockwise" aria-hidden="true" /> Reset Selection
              {!reopenable && <small>After the customer submits</small>}
            </button>
            <button type="button" onClick={() => go(`${path}/settings`)}>
              <i className="bi bi-gear" aria-hidden="true" /> Edit
            </button>
            <button type="button" className="danger" onClick={then(() => onDelete(s))} aria-label={`Delete ${s.event.title}`}>
              <i className="bi bi-trash" aria-hidden="true" /> Delete
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
