import { useQuery } from '@tanstack/react-query'
import type { SelectionDto, SelectionFolderDto, StudioSelectionPhotoDto } from '@weddyzone/shared'
import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { fileUrl } from '../../lib/env'
import { EmptyState, ErrorState, Skeleton } from '../ui'
import { count } from './selectionUi'

/** Shown at a time; "Show more" adds the next batch. */
const PAGE = 120

/** "Selected Photos": only the client's picks, with a tab per album and "All Selected (N)". */
export function SelectedPhotosView({ s, folders, onBack }: { s: SelectionDto; folders: SelectionFolderDto[]; onBack: () => void }) {
  const [album, setAlbum] = useState<string>('all')
  const [shown, setShown] = useState(PAGE)
  const photosQ = useQuery({
    queryKey: ['selection-photos', s.id],
    queryFn: () => api.get<StudioSelectionPhotoDto[]>(`/selections/${s.id}/photos`),
  })
  const picked = useMemo(() => (photosQ.data ?? []).filter((p) => p.pickedBy.length > 0), [photosQ.data])
  const tabs = folders.map((f) => ({ id: f.id, name: f.name, n: picked.filter((p) => p.folderId === f.id).length })).filter((t) => t.n > 0)
  const list = album === 'all' ? picked : picked.filter((p) => p.folderId === album)

  return (
    <section className="card sp-view" aria-labelledby="sp-title">
      <div className="sp-head">
        <button type="button" className="sw-back" onClick={onBack}>
          <i className="bi bi-arrow-left" /> Folders
        </button>
        <h2 id="sp-title">Selected Photos</h2>
      </div>
      <div className="sp-tabs" role="tablist" aria-label="Albums">
        <button type="button" role="tab" aria-selected={album === 'all'} className={album === 'all' ? 'on' : ''} onClick={() => (setAlbum('all'), setShown(PAGE))}>
          All Selected ({count(picked.length)})
        </button>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={album === t.id}
            aria-label={`${t.name} (${count(t.n)})`}
            title={t.name}
            className={`sp-chip${album === t.id ? ' on' : ''}`}
            onClick={() => (setAlbum(t.id), setShown(PAGE))}
          >
            <span className="sp-tab-name">{t.name}</span>
            <span className="sp-tab-count">({count(t.n)})</span>
          </button>
        ))}
      </div>
      {photosQ.isPending ? (
        <div className="sp-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} height={150} radius={10} />
          ))}
        </div>
      ) : photosQ.isError ? (
        <ErrorState error={photosQ.error} onRetry={() => photosQ.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon="check2-square" title="No selected photos" text="The client hasn't picked any photos here." />
      ) : (
        <>
          <ul className="sp-grid" data-testid="selected-grid">
            {list.slice(0, shown).map((p) => (
              <li key={p.id} className="sp-tile">
                {p.media === 'video' ? (
                  <video src={fileUrl(p.url)} preload="metadata" muted aria-label={p.originalName} />
                ) : (
                  <img src={fileUrl(p.previewUrl ?? p.url)} alt={p.originalName} loading="lazy" decoding="async" />
                )}
                <span className="sp-name" title={p.folder ? `${p.folder}/${p.originalName}` : p.originalName}>
                  {p.originalName}
                </span>
              </li>
            ))}
          </ul>
          {list.length > shown && (
            <button type="button" className="ef-btn outline sp-more" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({count(list.length - shown)})
            </button>
          )}
        </>
      )}
    </section>
  )
}
