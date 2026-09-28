import { FeatureTooltip } from './ui'
import poster from '../assets/wedding-poster-horizontal.png'

export function WhatsAppPreviewModal({ isOpen, onClose, clientName = 'Priya & Karthik', eventName = 'Chennai Wedding' }) {
  if (!isOpen) return null

  return (
    <div className="flipbook-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="wa-preview-container" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <header className="wa-modal-header">
          <div>
            <span className="pill pill-success"><i className="bi bi-whatsapp" /> Live Client Preview</span>
            <h2>WhatsApp Notification Experience</h2>
            <p className="muted">
              Here is exactly how automated reminders appear on your client's smartphone with 98% open rates.
            </p>
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
              <button className="wa-back-btn"><i className="bi bi-arrow-left" /></button>
              <div className="wa-contact-avatar">
                <span>GH</span>
              </div>
              <div className="wa-contact-info">
                <h4>
                  Golden Hour Studios
                  <i className="bi bi-patch-check-fill wa-verified-badge" />
                </h4>
                <span>Official Business Account</span>
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
                    <strong>{eventName} — Selection Gallery</strong>
                    <p>Protected by Golden Hour Studios</p>
                  </div>
                </div>

                <div className="wa-msg-text">
                  <p>Hi <strong>{clientName}</strong>! 💕</p>
                  <p>
                    Greetings from Arjun at <strong>Golden Hour Studios</strong>. We hope you're reliving the magic of your wedding!
                  </p>
                  <p>
                    Your private photo selection portal is waiting for your album favorites. You have picked <strong>214 of 860 photos</strong> so far!
                  </p>
                  <p className="wa-deadline-note">
                    ⏳ Selection deadline: <strong>2nd October</strong> (to ensure Christmas album delivery).
                  </p>
                </div>

                <div className="wa-msg-footer">
                  <span className="wa-timestamp">11:42 AM</span>
                  <span className="wa-ticks"><i className="bi bi-check2-all" /></span>
                </div>

                {/* WhatsApp Interactive Action Buttons */}
                <div className="wa-action-buttons">
                  <button className="wa-action-btn">
                    <i className="bi bi-images" /> Open Private Gallery
                  </button>
                  <button className="wa-action-btn">
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
              <button className="wa-mic-btn"><i className="bi bi-mic-fill" /></button>
            </div>
          </div>

          {/* Side feature highlights */}
          <div className="phone-features-side">
            <h3>Why Photographers Love This:</h3>
            <ul className="checklist" style={{ margin: '14px 0 20px' }}>
              <li>
                <i className="bi bi-check-circle-fill" />
                <strong>Official Verified Meta API:</strong> Zero risk of personal phone number suspensions.
              </li>
              <li>
                <i className="bi bi-check-circle-fill" />
                <strong>Direct Gallery Link:</strong> Couples access with 1 tap without remembering passwords.
              </li>
              <li>
                <i className="bi bi-check-circle-fill" />
                <strong>98% Read Rate:</strong> Average turnaround drops from 21 days down to 3.2 days.
              </li>
              <li>
                <i className="bi bi-check-circle-fill" />
                <strong>Instant Delivery & Read Receipts:</strong> Know the exact moment the bride opens the gallery.
              </li>
            </ul>

            <button className="btn btn-gold btn-block" onClick={onClose}>
              <i className="bi bi-check2" /> Got It, Looks Great!
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default WhatsAppPreviewModal
