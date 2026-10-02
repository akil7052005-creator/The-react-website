import type { AlbumFeedbackDto, AlbumPageDto } from '@weddyzone/shared'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fileUrl } from '../lib/env'
import { FeatureTooltip, Spinner } from './ui'

export interface FlipbookProps {
  title: string
  subtitle?: string
  pages: AlbumPageDto[]
  feedback: AlbumFeedbackDto[]
  isOpen: boolean
  onClose?: () => void
  /** Render in the page instead of as an overlay (public album link). */
  inline?: boolean
  loading?: boolean
  /** 'client' can approve spreads and leave feedback; 'studio' can resolve feedback. */
  mode: 'studio' | 'client'
  onToggleApproval?: (spreadIndex: number, approved: boolean) => Promise<unknown>
  onResolve?: (feedbackId: string, resolved: boolean) => Promise<unknown>
  /** Client feedback form, rendered below the book for the current spread. */
  renderFeedbackForm?: (spreadIndex: number) => ReactNode
  headerActions?: ReactNode
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export function FlipbookModal({
  title,
  subtitle,
  pages,
  feedback,
  isOpen,
  onClose,
  inline,
  loading,
  mode,
  onToggleApproval,
  onResolve,
  renderFeedbackForm,
  headerActions,
}: FlipbookProps) {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [showNotes, setShowNotes] = useState(true)
  const [isZoomed, setIsZoomed] = useState(false)
  const [busy, setBusy] = useState(false)

  const spreads = useMemo(() => chunk(pages, 2), [pages])
  const total = spreads.length
  const idx = Math.min(currentIdx, Math.max(0, total - 1))
  const spread = spreads[idx] ?? []
  const [left, right] = spread

  const approvedSpreads = useMemo(() => new Set(feedback.filter((f) => f.kind === 'APPROVAL').map((f) => f.spreadIndex)), [feedback])
  const notesFor = (i: number) => feedback.filter((f) => f.kind === 'COMMENT' && f.spreadIndex === i)
  const notes = notesFor(idx)
  const openNote = [...notes].reverse().find((n) => !n.resolvedAt) ?? notes[notes.length - 1]
  const isApproved = approvedSpreads.has(idx)

  const next = useCallback(() => setCurrentIdx((i) => Math.min(i + 1, total - 1)), [total])
  const prev = useCallback(() => setCurrentIdx((i) => Math.max(i - 1, 0)), [])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA'].includes(t.tagName)) return
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'Escape' && onClose) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, next, prev, onClose])

  if (!isOpen) return null

  const toggleApprove = async () => {
    if (!onToggleApproval || busy) return
    setBusy(true)
    try {
      await onToggleApproval(idx, !isApproved)
    } finally {
      setBusy(false)
    }
  }

  const pageCaption = (p: AlbumPageDto | undefined, fallback: string) => p?.caption || fallback

  const book = (
    <div className="flipbook-container" onClick={(e) => e.stopPropagation()}>
      {/* Top bar controls */}
      <header className="flipbook-header">
        <div className="flipbook-title-group">
          <span className="flipbook-badge">Virtual Flipbook</span>
          <h2>
            {title}
            {total > 0 && ` — Spread ${idx + 1}`}
          </h2>
          <p className="flipbook-subtitle">
            {total > 0 ? `Spread ${idx + 1} of ${total} · ${pages.length} Curated Photos` : subtitle}
          </p>
        </div>

        <div className="flipbook-actions">
          {headerActions}
          <FeatureTooltip title="Toggle Client Annotations" summary="Show or hide feedback sticky notes left by the couple." position="bottom" width={240}>
            <button className={`btn btn-sm ${showNotes ? 'btn-gold' : 'btn-ghost'}`} onClick={() => setShowNotes(!showNotes)}>
              <i className={`bi bi-${showNotes ? 'chat-quote-fill' : 'chat-quote'}`} />
              {showNotes ? 'Hide Client Notes' : 'Show Client Notes'}
            </button>
          </FeatureTooltip>

          <FeatureTooltip title="Bridal High-Res Zoom" summary="Zoom in to inspect jewelry, silk embroidery, and fine skin retouching." position="bottom" width={260}>
            <button className="btn btn-sm btn-ghost" onClick={() => setIsZoomed(!isZoomed)}>
              <i className={`bi bi-${isZoomed ? 'zoom-out' : 'zoom-in'}`} />
              {isZoomed ? 'Reset Zoom' : '2× Zoom'}
            </button>
          </FeatureTooltip>

          {total > 0 && (
            <FeatureTooltip
              title="Approve Spread Layout"
              summary={mode === 'client' ? 'One-click sign-off locking this spread for final printing.' : 'Shows whether the couple has signed off this spread.'}
              position="bottom"
              width={260}
            >
              <button
                className={`btn btn-sm ${isApproved ? 'btn-primary' : 'btn-ghost'}`}
                onClick={toggleApprove}
                disabled={mode !== 'client' || busy}
                data-testid="approve-spread"
              >
                {busy ? <Spinner size={12} /> : <i className={`bi bi-${isApproved ? 'check-circle-fill' : 'check-circle'}`} />}
                {isApproved ? 'Spread Approved' : mode === 'client' ? 'Approve Layout' : 'Awaiting Approval'}
              </button>
            </FeatureTooltip>
          )}

          {onClose && (
            <button className="icon-btn flipbook-close" onClick={onClose} aria-label="Close flipbook">
              <i className="bi bi-x-lg" />
            </button>
          )}
        </div>
      </header>

      {/* Open album surface */}
      <div className={`flipbook-stage ${isZoomed ? 'zoomed' : ''}`}>
        <div className="album-spine-shadow" />
        {loading ? (
          <div className="flipbook-empty">
            <Spinner size={28} label="Loading album" />
          </div>
        ) : total === 0 ? (
          <div className="flipbook-empty">
            <i className="bi bi-journal-x" />
            <p>This album has no pages yet.</p>
          </div>
        ) : (
          <div className="album-book">
            {/* Left Page */}
            <div className="album-page album-page-left">
              <div className="album-photo-wrap">
                {left && <img src={fileUrl(left.url)} alt={pageCaption(left, `Page ${idx * 2 + 1}`)} className="album-photo" loading="lazy" />}
                {left?.caption && <span className="album-caption">{left.caption}</span>}
              </div>
              <span className="album-page-num">{idx * 2 + 1}</span>
            </div>

            {/* Book Spine Fold */}
            <div className="album-spine" />

            {/* Right Page */}
            <div className="album-page album-page-right">
              <div className="album-photo-wrap">
                {right && <img src={fileUrl(right.url)} alt={pageCaption(right, `Page ${idx * 2 + 2}`)} className="album-photo" loading="lazy" />}
                {right?.caption && <span className="album-caption">{right.caption}</span>}
              </div>
              <span className="album-page-num">{idx * 2 + 2}</span>

              {/* Client Note Sticky Card */}
              {showNotes && openNote && (
                <div className="client-sticky-note">
                  <div className="sticky-pin" />
                  <p className="sticky-author">
                    <i className="bi bi-chat-heart-fill" /> {openNote.authorName}:
                  </p>
                  <p className="sticky-text">“{openNote.message}”</p>
                  <span className={`pill pill-${openNote.resolvedAt || isApproved ? 'success' : 'warning'}`} style={{ marginTop: 6 }}>
                    {openNote.resolvedAt ? 'Changes Applied' : isApproved ? 'Approved' : 'Action Required'}
                  </span>
                  {notes.length > 1 && <p className="sticky-more">+{notes.length - 1} more note{notes.length > 2 ? 's' : ''} on this spread</p>}
                  {mode === 'studio' && onResolve && (
                    <button
                      className="btn btn-sm btn-ghost sticky-resolve"
                      onClick={async () => {
                        setBusy(true)
                        try {
                          await onResolve(openNote.id, !openNote.resolvedAt)
                        } finally {
                          setBusy(false)
                        }
                      }}
                      disabled={busy}
                    >
                      <i className={`bi bi-${openNote.resolvedAt ? 'arrow-counterclockwise' : 'check2'}`} />
                      {openNote.resolvedAt ? 'Reopen' : 'Mark resolved'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {renderFeedbackForm && total > 0 && <div className="flipbook-feedback">{renderFeedbackForm(idx)}</div>}

      {/* Bottom Navigation & Controls */}
      <footer className="flipbook-footer">
        <FeatureTooltip title="Previous Page Spread" summary="Press Left Arrow or click to turn back a spread." position="top" width={220}>
          <button className="btn btn-ghost" onClick={prev} disabled={idx === 0}>
            <i className="bi bi-arrow-left" /> Previous Spread
          </button>
        </FeatureTooltip>

        {/* Spread Dots / Thumbnail Bar */}
        <div className="flipbook-thumbnails">
          {spreads.map((_, i) => (
            <FeatureTooltip
              key={i}
              title={`Spread ${i + 1}`}
              summary={notesFor(i).length ? `${notesFor(i).length} note(s) from the couple` : 'Ready for review'}
              badge={approvedSpreads.has(i) ? 'Approved' : 'Review'}
              position="top"
              width={230}
            >
              <button
                className={`spread-dot ${i === idx ? 'active' : ''} ${approvedSpreads.has(i) ? 'approved' : ''}`}
                onClick={() => setCurrentIdx(i)}
                aria-label={`Go to spread ${i + 1}`}
              >
                <span>{i + 1}</span>
              </button>
            </FeatureTooltip>
          ))}
        </div>

        <FeatureTooltip title="Next Page Spread" summary="Press Right Arrow or click to turn forward." position="top" width={220}>
          <button className="btn btn-primary" onClick={next} disabled={idx >= total - 1}>
            Next Spread <i className="bi bi-arrow-right" />
          </button>
        </FeatureTooltip>
      </footer>
    </div>
  )

  if (inline) return <div className="flipbook-inline">{book}</div>

  return (
    <div className="flipbook-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${title} flipbook`}>
      {book}
    </div>
  )
}

export default FlipbookModal
