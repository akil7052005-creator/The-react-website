import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { pickedLabel, type PublicSelectionDto, type PublicSelectionLockedDto } from '@weddyzone/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useConfirm } from '../../components/Modal'
import { Avatar, EmptyState, ErrorState, Progress, Skeleton, Spinner } from '../../components/ui'
import { isApiError, request } from '../../lib/api'
import { fileUrl } from '../../lib/env'
import { toastError } from '../../lib/query'
import { formatDate } from '../../utils/format'

type Photo = PublicSelectionDto['photos'][number]
type Filter = 'all' | 'picked'
type View = 'gallery' | 'review'
/** Tiles drawn at first on a phone; more as the client scrolls to "Show more". */
const PAGE = 60

function useStored(key: string) {
  const [value, setValue] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  })
  const save = useCallback(
    (v: string) => {
      setValue(v)
      try {
        if (v) localStorage.setItem(key, v)
        else localStorage.removeItem(key)
      } catch {
        /* private mode: remembered for this visit only */
      }
    },
    [key],
  )
  return [value, save] as const
}

/** Calls the public selection API with the gallery key (when the gallery has a PIN). */
function gallery(token: string, key: string) {
  const headers = key ? { 'X-Gallery-Key': key } : undefined
  const base = `/public/selections/${token}`
  return {
    view: () => request<PublicSelectionDto>('GET', base, { headers }),
    pin: (pin: string) => request<{ key: string | null }>('POST', `${base}/pin`, { body: { pin } }),
    pick: (body: { photoId: string; memberId: string; picked: boolean }) =>
      request<{ pickedCount: number; pickedBy: string[]; photoId: string }>('POST', `${base}/picks`, { body, headers }),
    comment: (body: { photoId: string; memberId: string; text: string }) => request('POST', `${base}/comments`, { body, headers }),
    submit: (memberId: string) => request<PublicSelectionDto>('POST', `${base}/submit`, { body: { memberId }, headers }),
  }
}

function PinScreen({ info, onKey, token }: { info: PublicSelectionLockedDto; onKey: (k: string) => void; token: string }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (value = pin) => {
    if (!/^\d{4}$/.test(value)) return setError('Enter the 4 digits')
    setBusy(true)
    try {
      const r = await gallery(token, '').pin(value)
      onKey(r.key ?? '')
    } catch (e) {
      setPin('')
      setError(isApiError(e) ? e.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="cg-shell cg-pin-shell">
      <form
        className="cg-pin card"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        noValidate
      >
        <Avatar name={info.studio.name} src={info.studio.logoUrl} size={56} />
        <p className="eyebrow">{info.studio.name}</p>
        <h1>{info.eventTitle}</h1>
        <p className="muted">Enter the 4-digit PIN your photographer sent you.</p>
        <label className="sr-only" htmlFor="gallery-pin">
          PIN
        </label>
        <input
          id="gallery-pin"
          className="input cg-pin-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={4}
          value={pin}
          aria-invalid={!!error}
          aria-describedby={error ? 'pin-error' : undefined}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 4)
            setPin(v)
            setError('')
            if (v.length === 4) void submit(v)
          }}
        />
        {error && (
          <p className="field-error" id="pin-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary cg-wide" disabled={busy || pin.length !== 4}>
          {busy ? <Spinner size={14} /> : <i className="bi bi-unlock" />} Open gallery
        </button>
        {info.studio.phone && (
          <p className="muted cg-small">
            No PIN? Call {info.studio.name} on <a href={`tel:${info.studio.phone}`}>{info.studio.phone}</a>.
          </p>
        )}
      </form>
    </div>
  )
}

function NoteBox({ disabled, onSave }: { disabled: boolean; onSave: (text: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="cg-note-form"
      onSubmit={async (e) => {
        e.preventDefault()
        const t = text.trim()
        if (!t) return
        setBusy(true)
        try {
          await onSave(t)
          setText('')
        } finally {
          setBusy(false)
        }
      }}
    >
      <label className="sr-only" htmlFor="cg-note">
        Note for your photographer
      </label>
      <textarea id="cg-note" className="input" rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="Note for your photographer, e.g. brighten this one" disabled={disabled} />
      <button className="btn btn-sm btn-ghost" disabled={disabled || busy || !text.trim()}>
        {busy ? <Spinner size={12} /> : <i className="bi bi-chat" />} Add note
      </button>
    </form>
  )
}

export default function PublicSelection() {
  const { token = '' } = useParams()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [key, setKey] = useStored(`wz-gallery-key-${token}`)
  const [memberId, setMemberId] = useStored(`wz-member-${token}`)
  const [folder, setFolderRaw] = useState('')
  const [filter, setFilterRaw] = useState<Filter>('all')
  const [view, setView] = useState<View>('gallery')
  const [open, setOpen] = useState<number | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const setFolder = (v: string) => {
    setFolderRaw(v)
    setShown(PAGE)
  }
  const setFilter = (v: Filter) => {
    setFilterRaw(v)
    setShown(PAGE)
  }
  const api = useMemo(() => gallery(token, key), [token, key])
  const qk = ['public-selection', token, key]

  const q = useQuery({ queryKey: qk, queryFn: api.view, retry: false })
  const data = q.data
  const member = data?.members.find((m) => m.id === memberId)

  useEffect(() => {
    if (data && !member && data.members.length === 1) setMemberId(data.members[0].id)
  }, [data, member, setMemberId])
  useEffect(() => {
    if (data) document.title = `${data.eventTitle} · Photo selection`
  }, [data])
  // A stored key stops working when the studio changes the PIN: forget it and ask again.
  const pinAsked = isApiError(q.error) && q.error.code === 'PIN_REQUIRED'
  useEffect(() => {
    if (pinAsked && key) setKey('')
  }, [pinAsked, key, setKey])

  const pick = useMutation({
    mutationFn: (v: { photoId: string; picked: boolean }) => api.pick({ ...v, memberId }),
    onMutate: (v) => setPending(v.photoId),
    onSuccess: (r) => {
      qc.setQueryData<PublicSelectionDto>(qk, (d) => (d ? { ...d, pickedCount: r.pickedCount, photos: d.photos.map((p) => (p.id === r.photoId ? { ...p, pickedBy: r.pickedBy } : p)) } : d))
    },
    onError: (e) => {
      if (isApiError(e) && e.code === 'QUOTA_LOCKED') toast.warning(e.message, { id: 'quota' })
      else if (isApiError(e) && (e.code === 'READ_ONLY' || e.code === 'PIN_REQUIRED')) {
        toast.error(e.message)
        void q.refetch()
      } else toastError(e)
    },
    onSettled: () => setPending(null),
  })

  // ---------------------------------------------------------------- loading / errors / PIN

  if (q.isPending) {
    return (
      <div className="cg-shell">
        <div className="cg-wrap">
          <Skeleton width={220} height={26} style={{ margin: '16px 0' }} />
          <div className="cg-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} height={160} radius={10} />
            ))}
          </div>
        </div>
      </div>
    )
  }
  if (q.isError || !data) {
    const e = q.error
    if (isApiError(e) && e.code === 'PIN_REQUIRED' && e.details) {
      return <PinScreen info={e.details as unknown as PublicSelectionLockedDto} token={token} onKey={(k) => setKey(k)} />
    }
    const notFound = isApiError(e) && e.status === 404
    return (
      <div className="cg-shell">
        <div className="cg-wrap">
          <div className="card" style={{ marginTop: 24 }}>
            {notFound ? (
              <EmptyState icon="link-45deg" title="This link isn't available" text="The gallery may have been removed. Please ask your photographer for a new link." />
            ) : (
              <ErrorState error={e} onRetry={() => q.refetch()} />
            )}
          </div>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------- gallery

  const full = data.pickedCount >= data.quota
  const folders = data.folders ?? []
  const inFolder = folder ? data.photos.filter((p) => p.folderId === folder) : data.photos
  const photos = view === 'review' ? data.photos.filter((p) => p.pickedBy.length) : inFolder.filter((p) => (filter === 'picked' ? p.pickedBy.length > 0 : true))
  const current = open !== null ? photos[open] : null
  const myPick = (p: Photo) => p.pickedBy.includes(memberId)
  const notesOn = data.notesAllowed !== false

  const toggle = (p: Photo) => {
    if (data.readOnly) return
    if (!member) {
      toast.info('First choose who is picking', { id: 'who' })
      return
    }
    if (!myPick(p) && full && p.pickedBy.length === 0) {
      toast.warning(`You've picked all ${data.quota} photos. Remove one to choose another.`, { id: 'quota' })
      return
    }
    pick.mutate({ photoId: p.id, picked: !myPick(p) })
  }

  const addNote = async (p: Photo, text: string) => {
    try {
      await api.comment({ photoId: p.id, memberId, text })
      toast.success('Note added')
      await q.refetch()
    } catch (e) {
      toastError(e)
      throw e
    }
  }

  const submit = () =>
    confirm({
      title: 'Submit your selection?',
      message: (
        <>
          You're sending <strong>{data.pickedCount}</strong> of {data.quota} photos to {data.studio.name}. After this the selection is locked — ask {data.studio.name} if you need to change it.
        </>
      ),
      confirmLabel: 'Submit selection',
      icon: 'send-check',
      onConfirm: async () => {
        try {
          const d = await api.submit(memberId || data.members[0].id)
          qc.setQueryData(qk, d)
          setView('gallery')
          toast.success('Selection submitted — thank you! Your photographer has been notified.')
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  return (
    <div className="cg-shell">
      <header className="cg-head">
        <div className="cg-wrap cg-head-inner">
          <div className="cg-brand">
            <Avatar name={data.studio.name} src={data.studio.logoUrl} size={34} />
            <div>
              <strong>{data.studio.name}</strong>
              <small>{data.eventTitle}</small>
            </div>
          </div>
          <div className="cg-counter" aria-live="polite">
            <strong data-testid="client-counter">{pickedLabel(data.pickedCount, data.quota)}</strong>
            <Progress value={data.pickedCount} max={data.quota} label="Photos picked" />
          </div>
        </div>
      </header>

      <main className="cg-wrap cg-main">
        {view === 'gallery' ? (
          <div className="cg-intro">
            <h1>{data.eventTitle}</h1>
            <p className="muted">
              Tap <i className="bi bi-heart" aria-label="the heart" /> on your favourites — up to {data.quota}. Open until {formatDate(data.deadline)}.
            </p>
          </div>
        ) : (
          <div className="cg-intro">
            <button className="link cg-back" onClick={() => setView('gallery')}>
              <i className="bi bi-arrow-left" /> Back to all photos
            </button>
            <h1>Review your picks</h1>
            <p className="muted">
              {data.pickedCount} of {data.quota} photos. Tap a photo to remove it or add a note.
            </p>
          </div>
        )}

        {(data.status === 'SUBMITTED' || data.status === 'DELIVERED') && (
          <p className="notice success" role="status">
            <i className="bi bi-check2-circle" /> Your selection was submitted. It's locked now — contact {data.studio.name} if you need changes.
          </p>
        )}
        {data.status === 'EXPIRED' && (
          <p className="notice warning" role="status">
            <i className="bi bi-hourglass-bottom" /> This gallery has expired. Please contact {data.studio.name} to reopen it.
          </p>
        )}
        {!data.readOnly && full && view === 'gallery' && (
          <p className="notice warning" role="status" data-testid="quota-lock">
            <i className="bi bi-lock-fill" /> You've picked all {data.quota}. Remove a heart to choose a different photo.
          </p>
        )}

        {!data.readOnly && data.members.length > 1 && (
          <div className="cg-members" role="radiogroup" aria-label="Who is picking?">
            <span className="muted">Picking as</span>
            {data.members.map((m) => (
              <button key={m.id} role="radio" aria-checked={memberId === m.id} className={`chip${memberId === m.id ? ' on' : ''}`} onClick={() => setMemberId(m.id)}>
                {m.name} <small>{m.pickCount} ♥</small>
              </button>
            ))}
          </div>
        )}

        {view === 'gallery' && (
          <>
            {folders.length > 1 && (
              <nav className="cg-folders" aria-label="Folders">
                <button className={!folder ? 'on' : ''} aria-pressed={!folder} onClick={() => setFolder('')}>
                  All <small>{data.photos.length}</small>
                </button>
                {folders.map((f) => (
                  <button key={f.id} className={folder === f.id ? 'on' : ''} aria-pressed={folder === f.id} onClick={() => setFolder(f.id)}>
                    {f.name} <small>{f.photoCount}</small>
                  </button>
                ))}
              </nav>
            )}
            <div className="cg-filter tabs" role="tablist">
              {(
                [
                  ['all', `All (${inFolder.length})`],
                  ['picked', `Picked (${inFolder.filter((p) => p.pickedBy.length).length})`],
                ] as [Filter, string][]
              ).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        {photos.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="heart"
              title={view === 'review' || filter === 'picked' ? 'Nothing picked yet' : 'No photos yet'}
              text={view === 'review' || filter === 'picked' ? 'Tap the heart on a photo to pick it.' : 'Your photographer is still uploading.'}
            />
          </div>
        ) : (
          <div className="cg-grid">
            {photos.slice(0, shown).map((p, i) => {
              const mine = myPick(p)
              const locked = !data.readOnly && full && p.pickedBy.length === 0
              return (
                <figure key={p.id} className={`cg-tile${p.pickedBy.length ? ' is-picked' : ''}${locked ? ' is-locked' : ''}`}>
                  <button className="cg-open" onClick={() => setOpen(i)} aria-label={`Open ${p.originalName}`}>
                    <img src={fileUrl(p.url)} alt={p.originalName} loading="lazy" decoding="async" />
                  </button>
                  {!data.readOnly ? (
                    <button
                      className={`cg-heart${mine ? ' on' : ''}`}
                      onClick={() => toggle(p)}
                      aria-pressed={mine}
                      aria-label={mine ? `Remove heart from ${p.originalName}` : `Heart ${p.originalName}`}
                      disabled={pending === p.id}
                    >
                      {pending === p.id ? <Spinner size={14} /> : <i className={`bi bi-heart${mine ? '-fill' : ''}`} />}
                    </button>
                  ) : (
                    p.pickedBy.length > 0 && (
                      <span className="cg-heart on" aria-label="Picked">
                        <i className="bi bi-heart-fill" />
                      </span>
                    )
                  )}
                  {p.comments.length > 0 && (
                    <span className="cg-note-badge" aria-label={`${p.comments.length} notes`}>
                      <i className="bi bi-chat-fill" />
                    </span>
                  )}
                </figure>
              )
            })}
          </div>
        )}
        {photos.length > shown && (
          <div className="cg-more">
            <button className="btn btn-ghost" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({photos.length - shown})
            </button>
          </div>
        )}
      </main>

      {!data.readOnly && (
        <footer className="cg-bar">
          <div className="cg-wrap cg-bar-inner">
            <span>
              <strong>{data.pickedCount}</strong> / {data.quota}
              {member && data.members.length > 1 ? <small> · {member.name}</small> : null}
            </span>
            {view === 'gallery' ? (
              <button className="btn btn-primary" onClick={() => setView('review')} disabled={data.pickedCount === 0} data-testid="review-button">
                <i className="bi bi-list-check" /> Review & submit
              </button>
            ) : (
              <button className="btn btn-primary" onClick={submit} disabled={data.pickedCount === 0}>
                <i className="bi bi-send-check" /> Submit {data.pickedCount}
              </button>
            )}
          </div>
        </footer>
      )}

      {current && (
        <div className="cg-viewer" role="dialog" aria-modal="true" aria-label={current.originalName}>
          <div className="cg-viewer-top">
            <button className="icon-btn" onClick={() => setOpen(null)} aria-label="Close">
              <i className="bi bi-x-lg" />
            </button>
            <span className="cg-small">
              {open! + 1} / {photos.length}
            </span>
            {current.downloadUrl ? (
              <a className="icon-btn" href={fileUrl(current.downloadUrl)} download aria-label="Download original">
                <i className="bi bi-download" />
              </a>
            ) : (
              <span />
            )}
          </div>
          <div className="cg-viewer-stage">
            <button className="icon-btn cg-nav" onClick={() => setOpen((o) => (o! > 0 ? o! - 1 : o))} disabled={open === 0} aria-label="Previous photo">
              <i className="bi bi-chevron-left" />
            </button>
            <img src={fileUrl(current.url)} alt={current.originalName} />
            <button className="icon-btn cg-nav" onClick={() => setOpen((o) => (o! < photos.length - 1 ? o! + 1 : o))} disabled={open === photos.length - 1} aria-label="Next photo">
              <i className="bi bi-chevron-right" />
            </button>
          </div>
          <div className="cg-viewer-side">
            {!data.readOnly && (
              <button className={`btn ${myPick(current) ? 'btn-primary' : 'btn-ghost'} cg-wide`} onClick={() => toggle(current)} disabled={pending === current.id}>
                <i className={`bi bi-heart${myPick(current) ? '-fill' : ''}`} /> {myPick(current) ? 'Picked' : 'Pick this photo'}
              </button>
            )}
            {current.comments.length > 0 && (
              <ul className="lb-comments">
                {current.comments.map((c, i) => (
                  <li key={i}>
                    <strong>{c.memberName}</strong> {c.text}
                  </li>
                ))}
              </ul>
            )}
            {!data.readOnly && notesOn && member && <NoteBox disabled={false} onSave={(t) => addNote(current, t)} />}
          </div>
        </div>
      )}
    </div>
  )
}
