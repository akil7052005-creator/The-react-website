import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  SELECTION_STATUS_LABELS,
  todayIST,
  updateSelectionSchema,
  type MessagePreviewDto,
  type SelectionDto,
  type SendResultDto,
  type StudioSelectionPhotoDto,
} from '@weddyzone/shared'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, download } from '../../lib/api'
import { fileUrl } from '../../lib/env'
import { toastError } from '../../lib/query'
import { copyText, publicLink, sendViaWhatsApp } from '../../lib/whatsapp'
import { formatDate } from '../../utils/format'
import { applyApiErrors, SubmitButton, TextField, useZodForm } from '../form/form'
import { Modal, useConfirm } from '../Modal'
import { PhotoUploader } from '../PhotoUploader'
import { EmptyState, ErrorState, Progress, Skeleton, StatusPill } from '../ui'
import WhatsAppPreviewModal from '../WhatsAppPreviewModal'

export type SelectionManageTab = 'photos' | 'share' | 'settings'
type Tab = SelectionManageTab

function refreshAll(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: ['selections'] })
  qc.invalidateQueries({ queryKey: ['selection', id] })
  qc.invalidateQueries({ queryKey: ['selection-photos', id] })
  qc.invalidateQueries({ queryKey: ['selections-summary'] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
}

function SettingsTab({ s, onDeleted }: { s: SelectionDto; onDeleted: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const form = useZodForm(updateSelectionSchema, { values: { quota: s.quota, deadline: s.deadline } })
  const save = useMutation({
    mutationFn: (body: object) => api.patch<SelectionDto>(`/selections/${s.id}`, body),
    onSuccess: (x) => {
      toast.success(`Selection ${x.code} updated`)
      refreshAll(qc, s.id)
    },
    onError: (e) => applyApiErrors(form, e),
  })
  const readOnly = s.status === 'SUBMITTED'

  const remove = () =>
    confirm({
      title: `Delete ${s.code}?`,
      message: (
        <>
          The selection for <strong>{s.event.title}</strong> and its link will stop working for the client. Picks made so far are kept in your records.
        </>
      ),
      confirmLabel: 'Delete selection',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/selections/${s.id}`)
          toast.success(`Selection ${s.code} deleted`)
          refreshAll(qc, s.id)
          onDeleted()
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  return (
    <div className="stack" style={{ gap: 18 }}>
      {readOnly && (
        <p className="notice success">
          <i className="bi bi-check2-circle" /> Submitted by the client on {formatDate(s.submittedAt)}. Quota and deadline are locked.
        </p>
      )}
      {s.status === 'EXPIRED' && (
        <p className="notice warning">
          <i className="bi bi-hourglass-bottom" /> The deadline has passed. Extend it to reopen the gallery for the client.
        </p>
      )}
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <div className="form-grid">
          <TextField form={form} name="quota" label="Quota (photos)" type="number" required min={1} disabled={readOnly} hint={`Picked so far: ${s.pickedCount}`} />
          <TextField form={form} name="deadline" label="Deadline" type="date" required min={todayIST()} disabled={readOnly} />
        </div>
        <div className="form-foot">
          <SubmitButton busy={save.isPending} disabled={readOnly || !form.formState.isDirty}>
            Save changes
          </SubmitButton>
        </div>
      </form>
      <div className="danger-zone">
        <div>
          <strong>Delete selection</strong>
          <p className="muted">Removes it from your list and disables the client link.</p>
        </div>
        <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={remove}>
          <i className="bi bi-trash" /> Delete
        </button>
      </div>
    </div>
  )
}

export function SelectionManageModal({
  selection,
  onClose,
  initialTab = 'photos',
}: {
  selection: SelectionDto | null
  onClose: () => void
  /** Which tab opens first: 'photos' (upload & download) or 'settings'. */
  initialTab?: SelectionManageTab
}) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [preview, setPreview] = useState(false)
  const id = selection?.id ?? ''

  const live = useQuery({
    queryKey: ['selection', id],
    queryFn: () => api.get<SelectionDto>(`/selections/${id}`),
    enabled: Boolean(selection),
    initialData: selection ?? undefined,
  })
  const photos = useQuery({
    queryKey: ['selection-photos', id],
    queryFn: () => api.get<StudioSelectionPhotoDto[]>(`/selections/${id}/photos`),
    enabled: Boolean(selection) && tab === 'photos',
  })
  const previewKind = live.data && live.data.status === 'DRAFT' ? 'invite' : 'reminder'
  const previewQ = useQuery({
    queryKey: ['selection-preview', id, previewKind],
    queryFn: () => api.get<MessagePreviewDto>(`/selections/${id}/message-preview`, { type: previewKind }),
    enabled: preview,
  })

  if (!selection) return null
  const s = live.data ?? selection
  const link = publicLink('selection', s.publicToken)
  const canSend = s.status !== 'SUBMITTED' && s.status !== 'EXPIRED'

  const removePhoto = (p: StudioSelectionPhotoDto) =>
    confirm({
      title: 'Remove photo?',
      message: (
        <>
          <strong>{p.originalName}</strong> will be removed from the gallery{p.pickedBy.length ? ` and its ${p.pickedBy.length} pick(s) cleared` : ''}.
        </>
      ),
      confirmLabel: 'Remove photo',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/selections/${s.id}/photos/${p.id}`)
          toast.success(`${p.originalName} removed`)
          refreshAll(qc, s.id)
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  const send = (kind: 'invite' | 'reminder') =>
    confirm({
      title: kind === 'invite' ? 'Send the selection link?' : `Remind ${s.client.name}?`,
      message: (
        <>
          We'll open WhatsApp with a personalised {kind === 'invite' ? 'invitation' : 'reminder'} for <strong>{s.client.name}</strong> ({s.client.phone}). This uses{' '}
          <strong>1 credit</strong>.
        </>
      ),
      confirmLabel: 'Send on WhatsApp',
      icon: 'whatsapp',
      onConfirm: () =>
        sendViaWhatsApp(
          () => api.post<SendResultDto>(`/selections/${s.id}/${kind === 'invite' ? 'send' : 'remind'}`),
          qc,
          kind === 'invite' ? `Selection ${s.code} sent to ${s.client.name}` : `Reminder sent to ${s.client.name}`,
        )
          .then(() => refreshAll(qc, s.id))
          .catch((e) => {
            toastError(e)
            throw e
          }),
    })

  const copy = async () => {
    try {
      await api.post(`/selections/${s.id}/mark-shared`)
      await copyText(link, 'Selection link')
      refreshAll(qc, s.id)
    } catch (e) {
      toastError(e)
    }
  }

  const exportPicks = async (format: 'csv' | 'txt') => {
    try {
      await download(`/selections/${s.id}/export?format=${format}`, `${s.code}-${format === 'txt' ? 'lightroom.txt' : 'picks.csv'}`)
      toast.success(format === 'txt' ? 'Lightroom filename list downloaded' : 'Picks CSV downloaded')
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={`${s.code} · ${s.event.title}`}
        subtitle={`${s.client.name} · deadline ${formatDate(s.deadline)}`}
        icon="images"
        size="xl"
      >
        <div className="manage-head">
          <StatusPill status={SELECTION_STATUS_LABELS[s.status]} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div className="progress-meta" style={{ marginBottom: 6 }}>
              <span>
                <strong>{s.pickedCount}</strong> / {s.quota} picked · {s.photoCount} photos uploaded
              </span>
            </div>
            <Progress value={s.pickedCount} max={s.quota} label="Selection progress" />
          </div>
          <div className="tabs" role="tablist">
            {(['photos', 'share', 'settings'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'photos' ? 'Photos' : t === 'share' ? 'Share & export' : 'Settings'}
              </button>
            ))}
          </div>
        </div>

        {tab === 'photos' && (
          <div className="stack" style={{ gap: 16 }}>
            {s.status !== 'SUBMITTED' && <PhotoUploader endpoint={`/selections/${s.id}/photos`} onUploaded={() => refreshAll(qc, s.id)} label="Add more photos" />}
            <div className="download-bar">
              <span>
                <i className="bi bi-download" /> Download the client's picks ({s.pickedCount})
              </span>
              <div className="row-actions">
                <button className="btn btn-sm btn-ghost" onClick={() => exportPicks('txt')} disabled={s.pickedCount === 0}>
                  <i className="bi bi-filetype-txt" /> Lightroom list
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => exportPicks('csv')} disabled={s.pickedCount === 0}>
                  <i className="bi bi-filetype-csv" /> CSV with names & comments
                </button>
              </div>
            </div>
            {photos.isPending ? (
              <div className="photo-grid">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} height={120} radius={12} />
                ))}
              </div>
            ) : photos.isError ? (
              <ErrorState error={photos.error} onRetry={() => photos.refetch()} />
            ) : photos.data.length === 0 ? (
              <EmptyState icon="images" title="No photos yet" text="Upload the event photos for the couple to choose from." />
            ) : (
              <div className="photo-grid">
                {photos.data.map((p) => (
                  <figure key={p.id} className={`photo-tile${p.pickedBy.length ? ' is-picked' : ''}`}>
                    <img src={fileUrl(p.url)} alt={p.originalName} loading="lazy" />
                    {p.pickedBy.length > 0 && (
                      <span className="photo-badge" title={`Picked by ${p.pickedBy.join(', ')}`}>
                        <i className="bi bi-heart-fill" /> {p.pickedBy.length}
                      </span>
                    )}
                    {p.comments.length > 0 && (
                      <span className="photo-badge photo-badge-left" title={p.comments.map((c) => `${c.memberName}: ${c.text}`).join('\n')}>
                        <i className="bi bi-chat-fill" /> {p.comments.length}
                      </span>
                    )}
                    <figcaption>
                      <span title={p.originalName}>{p.originalName}</span>
                      {s.status !== 'SUBMITTED' && (
                        <button className="icon-btn" aria-label={`Remove ${p.originalName}`} onClick={() => removePhoto(p)}>
                          <i className="bi bi-trash" />
                        </button>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'share' && (
          <div className="stack" style={{ gap: 18 }}>
            <div className="field">
              <label htmlFor="sel-link">Private selection link</label>
              <div className="code-box">
                <code id="sel-link" style={{ overflowWrap: 'anywhere' }}>
                  {link}
                </code>
                <button className="btn btn-gold btn-sm" onClick={copy}>
                  <i className="bi bi-copy" /> Copy
                </button>
              </div>
              <p className="field-hint">No login needed — anyone with the link can pick. Members: {s.members.map((m) => m.name).join(', ')}.</p>
            </div>
            <div className="share-actions">
              <button className="btn btn-primary" onClick={() => send(s.status === 'DRAFT' ? 'invite' : 'reminder')} disabled={!canSend || s.photoCount === 0}>
                <i className="bi bi-whatsapp" /> {s.status === 'DRAFT' ? 'Send link on WhatsApp' : 'Send reminder'}
              </button>
              <button className="btn btn-ghost" onClick={() => setPreview(true)}>
                <i className="bi bi-eye" /> Preview message
              </button>
              <a className="btn btn-ghost" href={link} target="_blank" rel="noreferrer">
                <i className="bi bi-box-arrow-up-right" /> Open client view
              </a>
            </div>
            {s.lastRemindedAt && <p className="muted">Last reminder sent {formatDate(s.lastRemindedAt)}.</p>}
            <div className="card-divider" />
            <div>
              <strong>Lightroom XML Sync</strong>
              <p className="muted" style={{ margin: '4px 0 12px' }}>
                Download the picked filenames. Paste the TXT list into a Lightroom Classic “Filename contains” filter, or open the CSV to see who picked what.
              </p>
              <div className="share-actions">
                <button className="btn btn-ghost" onClick={() => exportPicks('txt')} disabled={s.pickedCount === 0}>
                  <i className="bi bi-file-earmark-text" /> Lightroom list (TXT)
                </button>
                <button className="btn btn-ghost" onClick={() => exportPicks('csv')} disabled={s.pickedCount === 0}>
                  <i className="bi bi-filetype-csv" /> Picks with names (CSV)
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'settings' && <SettingsTab s={s} onDeleted={onClose} />}
      </Modal>

      <WhatsAppPreviewModal
        isOpen={preview}
        onClose={() => setPreview(false)}
        preview={previewQ.data}
        loading={previewQ.isPending}
        error={previewQ.isError ? (previewQ.error as Error).message : null}
        onSend={
          canSend && s.photoCount > 0
            ? () => {
                setPreview(false)
                void send(s.status === 'DRAFT' ? 'invite' : 'reminder')
              }
            : undefined
        }
      />
    </>
  )
}
