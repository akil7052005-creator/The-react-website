import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isSelectionLocked, isSelectionUnshared, type MessagePreviewDto, type SelectionDto, type SendResultDto } from '@weddyzone/shared'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { toastError } from '../../lib/query'
import { copyText, publicLink, sendViaWhatsApp } from '../../lib/whatsapp'
import { formatDate, timeAgo } from '../../utils/format'
import { useConfirm } from '../Modal'
import { Spinner } from '../ui'
import WhatsAppPreviewModal from '../WhatsAppPreviewModal'
import { QrCode } from './QrCode'
import { refreshSelection } from './selectionUi'

/** Setting, changing or removing the 4-digit gallery PIN. The PIN is shown once, right after it's set. */
function PinCard({ s }: { s: SelectionDto }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [justSet, setJustSet] = useState<string | null>(null)

  const save = async (value: string | null) => {
    if (value !== null && !/^\d{4}$/.test(value)) return setError('Enter 4 digits')
    setBusy(true)
    try {
      await api.patch(`/selections/${s.id}/access`, { pin: value ?? '' })
      refreshSelection(qc, s.id)
      setPin('')
      setJustSet(value)
      toast.success(value ? 'PIN saved — send it to the client with the link' : 'PIN removed — anyone with the link can open the gallery')
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card sw-card" aria-labelledby="pin-title">
      <h3 id="pin-title">
        <i className="bi bi-shield-lock" /> Gallery PIN <small className="muted">optional</small>
      </h3>
      <p className="muted">
        {s.hasPin ? 'The client must enter the PIN to open the gallery. 5 wrong tries lock it for 15 minutes.' : 'Anyone with the link can open the gallery. Add a 4-digit PIN for extra privacy.'}
      </p>
      {justSet && (
        <p className="notice success" role="status">
          <i className="bi bi-key" /> PIN <strong className="mono">{justSet}</strong> — share it with the client. It won't be shown again.{' '}
          <button className="link" onClick={() => void copyText(justSet, 'PIN')}>
            Copy PIN
          </button>
        </p>
      )}
      <form
        className="sw-pin-row"
        onSubmit={(e) => {
          e.preventDefault()
          void save(pin)
        }}
        noValidate
      >
        <label className="sr-only" htmlFor="sel-pin">
          {s.hasPin ? 'New PIN' : 'PIN'}
        </label>
        <input
          id="sel-pin"
          className="input sw-pin-input"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          placeholder={s.hasPin ? 'New PIN' : '4 digits'}
          value={pin}
          aria-invalid={!!error}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, '').slice(0, 4))
            setError('')
          }}
        />
        <button className="btn btn-primary" disabled={busy || pin.length !== 4}>
          {busy ? <Spinner size={14} /> : <i className="bi bi-check2" />} {s.hasPin ? 'Change PIN' : 'Set PIN'}
        </button>
        {s.hasPin && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() =>
              void confirm({
                title: 'Remove the PIN?',
                message: 'Anyone with the link will be able to open the gallery.',
                confirmLabel: 'Remove PIN',
                tone: 'danger',
                onConfirm: () => save(null),
              })
            }
          >
            Remove PIN
          </button>
        )}
      </form>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

export function EventShare({ s }: { s: SelectionDto }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [preview, setPreview] = useState(false)
  const link = publicLink('selection', s.publicToken)
  const closed = isSelectionLocked(s.status) || s.status === 'EXPIRED'
  const kind = isSelectionUnshared(s.status) ? 'invite' : 'reminder'
  const previewQ = useQuery({
    queryKey: ['selection-preview', s.id, kind],
    queryFn: () => api.get<MessagePreviewDto>(`/selections/${s.id}/message-preview`, { type: kind }),
    enabled: preview,
  })

  const copy = async () => {
    try {
      await api.post(`/selections/${s.id}/mark-shared`)
      await copyText(link, 'Gallery link')
      refreshSelection(qc, s.id)
    } catch (e) {
      toastError(e)
    }
  }

  const send = () =>
    confirm({
      title: kind === 'invite' ? `Send the gallery to ${s.client.name}?` : `Remind ${s.client.name}?`,
      message: (
        <>
          We'll open WhatsApp with {kind === 'invite' ? 'a message and the private link' : 'a reminder'} for <strong>{s.client.name}</strong> ({s.client.phone}).
          {s.hasPin && ' Send the PIN separately.'} This uses <strong>1 credit</strong>.
        </>
      ),
      confirmLabel: kind === 'invite' ? 'Send on WhatsApp' : 'Send reminder',
      icon: 'whatsapp',
      onConfirm: () =>
        sendViaWhatsApp(
          () => api.post<SendResultDto>(`/selections/${s.id}/${kind === 'invite' ? 'send' : 'remind'}`),
          qc,
          kind === 'invite' ? `Gallery sent to ${s.client.name}` : `Reminder sent to ${s.client.name}`,
        )
          .then(() => refreshSelection(qc, s.id))
          .catch((e) => {
            toastError(e)
            throw e
          }),
    })

  return (
    <div className="sw-share">
      <section className="card sw-card" aria-labelledby="link-title">
        <h3 id="link-title">
          <i className="bi bi-link-45deg" /> Client link
        </h3>
        <div className="code-box">
          <code className="sw-link" data-testid="gallery-link">
            {link}
          </code>
          <button className="btn btn-gold btn-sm" onClick={copy}>
            <i className="bi bi-copy" /> Copy link
          </button>
        </div>
        <div className="share-actions">
          <button className="btn btn-primary" onClick={send} disabled={closed || s.photoCount === 0} title={s.photoCount === 0 ? 'Upload photos first' : undefined}>
            <i className="bi bi-whatsapp" /> {kind === 'invite' ? 'Send on WhatsApp' : 'Send reminder'}
          </button>
          <button className="btn btn-ghost" onClick={() => setPreview(true)}>
            <i className="bi bi-eye" /> Preview message
          </button>
          <a className="btn btn-ghost" href={link} target="_blank" rel="noreferrer">
            <i className="bi bi-box-arrow-up-right" /> Open client view
          </a>
        </div>
        <p className="muted sw-small">
          {s.sharedAt ? `Shared ${formatDate(s.sharedAt)}.` : 'Not shared yet.'}
          {s.lastRemindedAt ? ` Last reminder ${timeAgo(s.lastRemindedAt)}.` : ''} Gallery open until {formatDate(s.deadline)}.
          {s.photoCount === 0 && ' Upload photos before sending.'}
        </p>
      </section>

      <section className="card sw-card sw-qr-card" aria-labelledby="qr-title">
        <h3 id="qr-title">
          <i className="bi bi-qr-code" /> QR code
        </h3>
        <p className="muted">Print it on a thank-you card or show it at the studio.</p>
        <QrCode value={link} fileName={`${s.code}-gallery-qr`} size={180} />
      </section>

      <PinCard s={s} />

      <WhatsAppPreviewModal
        isOpen={preview}
        onClose={() => setPreview(false)}
        preview={previewQ.data}
        loading={previewQ.isPending}
        error={previewQ.isError ? (previewQ.error as Error).message : null}
        onSend={
          !closed && s.photoCount > 0
            ? () => {
                setPreview(false)
                void send()
              }
            : undefined
        }
      />
    </div>
  )
}
