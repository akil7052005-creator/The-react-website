import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { commentSchema, type PublicSelectionDto } from '@weddyzone/shared'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { applyApiErrors, SubmitButton, TextAreaField, useZodForm } from '../../components/form/form'
import { useConfirm } from '../../components/Modal'
import { Avatar, EmptyState, ErrorState, Progress, Skeleton, Spinner } from '../../components/ui'
import { api, isApiError } from '../../lib/api'
import { fileUrl } from '../../lib/env'
import { toastError } from '../../lib/query'
import { formatDate } from '../../utils/format'

type Photo = PublicSelectionDto['photos'][number]
type Filter = 'all' | 'picked' | 'mine'

function useStoredMember(token: string) {
  const key = `wz-member-${token}`
  const [member, setMember] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  })
  const save = (id: string) => {
    setMember(id)
    try {
      localStorage.setItem(key, id)
    } catch {
      /* private mode: remember for this visit only */
    }
  }
  return [member, save] as const
}

function CommentForm({ token, photo, memberId, onAdded }: { token: string; photo: Photo; memberId: string; onAdded: () => void }) {
  const form = useZodForm(commentSchema, { defaultValues: { photoId: photo.id, memberId, text: '' } })
  useEffect(() => {
    form.reset({ photoId: photo.id, memberId, text: '' })
  }, [photo.id, memberId, form])
  const add = useMutation({
    mutationFn: (body: object) => api.post(`/public/selections/${token}/comments`, body),
    onSuccess: () => {
      toast.success('Comment added')
      form.reset({ photoId: photo.id, memberId, text: '' })
      onAdded()
    },
    onError: (e) => applyApiErrors(form, e),
  })
  return (
    <form onSubmit={form.handleSubmit((v) => add.mutate(v))} noValidate className="lb-comment-form">
      <TextAreaField form={form} name="text" label="Add a comment for your photographer" maxLength={500} rows={2} placeholder="e.g. Please brighten this one" />
      <SubmitButton busy={add.isPending} className="btn btn-sm btn-primary" icon="chat">
        Comment
      </SubmitButton>
    </form>
  )
}

export default function PublicSelection() {
  const { token = '' } = useParams()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const key = ['public-selection', token]
  const [memberId, setMemberId] = useStoredMember(token)
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<number | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const q = useQuery({ queryKey: key, queryFn: () => api.get<PublicSelectionDto>(`/public/selections/${token}`), retry: false })
  const data = q.data
  const member = data?.members.find((m) => m.id === memberId)

  useEffect(() => {
    if (data && !member && data.members.length === 1) setMemberId(data.members[0].id)
  }, [data, member, setMemberId])

  useEffect(() => {
    if (data) document.title = `${data.eventTitle} · Photo selection`
  }, [data])

  const pick = useMutation({
    mutationFn: (v: { photoId: string; picked: boolean }) =>
      api.post<{ pickedCount: number; pickedBy: string[]; photoId: string }>(`/public/selections/${token}/picks`, { ...v, memberId }),
    onMutate: (v) => setPending(v.photoId),
    onSuccess: (r) => {
      qc.setQueryData<PublicSelectionDto>(key, (d) =>
        d ? { ...d, pickedCount: r.pickedCount, photos: d.photos.map((p) => (p.id === r.photoId ? { ...p, pickedBy: r.pickedBy } : p)) } : d,
      )
    },
    onError: (e) => {
      if (isApiError(e) && e.code === 'QUOTA_LOCKED') toast.warning(e.message, { id: 'quota' })
      else if (isApiError(e) && e.code === 'READ_ONLY') {
        toast.error(e.message)
        void q.refetch()
      } else toastError(e)
    },
    onSettled: () => setPending(null),
  })

  if (q.isPending) {
    return (
      <div className="public-shell">
        <div className="public-wrap">
          <Skeleton width={260} height={28} style={{ marginBottom: 12 }} />
          <div className="photo-grid public-grid">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} height={180} radius={12} />
            ))}
          </div>
        </div>
      </div>
    )
  }
  if (q.isError || !data) {
    const notFound = isApiError(q.error) && q.error.status === 404
    return (
      <div className="public-shell">
        <div className="public-wrap">
          <div className="card">
            {notFound ? (
              <EmptyState icon="link-45deg" title="This link isn't available" text="The selection may have been removed. Please ask your photographer for a new link." />
            ) : (
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            )}
          </div>
        </div>
      </div>
    )
  }

  const left = Math.max(0, data.quota - data.pickedCount)
  const full = left === 0
  const photos = data.photos.filter((p) => (filter === 'picked' ? p.pickedBy.length > 0 : filter === 'mine' ? p.pickedBy.includes(memberId) : true))
  const current = open !== null ? photos[open] : null
  const myPick = (p: Photo) => p.pickedBy.includes(memberId)

  const toggle = (p: Photo) => {
    if (data.readOnly) return
    if (!member) {
      toast.info('First choose who is picking', { id: 'who' })
      return
    }
    if (!myPick(p) && full && p.pickedBy.length === 0) {
      toast.warning(`You've picked all ${data.quota} photos in your package. Remove a photo to choose another.`, { id: 'quota' })
      return
    }
    pick.mutate({ photoId: p.id, picked: !myPick(p) })
  }

  const submit = () =>
    confirm({
      title: 'Submit your final selection?',
      message: (
        <>
          You're sending <strong>{data.pickedCount}</strong> of {data.quota} photos to {data.studio.name}. After submitting, the selection becomes read-only.
        </>
      ),
      confirmLabel: 'Submit selection',
      icon: 'send-check',
      onConfirm: async () => {
        try {
          const d = await api.post<PublicSelectionDto>(`/public/selections/${token}/submit`, { memberId: memberId || data.members[0].id })
          qc.setQueryData(key, d)
          toast.success('Selection submitted — thank you! Your photographer has been notified.')
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  return (
    <div className="public-shell">
      <header className="public-head">
        <div className="public-wrap public-head-inner">
          <div className="public-brand">
            <Avatar name={data.studio.name} src={data.studio.logoUrl} size={40} />
            <div>
              <strong>{data.studio.name}</strong>
              <small>Private photo selection · {data.code}</small>
            </div>
          </div>
          <div className="public-counter" aria-live="polite">
            <span>
              <strong>{data.pickedCount}</strong> / {data.quota} picked
            </span>
            <Progress value={data.pickedCount} max={data.quota} label="Photos picked" />
          </div>
        </div>
      </header>

      <main className="public-wrap">
        <div className="public-title">
          <p className="eyebrow">{data.clientName}</p>
          <h1 className="page-title">{data.eventTitle}</h1>
          <p className="page-subtitle">
            Tap the heart on your favourite photos. You can pick up to {data.quota} · deadline {formatDate(data.deadline)}.
          </p>
        </div>

        {data.status === 'SUBMITTED' && (
          <p className="notice success" role="status">
            <i className="bi bi-check2-circle" /> Your selection was submitted. It's now read-only — contact {data.studio.name} if you need changes.
          </p>
        )}
        {data.status === 'EXPIRED' && (
          <p className="notice warning" role="status">
            <i className="bi bi-hourglass-bottom" /> The selection deadline has passed. Please contact {data.studio.name} to reopen it.
          </p>
        )}
        {!data.readOnly && full && (
          <p className="notice warning" role="status" data-testid="quota-lock">
            <i className="bi bi-lock-fill" /> Quota reached: you've picked all {data.quota} photos in your package. Remove a heart to choose a different photo.
          </p>
        )}

        {!data.readOnly && (
          <div className="member-picker" role="radiogroup" aria-label="Who is picking?">
            <span className="muted">Picking as:</span>
            {data.members.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={memberId === m.id}
                className={`chip${memberId === m.id ? ' on' : ''}`}
                onClick={() => setMemberId(m.id)}
              >
                {m.name} <small>{m.pickCount} ♥</small>
              </button>
            ))}
          </div>
        )}

        <div className="row-between public-toolbar">
          <div className="tabs" role="tablist">
            {(
              [
                ['all', `All (${data.photos.length})`],
                ['picked', `Picked (${data.photos.filter((p) => p.pickedBy.length).length})`],
                ['mine', `My hearts (${data.photos.filter((p) => p.pickedBy.includes(memberId)).length})`],
              ] as [Filter, string][]
            ).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
          {!data.readOnly && <span className="muted">{left} left</span>}
        </div>

        {photos.length === 0 ? (
          <div className="card">
            <EmptyState icon="heart" title={filter === 'all' ? 'No photos yet' : 'Nothing picked yet'} text={filter === 'all' ? 'Your photographer is still uploading.' : 'Tap the heart on a photo to pick it.'} />
          </div>
        ) : (
          <div className="photo-grid public-grid">
            {photos.map((p, i) => {
              const mine = myPick(p)
              const locked = !data.readOnly && full && p.pickedBy.length === 0
              return (
                <figure key={p.id} className={`photo-tile public-tile${p.pickedBy.length ? ' is-picked' : ''}${locked ? ' is-locked' : ''}`}>
                  <button className="photo-open" onClick={() => setOpen(i)} aria-label={`Open ${p.originalName}`}>
                    <img src={fileUrl(p.url)} alt={p.originalName} loading="lazy" />
                  </button>
                  {!data.readOnly ? (
                    <button
                      className={`heart-btn${mine ? ' on' : ''}`}
                      onClick={() => toggle(p)}
                      aria-pressed={mine}
                      aria-label={mine ? `Remove heart from ${p.originalName}` : `Heart ${p.originalName}`}
                      disabled={pending === p.id}
                      title={locked ? 'Quota reached — remove a heart first' : undefined}
                    >
                      {pending === p.id ? <Spinner size={14} /> : <i className={`bi bi-heart${mine ? '-fill' : ''}`} />}
                    </button>
                  ) : (
                    p.pickedBy.length > 0 && (
                      <span className="heart-btn on" aria-label="Picked">
                        <i className="bi bi-heart-fill" />
                      </span>
                    )
                  )}
                  {(p.pickedBy.length > 1 || (p.pickedBy.length === 1 && !mine)) && (
                    <span className="photo-badge photo-badge-left" title={`Picked by ${p.pickedBy.map((id) => data.members.find((m) => m.id === id)?.name).join(', ')}`}>
                      <i className="bi bi-people-fill" /> {p.pickedBy.length}
                    </span>
                  )}
                  {p.comments.length > 0 && (
                    <span className="photo-badge">
                      <i className="bi bi-chat-fill" /> {p.comments.length}
                    </span>
                  )}
                </figure>
              )
            })}
          </div>
        )}
      </main>

      {!data.readOnly && (
        <footer className="public-submit-bar">
          <div className="public-wrap public-head-inner">
            <span>
              <strong>{data.pickedCount}</strong> of {data.quota} photos picked{member ? ` · picking as ${member.name}` : ''}
            </span>
            <button className="btn btn-primary" onClick={submit} disabled={data.pickedCount === 0}>
              <i className="bi bi-send-check" /> Submit selection
            </button>
          </div>
        </footer>
      )}

      {current && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={current.originalName} onClick={() => setOpen(null)}>
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn lb-close" onClick={() => setOpen(null)} aria-label="Close">
              <i className="bi bi-x-lg" />
            </button>
            <div className="lb-stage">
              <button className="icon-btn lb-nav" onClick={() => setOpen((o) => (o! > 0 ? o! - 1 : o))} disabled={open === 0} aria-label="Previous photo">
                <i className="bi bi-chevron-left" />
              </button>
              <img src={fileUrl(current.url)} alt={current.originalName} />
              <button className="icon-btn lb-nav" onClick={() => setOpen((o) => (o! < photos.length - 1 ? o! + 1 : o))} disabled={open === photos.length - 1} aria-label="Next photo">
                <i className="bi bi-chevron-right" />
              </button>
            </div>
            <aside className="lb-side">
              <div className="row-between" style={{ alignItems: 'center' }}>
                <strong title={current.originalName}>{current.originalName}</strong>
                {!data.readOnly && (
                  <button className={`btn btn-sm ${myPick(current) ? 'btn-primary' : 'btn-ghost'}`} onClick={() => toggle(current)} disabled={pending === current.id}>
                    <i className={`bi bi-heart${myPick(current) ? '-fill' : ''}`} /> {myPick(current) ? 'Picked' : 'Pick'}
                  </button>
                )}
              </div>
              <ul className="lb-comments">
                {current.comments.length === 0 && <li className="muted">No comments yet.</li>}
                {current.comments.map((c, i) => (
                  <li key={i}>
                    <strong>{c.memberName}</strong> {c.text}
                  </li>
                ))}
              </ul>
              {!data.readOnly && member && <CommentForm token={token} photo={current} memberId={memberId} onAdded={() => q.refetch()} />}
            </aside>
          </div>
        </div>
      )}
    </div>
  )
}
