import { useCallback, useState } from 'react'
import { useConfirm } from '../Modal'

/**
 * Photo Selection dialogs with an uploader: closing while photos are still uploading asks first,
 * because the photos not started yet would not be added. Pass `setUploading` to the uploader's
 * `onBusyChange`, and wrap the dialog's close with `guard`.
 */
export function useUploadGuard() {
  const confirm = useConfirm()
  const [uploading, setUploading] = useState(false)
  const guard = useCallback(
    (close: () => void) => async () => {
      if (!uploading) return close()
      const ok = await confirm({
        title: 'Photos are still uploading',
        message: "If you close now, the photos that haven't uploaded yet won't be added. Close anyway?",
        confirmLabel: 'Close anyway',
        cancelLabel: 'Keep uploading',
        tone: 'danger',
      })
      if (ok) close()
    },
    [uploading, confirm],
  )
  return { setUploading, guard }
}
