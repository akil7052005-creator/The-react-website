import { useQuery } from '@tanstack/react-query'
import { ERROR_CODES, type ClientLinkDto, type ClientVerifyResult } from '@weddyzone/shared'
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { isApiError, request } from '../../../lib/api'
import { clientSession } from '../../../lib/clientSession'
import { APP_NAME, fileUrl } from '../../../lib/env'
import { AppMark } from './ClientParts'

const LENGTH = 6

/** Minutes until a lock ends, at least 1. */
const minutesLeft = (iso: string, now: number) => Math.max(1, Math.ceil((new Date(iso).getTime() - now) / 60_000))

/** Six one-digit boxes: typing moves on, Backspace moves back, a pasted code fills them all. */
function CodeBoxes({ value, onChange, disabled, invalid }: { value: string; onChange: (v: string) => void; disabled: boolean; invalid: boolean }) {
  const boxes = useRef<(HTMLInputElement | null)[]>([])
  const focus = (i: number) => boxes.current[Math.max(0, Math.min(LENGTH - 1, i))]?.focus()

  const setAt = (i: number, digits: string) => {
    const chars = value.padEnd(LENGTH, ' ').split('')
    let at = i
    for (const d of digits) {
      if (at >= LENGTH) break
      chars[at++] = d
    }
    onChange(chars.join('').replace(/\s+$/, '').replace(/ /g, ''))
    focus(at)
  }

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !value[i]) {
      e.preventDefault()
      onChange(value.slice(0, Math.max(0, i - 1)) + value.slice(i))
      focus(i - 1)
    } else if (e.key === 'ArrowLeft') focus(i - 1)
    else if (e.key === 'ArrowRight') focus(i + 1)
  }

  const onPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '')
    if (!digits) return
    e.preventDefault()
    setAt(i, digits)
  }

  return (
    <div className="sv-boxes" role="group" aria-label="Customer code, 6 digits">
      {Array.from({ length: LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el
          }}
          className="sv-box"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          autoFocus={i === 0}
          value={value[i] ?? ''}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '')
            if (digits) setAt(i, digits)
            else onChange(value.slice(0, i) + value.slice(i + 1))
          }}
          onKeyDown={(e) => onKey(i, e)}
          onPaste={(e) => onPaste(i, e)}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  )
}

/** /select/:shareToken — Customer Verification: the 6-digit code from the studio's message opens the gallery. */
export default function SelectVerify() {
  const { shareToken = '' } = useParams()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lockedUntil, setLockedUntil] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  const link = useQuery({
    queryKey: ['client-link', shareToken],
    queryFn: () => request<ClientLinkDto>('GET', `/public/selection/link/${encodeURIComponent(shareToken)}`),
    retry: (n, e) => !isApiError(e) && n < 2,
  })
  const locked = lockedUntil ?? link.data?.lockedUntil ?? null
  const isLocked = !!locked && new Date(locked).getTime() > now

  // Refresh the minutes left on a lock, and unlock when it ends.
  useEffect(() => {
    if (!isLocked) return
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [isLocked])

  const submit = async (code: string) => {
    if (code.length !== LENGTH || busy || isLocked) return
    setBusy(true)
    setError(null)
    try {
      const r = await request<ClientVerifyResult>('POST', '/public/selection/verify', { body: { code, shareToken } })
      clientSession.set(r.selectionId, r.token)
      clientSession.setLink(r.selectionId, shareToken)
      if (r.submitted) toast.info('Selection already submitted', { description: 'You can still view your photos.' })
      navigate(`/selection/${r.selectionId}`, { replace: true })
    } catch (err) {
      if (isApiError(err) && err.code === ERROR_CODES.PIN_LOCKED) {
        setNow(Date.now())
        setLockedUntil(String(err.details?.retryAt ?? new Date(Date.now() + 10 * 60_000).toISOString()))
        setError(err.message)
      } else if (isApiError(err) && (err.code === ERROR_CODES.NOT_FOUND || err.code === ERROR_CODES.VALIDATION)) {
        setError(err.code === ERROR_CODES.VALIDATION ? 'Invalid code' : err.message)
      } else if (isApiError(err) && err.code === ERROR_CODES.PIN_REQUIRED) {
        // A gallery PIN as well: the code-and-PIN page handles it.
        navigate(`/selection/auth?code=${code}`)
        return
      } else {
        setError(isApiError(err) ? err.message : 'Something went wrong. Please try again.')
      }
      setCode('')
      setShake((n) => n + 1)
      setBusy(false)
    }
  }

  const linkError = isApiError(link.error) ? link.error.code : null
  const closed = linkError === ERROR_CODES.GALLERY_CLOSED || linkError === ERROR_CODES.GALLERY_EXPIRED || linkError === ERROR_CODES.NOT_FOUND
  const studio = link.data?.studio

  return (
    <div className="sv-page">
      <main className="sv-card" key={shake} data-shake={shake > 0 ? 'true' : undefined}>
        {studio?.logoUrl ? <img className="sv-logo" src={fileUrl(studio.logoUrl)} alt={studio.name} /> : <AppMark className="sv-logo sv-mark" />}
        {studio && <p className="sv-studio">{studio.name}</p>}
        <h1 className="sv-welcome">Welcome</h1>
        <h2 className="sv-title">Customer Verification</h2>
        {closed ? (
          <p className="sv-error" role="alert">
            {linkError === ERROR_CODES.GALLERY_EXPIRED
              ? 'This gallery has expired. Please contact your photographer.'
              : linkError === ERROR_CODES.NOT_FOUND
                ? 'This link is not valid. Please ask your photographer for a new one.'
                : 'This gallery is not available right now. Please contact your photographer.'}
          </p>
        ) : (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              void submit(code)
            }}
            noValidate
          >
            <p className="sv-sub">{link.data ? `Enter the 6-digit Customer Code for ${link.data.eventName}` : 'Enter the 6-digit Customer Code from your message'}</p>
            <CodeBoxes
              value={code}
              onChange={(v) => {
                setCode(v)
                if (error && !isLocked) setError(null)
                // Verify as soon as the sixth digit is in.
                if (v.length === LENGTH) void submit(v)
              }}
              disabled={busy || isLocked}
              invalid={!!error}
            />
            <p className="sv-error" role="alert">
              {isLocked ? `Too many wrong codes. Try again in ${minutesLeft(locked!, now)} minute${minutesLeft(locked!, now) === 1 ? '' : 's'}.` : error}
            </p>
            <button type="submit" className="sv-submit" disabled={code.length !== LENGTH || busy || isLocked}>
              {busy ? 'Checking…' : 'Verify'}
            </button>
          </form>
        )}
        <p className="sv-foot">🔒 Secure access · Powered by {APP_NAME}</p>
      </main>
    </div>
  )
}
