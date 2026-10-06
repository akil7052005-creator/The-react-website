import { useQueryClient } from '@tanstack/react-query'
import { CLIENT_CODE_RE, type SelectionDto, type SendVia } from '@weddyzone/shared'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useMe } from '../../auth/AuthProvider'
import { api } from '../../lib/api'
import { toastError } from '../../lib/query'
import { Modal } from '../Modal'
import { QrCode } from './QrCode'
import { refreshSelection } from './selectionUi'
import { appLinks, isPrivateNetworkUrl, lanLinksAllowed } from '../../lib/env'
import { buildCustomerMessage, buildOptionMessage, shareLink, smsUrl, whatsappMeUrl, whatsappSendUrl, type ShareLinkKey, type ShareLinks } from './sendMessage'

/**
 * Clipboard API, or a hidden textarea where it isn't available (plain http, older browsers). Plain
 * text with its line breaks, as a JS string, so the emoji stays one real character.
 */
export async function copyToClipboard(text: string) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('No clipboard API')
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    let ok: boolean
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}

/** The Send options rows: each link (when set) and the full message, each with Copy and Send via WhatsApp. */
const OPTION_ROWS: { key: ShareLinkKey | 'all'; title: string; hint: string; via: SendVia }[] = [
  { key: 'web', title: 'Web link', hint: 'Sign in with the Customer Code', via: 'web' },
  { key: 'personal', title: 'Personal link', hint: 'Opens this gallery directly', via: 'whatsapp' },
  { key: 'android', title: 'Android app', hint: 'Play Store link', via: 'android' },
  { key: 'ios', title: 'iOS app', hint: 'App Store link', via: 'ios' },
  { key: 'all', title: 'Full message', hint: 'The WhatsApp message: gallery link and Customer Code', via: 'all' },
]

/**
 * Send/Share: the customer's 6-digit code and links: copy the link, QR code, SMS, WhatsApp, plus
 * Send options for each link (web sign-in, personal link, Android/iOS apps) and the full message.
 * Links use the public address only (VITE_PUBLIC_APP_URL), never this computer. The first share
 * marks the selection Shared; each one is logged in Client Activity.
 */
export function ShareModal({ selection, onClose }: { selection: SelectionDto; onClose: () => void }) {
  const qc = useQueryClient()
  const { studio, user } = useMe()
  const [code, setCode] = useState(selection.code)
  const [copied, setCopied] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const link = shareLink(selection.publicToken)
  const links: ShareLinks = { personal: link, web: appLinks.web, android: appLinks.android, ios: appLinks.ios }
  const phone = selection.client.phone
  const event = { customerName: selection.client.name, eventTitle: selection.event.title, code }
  const from = { name: studio.name, phone: studio.phone ?? user.phone ?? null }
  /** The one customer message: Send on WhatsApp, Send SMS, Copy message and the full message all use it. */
  const message = buildCustomerMessage({ ...event, shareToken: selection.publicToken, studio: from }) ?? ''
  const messageFor = (key: ShareLinkKey | 'all') => (key === 'all' ? message : buildOptionMessage(event, from, links, key))
  const oldCode = !CLIENT_CODE_RE.test(code)
  /** Nothing with a link can go out until the public address is set. */
  const blocked = oldCode || !link

  /** Logs the share (and, the first time, marks the selection Shared). */
  const record = (via: SendVia) =>
    api
      .patch(`/selections/${selection.id}/sent`, { via })
      .then(() => refreshSelection(qc, selection.id))
      .catch(toastError)

  /** Copies `text`; `toastText` defaults to "<what> copied". */
  const copy = async (text: string, id: string, what: string, toastText = `${what} copied`) => {
    if (!(await copyToClipboard(text))) {
      toast.error('Could not copy — your browser blocked the clipboard')
      return
    }
    toast.success(toastText)
    setCopied(id)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(null), 2000)
    void record('link')
  }
  const copyMessage = (id: string) => void copy(message, id, 'Message', 'Message copied. Paste it in WhatsApp.')

  // Opened inside the click, so popup blockers allow them. api.whatsapp.com/send directly: wa.me
  // redirects there, and the redirect can turn the 📸 into "�".
  const sendWhatsApp = (text: string, via: SendVia) => {
    window.open(whatsappSendUrl(phone, text), '_blank', 'noopener,noreferrer')
    toast.success('Opening WhatsApp…')
    void record(via)
  }
  const openSms = () => {
    window.location.assign(smsUrl(phone, message))
    void record('sms')
  }
  const openQr = () => {
    setShowQr(true)
    void record('qr')
  }

  const renewCode = async () => {
    setRenewing(true)
    try {
      const s = await api.post<SelectionDto>(`/selections/${selection.id}/new-code`)
      setCode(s.code)
      refreshSelection(qc, selection.id)
      toast.success(`New code ${s.code}`)
    } catch (e) {
      toastError(e)
    } finally {
      setRenewing(false)
    }
  }

  const rows = OPTION_ROWS.filter((r) => r.key === 'all' || links[r.key])

  return (
    <Modal open onClose={onClose} title="Send/Share" subtitle={`${selection.event.title} · ${selection.client.name}`} size="lg" className="so-modal sh-modal">
      {oldCode ? (
        <div className="so-old-code" role="note">
          <span>
            Code <strong className="mono">{code}</strong> is an older code. Customers need a 6-digit code.
          </span>
          <button type="button" className="so-btn solid" onClick={() => void renewCode()} disabled={renewing}>
            {renewing ? 'Getting code…' : 'Get a 6-digit code'}
          </button>
        </div>
      ) : (
        <p className="sh-code">
          Customer Code <strong className="mono" data-testid="share-code">{code}</strong>
        </p>
      )}
      {link && lanLinksAllowed && isPrivateNetworkUrl(link) && (
        <p className="sh-no-domain" role="note" data-testid="lan-links">
          <i className="bi bi-info-circle" aria-hidden="true" /> Wi-Fi testing: this link opens only on phones connected to the same Wi-Fi as this computer.
        </p>
      )}
      {!link && (
        <p className="sh-no-domain" role="alert" data-testid="no-public-url">
          <i className="bi bi-exclamation-triangle" aria-hidden="true" /> Links can’t be sent yet: this site has no public web address. Set{' '}
          <code>VITE_PUBLIC_APP_URL</code> (e.g. https://studio.yourdomain.com) in the web app’s settings. Links never point to this computer.
        </p>
      )}
      <div className="sh-grid">
        <section className="sh-card" aria-labelledby="sh-link">
          <i className="bi bi-link-45deg sh-icon" aria-hidden="true" />
          <h3 id="sh-link">Copy Link</h3>
          <p className="sh-text mono" title={link ?? undefined}>
            {link ?? '—'}
          </p>
          {/* The same message Send on WhatsApp sends, to paste in any chat. */}
          <button type="button" className="sh-btn" onClick={() => copyMessage('card')} disabled={blocked} data-testid="copy-message">
            {copied === 'card' ? 'Copied ✓' : 'Copy message'}
          </button>
          <div className="sh-card-more">
            <button type="button" className="sh-mini" onClick={() => link && void copy(link, 'link-only', 'Link')} disabled={blocked} data-testid="copy-link-only">
              {copied === 'link-only' ? 'Copied ✓' : 'Copy link only'}
            </button>
            <button
              type="button"
              className="sh-mini"
              onClick={() => void copy(whatsappMeUrl(phone, message), 'wa-link', 'WhatsApp link', 'WhatsApp link copied. Opening it starts WhatsApp with the message ready.')}
              disabled={blocked}
              data-testid="copy-wa-link"
            >
              {copied === 'wa-link' ? 'Copied ✓' : 'Copy WhatsApp link'}
            </button>
          </div>
        </section>
        <section className="sh-card" aria-labelledby="sh-qr">
          <i className="bi bi-qr-code sh-icon" aria-hidden="true" />
          <h3 id="sh-qr">QR Code</h3>
          {showQr && link ? (
            <QrCode value={link} fileName={`${selection.event.title}-qr`.replace(/[^\w-]+/g, '-')} size={150} />
          ) : (
            <>
              <p className="sh-text">Scan to open the gallery on a phone.</p>
              <button type="button" className="sh-btn" onClick={openQr} disabled={blocked}>
                Show QR Code
              </button>
            </>
          )}
        </section>
        <section className="sh-card" aria-labelledby="sh-sms">
          <i className="bi bi-chat-dots sh-icon" aria-hidden="true" />
          <h3 id="sh-sms">SMS</h3>
          <p className="sh-text">{phone ? `To ${phone}` : 'Your messages app asks who to send it to.'}</p>
          <button type="button" className="sh-btn" onClick={openSms} disabled={blocked}>
            Send SMS
          </button>
        </section>
        <section className="sh-card" aria-labelledby="sh-wa">
          <i className="bi bi-whatsapp sh-icon" aria-hidden="true" />
          <h3 id="sh-wa">WhatsApp</h3>
          <p className="sh-text">{phone ? `To ${phone}` : 'WhatsApp asks who to send it to.'}</p>
          <button type="button" className="sh-btn" onClick={() => sendWhatsApp(message, 'whatsapp')} disabled={blocked}>
            Send on WhatsApp
          </button>
        </section>
      </div>

      <section className="sh-options" aria-labelledby="sh-options-title" data-testid="send-options">
        <h3 id="sh-options-title">Send options</h3>
        <ul>
          {rows.map((r) => {
            const value = r.key === 'all' ? messageFor('all') : links[r.key]!
            return (
              <li key={r.key} className="sh-option">
                <div className="sh-option-text">
                  <strong>{r.title}</strong>
                  <span className={r.key === 'all' ? '' : 'mono'} title={value}>
                    {r.key === 'all' ? r.hint : value}
                  </span>
                </div>
                <div className="sh-option-actions">
                  <button
                    type="button"
                    className="sh-mini"
                    onClick={() => (r.key === 'all' ? copyMessage(r.key) : void copy(value, r.key, r.title))}
                    disabled={blocked}
                    aria-label={r.key === 'all' ? 'Copy full message' : `Copy ${r.title}`}
                  >
                    {copied === r.key ? 'Copied ✓' : r.key === 'all' ? 'Copy full message' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    className="sh-mini solid"
                    onClick={() => sendWhatsApp(messageFor(r.key), r.via)}
                    disabled={blocked}
                    aria-label={`Send ${r.title} via WhatsApp`}
                  >
                    <i className="bi bi-whatsapp" aria-hidden="true" /> Send via WhatsApp
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <details className="sh-preview">
        <summary>Full message preview</summary>
        <pre data-testid="full-message">{messageFor('all')}</pre>
      </details>
    </Modal>
  )
}