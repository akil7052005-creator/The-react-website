import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createAlbumSchema, type AlbumDto, type PhotoDto } from '@weddyzone/shared'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { fileUrl } from '../../lib/env'
import { EventSelectField } from '../EventSelect'
import { applyApiErrors, SubmitButton, TextField, useGuardedClose, useZodForm } from '../form/form'
import { Modal } from '../Modal'
import { EmptyState, ErrorState, Skeleton, Toggle } from '../ui'

type EventPhoto = PhotoDto & { picked: boolean }

export function CreateAlbumModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (a: AlbumDto) => void }) {
  const qc = useQueryClient()
  const [pickedOnly, setPickedOnly] = useState(true)
  const form = useZodForm(createAlbumSchema, {
    defaultValues: { eventId: '', title: '', subtitle: '', location: '', photoIds: [] },
  })
  const eventId = form.watch('eventId')
  const photoIds = form.watch('photoIds') as string[]

  const photos = useQuery({
    queryKey: ['event-photos', eventId],
    queryFn: () => api.get<EventPhoto[]>(`/events/${eventId}/photos`),
    enabled: Boolean(eventId),
  })
  const byId = new Map((photos.data ?? []).map((p) => [p.id, p]))
  const hasPicks = (photos.data ?? []).some((p) => p.picked)
  const visible = (photos.data ?? []).filter((p) => !pickedOnly || !hasPicks || p.picked)

  const setIds = (ids: string[]) => form.setValue('photoIds', ids, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
  const toggle = (id: string) => setIds(photoIds.includes(id) ? photoIds.filter((x) => x !== id) : [...photoIds, id])
  const move = (i: number, dir: -1 | 1) => {
    const next = [...photoIds]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    setIds(next)
  }

  const create = useMutation({
    mutationFn: (body: object) => api.post<AlbumDto>('/albums', body),
    onSuccess: (a) => {
      toast.success(`Album ${a.code} created`)
      qc.invalidateQueries({ queryKey: ['albums'] })
      qc.invalidateQueries({ queryKey: ['albums-summary'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      form.reset()
      onClose()
      onCreated?.(a)
    },
    onError: (e) => applyApiErrors(form, e),
  })
  const close = useGuardedClose(form.formState.isDirty, () => {
    form.reset()
    onClose()
  })
  const idsError = form.formState.errors.photoIds?.message as string | undefined

  return (
    <Modal
      open={open}
      onClose={close}
      title="Create Album"
      subtitle="Choose an event, pick the photos in page order, and preview it as a 3D flipbook"
      icon="journal-album"
      size="xl"
      busy={create.isPending}
      footer={
        <>
          <span className="muted" style={{ marginRight: 'auto' }}>
            {photoIds.length} page{photoIds.length === 1 ? '' : 's'} · {Math.ceil(photoIds.length / 2)} spread{Math.ceil(photoIds.length / 2) === 1 ? '' : 's'}
          </span>
          <button className="btn btn-ghost" onClick={close} disabled={create.isPending}>
            Cancel
          </button>
          <SubmitButton busy={create.isPending} form="album-form" icon="check2">
            Create album
          </SubmitButton>
        </>
      }
    >
      <form id="album-form" onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate data-testid="album-form">
        <div className="form-grid">
          <EventSelectField
            form={form}
            name="eventId"
            full
            onChange={(_id, option) => {
              setIds([])
              if (option && !form.getValues('title')) form.setValue('title', option.label.replace(/ (Wedding|Reception|Engagement|Pre-wedding|Sangeet|Haldi)$/i, ''), { shouldDirty: true })
            }}
          />
          <TextField form={form} name="title" label="Album title" required maxLength={80} placeholder="Kavya & Aditya" />
          <TextField form={form} name="subtitle" label="Subtitle" maxLength={120} placeholder="Wedding · Hyderabad" />
          <TextField form={form} name="location" label="Location" maxLength={80} placeholder="Hyderabad" />
        </div>

        <div className="album-picker">
          <div className="row-between" style={{ alignItems: 'center' }}>
            <div>
              <strong>Choose photos</strong>
              <p className="muted">Click photos in the order they should appear. Two photos make one spread.</p>
            </div>
            {hasPicks && <Toggle label="Client picks only" checked={pickedOnly} onChange={() => setPickedOnly((v) => !v)} />}
          </div>
          {idsError && (
            <p className="field-error" role="alert">
              <i className="bi bi-exclamation-circle" /> {idsError}
            </p>
          )}

          {!eventId ? (
            <EmptyState icon="calendar-event" title="Select an event first" text="Its uploaded photos will appear here." />
          ) : photos.isPending ? (
            <div className="photo-grid">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} height={110} radius={12} />
              ))}
            </div>
          ) : photos.isError ? (
            <ErrorState error={photos.error} onRetry={() => photos.refetch()} />
          ) : visible.length === 0 ? (
            <EmptyState icon="images" title="No photos for this event" text="Upload photos through a Photo Selection for this event first." />
          ) : (
            <div className="photo-grid photo-grid-pick">
              {visible.map((p) => {
                const order = photoIds.indexOf(p.id)
                return (
                  <button
                    type="button"
                    key={p.id}
                    className={`photo-tile${order >= 0 ? ' is-selected' : ''}`}
                    onClick={() => toggle(p.id)}
                    aria-pressed={order >= 0}
                    aria-label={`${order >= 0 ? `Page ${order + 1}: ` : ''}${p.originalName}`}
                  >
                    <img src={fileUrl(p.url)} alt="" loading="lazy" />
                    {order >= 0 && <span className="photo-order">{order + 1}</span>}
                    {p.picked && (
                      <span className="photo-badge">
                        <i className="bi bi-heart-fill" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {photoIds.length > 0 && (
            <div className="page-order">
              <strong>Page order</strong>
              <ol>
                {photoIds.map((id, i) => {
                  const p = byId.get(id)
                  return (
                    <li key={id}>
                      {p && <img src={fileUrl(p.url)} alt="" />}
                      <span>
                        Page {i + 1} · Spread {Math.floor(i / 2) + 1}
                      </span>
                      <span className="page-order-btns">
                        <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move page ${i + 1} earlier`}>
                          <i className="bi bi-arrow-up" />
                        </button>
                        <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === photoIds.length - 1} aria-label={`Move page ${i + 1} later`}>
                          <i className="bi bi-arrow-down" />
                        </button>
                        <button type="button" className="icon-btn" onClick={() => toggle(id)} aria-label={`Remove page ${i + 1}`}>
                          <i className="bi bi-x-lg" />
                        </button>
                      </span>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}
        </div>
      </form>
    </Modal>
  )
}
