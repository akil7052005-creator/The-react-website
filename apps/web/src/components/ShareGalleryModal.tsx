import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ALBUM_STATUS_LABELS,
  SELECTION_STATUS_LABELS,
  type AlbumDto,
  type Paginated,
  type SelectionDto,
  type SendResultDto,
} from '@weddyzone/shared'
import { useState } from 'react'
import { api } from '../lib/api'
import { toastError } from '../lib/query'
import { copyText, publicLink, sendViaWhatsApp } from '../lib/whatsapp'
import { FieldShell } from './form/form'
import { Modal, useConfirm } from './Modal'
import { Select, type Option } from './Select'
import { Spinner } from './ui'

type Choice = { kind: 'album'; item: AlbumDto } | { kind: 'selection'; item: SelectionDto }

export function ShareGalleryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [choice, setChoice] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const albums = useQuery({
    queryKey: ['albums', { share: true }],
    queryFn: () => api.get<Paginated<AlbumDto>>('/albums', { limit: 100 }),
    enabled: open,
  })
  const selections = useQuery({
    queryKey: ['selections', { share: true }],
    queryFn: () => api.get<Paginated<SelectionDto>>('/selections', { limit: 100, status: 'active' }),
    enabled: open,
  })

  const all: Record<string, Choice> = {}
  albums.data?.data.forEach((a) => (all[`album:${a.id}`] = { kind: 'album', item: a }))
  selections.data?.data.forEach((s) => (all[`selection:${s.id}`] = { kind: 'selection', item: s }))
  const options = [
    {
      label: 'Digital albums',
      options: (albums.data?.data ?? []).map((a): Option => ({ value: `album:${a.id}`, label: `${a.title} (${a.code})`, sub: ALBUM_STATUS_LABELS[a.status] })),
    },
    {
      label: 'Photo selections',
      options: (selections.data?.data ?? []).map((s): Option => ({ value: `selection:${s.id}`, label: `${s.event.title} (${s.code})`, sub: SELECTION_STATUS_LABELS[s.status] })),
    },
  ]
  const current = all[choice]
  const link = current ? publicLink(current.kind, current.item.publicToken) : ''
  const loading = albums.isPending || selections.isPending

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['albums'] })
    qc.invalidateQueries({ queryKey: ['selections'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const markShared = () =>
    current?.kind === 'album' ? api.post(`/albums/${current.item.id}/mark-shared`) : api.post(`/selections/${current!.item.id}/mark-shared`)

  const copy = async () => {
    if (!current) return
    setBusy(true)
    try {
      await markShared()
      await copyText(link, current.kind === 'album' ? 'Album link' : 'Selection link')
      refresh()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const whatsapp = () => {
    if (!current) return
    const name = current.kind === 'album' ? current.item.title : current.item.event.title
    void confirm({
      title: 'Share on WhatsApp?',
      message: (
        <>
          Send <strong>{name}</strong> to the client on WhatsApp. This uses <strong>1 credit</strong>.
        </>
      ),
      confirmLabel: 'Send on WhatsApp',
      icon: 'whatsapp',
      onConfirm: () =>
        sendViaWhatsApp(
          () =>
            current.kind === 'album'
              ? api.post<SendResultDto>(`/albums/${current.item.id}/share`)
              : api.post<SendResultDto>(`/selections/${current.item.id}/send`),
          qc,
          `${name} shared on WhatsApp`,
        )
          .then(() => {
            refresh()
            onClose()
          })
          .catch((e) => {
            toastError(e)
            throw e
          }),
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Share Gallery"
      subtitle="Send a private album or selection link to your client"
      icon="share"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-ghost" onClick={copy} disabled={!current || busy}>
            {busy ? <Spinner size={14} /> : <i className="bi bi-link-45deg" />} Copy link
          </button>
          <button className="btn btn-primary" onClick={whatsapp} disabled={!current || busy}>
            <i className="bi bi-whatsapp" /> Share on WhatsApp
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <FieldShell label="Album or selection" htmlFor="share-pick" required>
          <Select<string>
            inputId="share-pick"
            isLoading={loading}
            options={options}
            value={options.flatMap((g) => g.options).find((o) => o.value === choice) ?? null}
            onChange={(o) => setChoice(o?.value ?? '')}
            placeholder={loading ? 'Loading…' : 'Choose what to share'}
            noOptionsMessage={() => 'No albums or active selections yet'}
          />
        </FieldShell>
        {current && (
          <FieldShell label="Private link" htmlFor="share-link">
            <input id="share-link" className="input" readOnly value={link} onFocus={(e) => e.target.select()} />
          </FieldShell>
        )}
        {current?.kind === 'album' && current.item.status === 'DRAFT' && (
          <p className="notice warning">
            <i className="bi bi-info-circle" /> This album is a draft. Sharing it moves it to In Review so the couple can open it.
          </p>
        )}
      </div>
    </Modal>
  )
}
