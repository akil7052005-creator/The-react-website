import { useQuery } from '@tanstack/react-query'
import type { UploadLimitsDto } from '@weddyzone/shared'
import { api } from '../../lib/api'
import { formatBytes, UPLOAD_LIMITS_KEY } from './UploadFoldersModal'

/**
 * Settings → Cloud storage: what the studio's previews and thumbnails take online. Previews of
 * expired galleries are deleted 15 days after the gallery expires.
 */
export function CloudStorageMeter() {
  const q = useQuery({ queryKey: UPLOAD_LIMITS_KEY, queryFn: () => api.get<UploadLimitsDto>('/me/upload-limits') })
  if (!q.data) return null
  const used = q.data.storageUsedBytes
  const limit = q.data.storageGb === null ? null : q.data.storageGb * 1024 ** 3
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : null
  return (
    <div className="csm" data-testid="cloud-storage-meter">
      <div className="csm-head">
        <strong>Cloud storage</strong>
        <span>
          {(used / 1024 ** 3).toFixed(2)} GB used{q.data.storageGb !== null ? ` of ${q.data.storageGb} GB` : ''} <span className="muted">({formatBytes(used)})</span>
        </span>
      </div>
      {pct !== null && (
        <div className="uf-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Cloud storage used">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="ss-help">Only previews and thumbnails are stored online. Previews of expired galleries are deleted 15 days after the gallery expires.</p>
    </div>
  )
}
