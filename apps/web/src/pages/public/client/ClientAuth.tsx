import { CLIENT_CODE_RE, ERROR_CODES, type ClientVerifyResult } from '@weddyzone/shared'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { isApiError, request } from '../../../lib/api'
import { clientSession } from '../../../lib/clientSession'
import { APP_NAME } from '../../../lib/env'
import { AppMark } from './ClientParts'

/** What the customer sees for each failure (the spec's wording, not the API's). */
function messageFor(e: unknown): { text: string; needsPin?: boolean } {
  if (!isApiError(e)) return { text: 'Something went wrong. Please try again.' }
  switch (e.code) {
    case ERROR_CODES.NOT_FOUND:
    case ERROR_CODES.VALIDATION:
      return { text: 'Invalid code' }
    case ERROR_CODES.GALLERY_CLOSED:
      return { text: 'This gallery is not available' }
    case ERROR_CODES.GALLERY_EXPIRED:
      return { text: 'This gallery has expired' }
    case ERROR_CODES.PIN_REQUIRED:
      return { text: e.fields?.pin ? e.message : 'This gallery also has a 4-digit PIN. Enter it below.', needsPin: true }
    default:
      return { text: e.message }
  }
}

const digits = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max)

/** /selection/auth: the customer enters the 6-digit code from the studio's message. */
export default function ClientAuth() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [code, setCode] = useState(() => digits(params.get('code') ?? '', 6))
  const [pin, setPin] = useState('')
  const [needsPin, setNeedsPin] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(0)
  const [busy, setBusy] = useState(false)

  const ready = CLIENT_CODE_RE.test(code) && (!needsPin || pin.length === 4)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await request<ClientVerifyResult>('POST', '/public/selection/verify', { body: { code, ...(needsPin ? { pin } : {}) } })
      clientSession.set(r.selectionId, r.token)
      if (r.submitted) toast.info('Selection already submitted', { description: 'You can still view your photos.' })
      navigate(`/selection/${r.selectionId}`)
    } catch (err) {
      const m = messageFor(err)
      if (m.needsPin) setNeedsPin(true)
      setError(m.text)
      setShake((n) => n + 1)
      setBusy(false)
    }
  }

  return (
    <div className="ca-page">
      <Link to="/login" className="ca-studio-login">
        Studio Login →
      </Link>
      <main className="ca-card" key={shake} data-shake={shake > 0 ? 'true' : undefined}>
        <AppMark className="ca-logo" />
        <h1 className="ca-title">Welcome 🎉</h1>
        <p className="ca-sub">Enter your access code to view &amp; select your photos</p>
        <form onSubmit={submit} noValidate>
          <label htmlFor="ca-code" className="sr-only">
            Access code
          </label>
          <input
            id="ca-code"
            className="ca-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="••••••"
            autoFocus
            value={code}
            onChange={(e) => {
              setCode(digits(e.target.value, 6))
              setError(null)
            }}
            aria-invalid={!!error}
            aria-describedby={error ? 'ca-error' : undefined}
          />
          {needsPin && (
            <>
              <label htmlFor="ca-pin" className="ca-pin-label">
                Gallery PIN
              </label>
              <input
                id="ca-pin"
                className="ca-code ca-pin"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
                autoFocus
                value={pin}
                onChange={(e) => {
                  setPin(digits(e.target.value, 4))
                  setError(null)
                }}
              />
            </>
          )}
          <p id="ca-error" className="ca-error" role="alert">
            {error}
          </p>
          <button type="submit" className="ca-submit" disabled={!ready || busy}>
            {busy ? 'Checking…' : 'Verify & Continue'}
          </button>
        </form>
        <p className="ca-foot">
          🔒 Secure access · Powered by {APP_NAME}
        </p>
      </main>
    </div>
  )
}
