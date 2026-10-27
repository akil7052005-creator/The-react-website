import { useQueryClient } from '@tanstack/react-query'
import type { SelectionFolderDto, StudioSelectionPhotoDto } from '@weddyzone/shared'
import type { KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { toastError } from '../../lib/query'
import { useConfirm } from '../Modal'
import { count, refreshSelection } from './selectionUi'
import { uploadingFolderIds } from './UploadFoldersModal'

/** The round X in the top-right corner of an uploaded folder card or photo tile (same look as the upload box). */
export function CardRemoveX({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      className="uf-x ef-x"
      onClick={(e) => {
        e.stopPropagation()
        onRemove()
      }}
      aria-label={`Remove ${name}`}
      title={`Remove ${name}`}
    >
      <i className="bi bi-x-lg" aria-hidden="true" />
    </button>
  )
}

/** The round pencil left of the X on a folder card: renames it (same look and hover as the X). */
export function CardRenameButton({ onRename }: { onRename: () => void }) {
  return (
    <button
      type="button"
      className="uf-x ef-x ef-rename"
      onClick={(e) => {
        e.stopPropagation()
        onRename()
      }}
      aria-label="Rename folder"
      title="Rename folder"
    >
      <i className="bi bi-pencil" aria-hidden="true" />
    </button>
  )
}

/** Delete key on a focused card removes it (same confirm as the X). */
export const onDeleteKey = (remove: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Delete') {
    e.preventDefault()
    remove()
  }
}

function PickWarning({ n, total }: { n: number; total: number }) {
  if (!n) return null
  return (
    <p className="ef-x-warn" role="alert">
      <i className="bi bi-exclamation-triangle-fill" aria-hidden="true" /> {total === 1 ? 'This photo is' : `${count(n)} of these photos are`} in the customer's selection and will be removed from it.
    </p>
  )
}

/** Confirm, then delete an uploaded folder (with its photos) or one photo, and refresh every count. */
export function useRemoveUploaded(selectionId: string) {
  const qc = useQueryClient()
  const confirm = useConfirm()

  const busyUploading = (folderId: string | null | undefined) => {
    if (folderId && uploadingFolderIds.has(folderId)) {
      toast.error('Wait for the upload to finish')
      return true
    }
    return false
  }

  const removeFolder = (f: SelectionFolderDto, onDone?: () => void) => {
    if (busyUploading(f.id)) return
    const n = f.photoCount + (f.videoCount ?? 0)
    return confirm({
      title: 'Delete folder?',
      message: (
        <>
          <p>
            Delete folder '{f.name}' ({count(n)} {n === 1 ? 'photo' : 'photos'}) from this event? Your customer won't see these photos anymore.
          </p>
          <PickWarning n={f.pickedCount} total={n} />
        </>
      ),
      confirmLabel: f.pickedCount ? 'Delete anyway' : 'Delete folder',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/selections/${selectionId}/folders/${f.id}/with-photos`)
          toast.success('Folder deleted')
          refreshSelection(qc, selectionId)
          onDone?.()
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })
  }

  const removePhoto = (p: StudioSelectionPhotoDto, onDone?: () => void) => {
    if (busyUploading(p.folderId)) return
    const picked = p.pickedBy.length > 0
    return confirm({
      title: 'Delete photo?',
      message: (
        <>
          <p>Delete '{p.originalName}' from this event?</p>
          <PickWarning n={picked ? 1 : 0} total={1} />
        </>
      ),
      confirmLabel: picked ? 'Delete anyway' : 'Delete photo',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/selections/${selectionId}/photos/${p.id}`)
          toast.success('Photo deleted')
          refreshSelection(qc, selectionId)
          onDone?.()
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })
  }

  return { removeFolder, removePhoto }
}
