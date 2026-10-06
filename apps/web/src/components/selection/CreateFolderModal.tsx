import { useQueryClient } from '@tanstack/react-query'
import { FOLDER_NAME_MAX, type FolderType, type SelectionFolderDto, type SelectionOverviewDto } from '@weddyzone/shared'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, isApiError } from '../../lib/api'
import { toastError } from '../../lib/query'
import { Modal } from '../Modal'
import { Spinner } from '../ui'
import { refreshSelection } from './selectionUi'

const MAX = FOLDER_NAME_MAX
const TYPES: { type: FolderType; label: string; icon: string }[] = [
  { type: 'photo', label: 'Photo Folder', icon: 'image' },
  { type: 'video', label: 'Video Folder', icon: 'camera-video' },
]

/**
 * New Folder: choose Photo or Video, then name it. The new card shows straight away; the name must
 * be unique in the event (any case).
 */
export function CreateFolderModal({ open, onClose, selectionId, existing }: { open: boolean; onClose: () => void; selectionId: string; existing: string[] }) {
  const qc = useQueryClient()
  const [type, setType] = useState<FolderType | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const close = () => {
    if (busy) return
    setType(null)
    setName('')
    setError('')
    onClose()
  }

  const create = async () => {
    const v = name.trim()
    if (!v) return setError('Enter a folder name')
    if (v.length > MAX) return setError(`At most ${MAX} characters`)
    if (existing.some((e) => e.trim().toLowerCase() === v.toLowerCase())) return setError('A folder with this name already exists')
    setBusy(true)
    try {
      const f = await api.post<SelectionFolderDto>(`/selections/${selectionId}/folders`, { name: v, type })
      // Add the card now; the refetch below fills in the rest.
      qc.setQueryData<SelectionOverviewDto>(['selection-overview', selectionId], (o) => (o ? { ...o, folders: [...o.folders, f] } : o))
      refreshSelection(qc, selectionId)
      toast.success('Folder created')
      setBusy(false)
      close()
    } catch (e) {
      setBusy(false)
      if (isApiError(e) && e.fields?.name) setError(e.fields.name)
      else toastError(e)
    }
  }

  const label = type === 'video' ? 'Video' : 'Photo'
  return (
    <Modal open={open} onClose={close} title={type ? `Create ${label} Folder` : 'Create Folder'} className="cf-modal" busy={busy}>
      {!type ? (
        <div className="cf-step">
          <p className="cf-lead">Choose the type of folder to create:</p>
          <div className="cf-options">
            {TYPES.map((t) => (
              <button key={t.type} type="button" className="cf-option" onClick={() => setType(t.type)} data-testid={`folder-type-${t.type}`}>
                <i className={`bi bi-${t.icon}`} aria-hidden="true" />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <form
          className="cf-step"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
          noValidate
        >
          <button
            type="button"
            className="cf-back link"
            onClick={() => {
              setType(null)
              setError('')
            }}
            disabled={busy}
          >
            <i className="bi bi-arrow-left" /> Back
          </button>
          <div className={`field${error ? ' has-error' : ''}`}>
            <label htmlFor="cf-name">
              Folder name <span className="req">*</span>
            </label>
            <input
              id="cf-name"
              className="input"
              value={name}
              maxLength={MAX}
              autoFocus
              placeholder={type === 'video' ? 'e.g. Highlights' : 'e.g. Haldi'}
              aria-invalid={!!error}
              aria-describedby={error ? 'cf-name-error' : undefined}
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }}
            />
            {error && (
              <p className="field-error" id="cf-name-error" role="alert">
                <i className="bi bi-exclamation-circle" /> {error}
              </p>
            )}
          </div>
          <div className="cf-foot">
            <button type="button" className="cf-pill ghost" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="cf-pill" disabled={busy}>
              {busy ? <Spinner size={14} /> : null} Create
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
