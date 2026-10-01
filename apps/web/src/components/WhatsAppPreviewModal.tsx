import type { MessagePreviewDto } from '@weddyzone/shared'
import poster from '../assets/wedding-photo.jpg'
import { initials } from '../utils/format'
import { Skeleton, Spinner } from './ui'

interface Props {
  isOpen: boolean
  onClose: () => void
  preview?: MessagePreviewDto | null
  loading?: boolean
  error?: string | null
  /** When given, shows a "Send on WhatsApp" button (uses credits). */
  onSend?: () => void
  sending?: boolean
}

// WhatsApp-style bold: *text*
function formatLine(line: string) {
  const parts = line.split(/(\*[^*]+\*)/g)
  return parts.map((p, i) => (p.startsWith('*') && p.endsWith('*') ? <strong key={i}>{p.slice(1, -1)}</strong> : <span key={i}>{p}</span>))
}

export function WhatsAppPreviewModal({ isOpen, onClose, preview, loading, error, onSend, sending }: Props) {
  if (!isOpen) return null
  const time = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  const paragraphs = (preview?.body ?? '').split('\n').filter((l) => l.trim() !== '' && !l.includes(preview?.link || '\u0000'))

  return (
    <div className="flipbook-overlay wa-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="WhatsApp message preview">
      <div className="wa-preview-container" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <header className="wa-modal-header">
          <div>
            <span className="pill pill-success">
              <i className="bi bi-whatsapp" /> Live Client Preview
            </span>
            <h2>WhatsApp Notification Experience</h2>
            <p className="muted">Here is exactly how this message will appear on your client's smartphone.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close WhatsApp preview">
            <i className="bi bi-x-lg" />
          </button>
        </header>

        {/* Realistic Smartphone Frame */}
        <div className="phone-wrapper">
          <div className="phone-device">
            <div className="phone-notch">
              <span className="phone-speaker" />
              <span className="phone-camera" />
            </div>

            {/* WhatsApp App Header */}
            <div className="wa-app-bar">
              <button className="wa-back-btn" tabIndex={-1} aria-hidden="true">
                <i className="bi bi-arrow-left" />
              </button>
              <div className="wa-contact-avatar">
                <span>{initials(preview?.studioName ?? 'W')}</span>
              </div>
              <div className="wa-contact-info">
                <h4>
                  {preview?.studioName ?? 'Your studio'}
                </h4>
                <span>Business Account</span>
              </div>
              <div className="wa-app-icons">
                <i className="bi bi-telephone" />
                <i className="bi bi-three-dots-vertical" />
              </div>
            </div>

            {/* Chat Body */}
            <div className="wa-chat-body">
              <div className="wa-date-pill">TODAY</div>

              <div className="wa-msg-bubble">
                <div className="wa-msg-header-card">
                  <img src={poster} alt="Wedding gallery cover" className="wa-card-poster" />
                  <div className="wa-card-caption">
                    <strong>{preview?.eventTitle || 'Your gallery'}</strong>
                    <p>Protected by {preview?.studioName ?? 'your studio'}</p>
                  </div>
                </div>

                <div className="wa-msg-text">
                  {loading && (
                    <>
                      <Skeleton height={12} style={{ marginBottom: 8 }} />
                      <Skeleton height={12} width="80%" style={{ marginBottom: 8 }} />
                      <Skeleton height={12} width="60%" />
                    </>
                  )}
                  {error && <p>{error}</p>}
                  {!loading && !error && paragraphs.map((line, i) => <p key={i}>{formatLine(line)}</p>)}
                </div>

                <div className="wa-msg-footer">
                  <span className="wa-timestamp">{time}</span>
                  <span className="wa-ticks">
                    <i className="bi bi-check2-all" />
                  </span>
                </div>

                {/* WhatsApp Interactive Action Buttons */}
                <div className="wa-action-buttons">
                  <a className="wa-action-btn" href={preview?.link || undefined} target="_blank" rel="noreferrer">
                    <i className="bi bi-images" /> Open Private Gallery
                  </a>
                  <button className="wa-action-btn" type="button" tabIndex={-1}>
                    <i className="bi bi-telephone" /> Call Studio Concierge
                  </button>
                </div>
              </div>
            </div>

            {/* Fake Keyboard Input Area */}
            <div className="wa-input-bar">
              <i className="bi bi-emoji-smile" />
              <input type="text" placeholder="Message..." disabled />
              <i className="bi bi-paperclip" />
              <button className="wa-mic-btn" tabIndex={-1} aria-hidden="true">
                <i className="bi bi-mic-fill" />
              </button>
            </div>
          </div>

          {/* Side feature highlights */}
          <div className="phone-features-side">
            <h3>Why Photographers Love This:</h3>
            <ul className="checklist" style={{ margin: '14px 0 20px' }}>
              <li>
                <i className="bi bi-check-circle-fill" />
                <strong>Sent From Your WhatsApp:</strong> Opens WhatsApp on your device with the message ready to send.
              </li>
              <li>
                <i className="bi bi-check-circle-fill" />
                <strong>Direct Gallery Link:</strong> Couples access with 1 tap without remembering passwords.
              </li>
              <li>
                <i className="bi bi-check-circle-fill" />
                <strong>Personalized Message:</strong> Client name, event details and deadline filled in automatically.
              </li>
              <li>
                <i className="bi bi-check-circle-fill" />
                <strong>Message Log:</strong> Every message sent is recorded with the credits it used.
              </li>
            </ul>

            {onSend ? (
              <div className="stack" style={{ gap: 10 }}>
                <button className="btn btn-primary btn-block" onClick={onSend} disabled={sending || loading || Boolean(error)}>
                  {sending ? <Spinner size={14} /> : <i className="bi bi-whatsapp" />} Send on WhatsApp
                </button>
                <button className="btn btn-ghost btn-block" onClick={onClose}>
                  Close
                </button>
              </div>
            ) : (
              <button className="btn btn-gold btn-block" onClick={onClose}>
                <i className="bi bi-check2" /> Got It, Looks Great!
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default WhatsAppPreviewModal
