import type { ClientFolderDto, ClientSelectionDto } from '@weddyzone/shared'
import type { ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { clientFileUrl } from '../../../lib/clientSession'
import { APP_NAME } from '../../../lib/env'
import { ClientGate, ClientTabs, noSave, ShowcaseStrip, StudioLogo, SubmitSelection, SubmittedBanner, ThankYou } from './ClientParts'

const nf = new Intl.NumberFormat('en-IN')

function StatCard({ icon, tone, value, label }: { icon: string; tone: string; value: ReactNode; label: string }) {
  return (
    <div className="cp-stat">
      <i className={`bi bi-${icon} cp-stat-icon ${tone}`} aria-hidden="true" />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function AlbumCard({ selection, folder }: { selection: ClientSelectionDto; folder: ClientFolderDto }) {
  const cover = folder.cover
  return (
    <Link
      to={`/selection/${selection.id}/folders/${folder.id}`}
      className="cp-album"
      aria-label={`Open ${folder.name}: ${folder.selected} of ${folder.total} selected`}
    >
      <div className={`cp-album-cover${cover ? '' : ' empty'}`}>
        {cover?.type === 'photo' && <img src={clientFileUrl(selection.id, cover.url)} alt="" loading="lazy" {...noSave} />}
        {cover?.type === 'video' && (
          <>
            <video src={`${clientFileUrl(selection.id, cover.url)}#t=0.1`} preload="metadata" muted playsInline tabIndex={-1} />
            <span className="cp-play" aria-hidden="true">
              <i className="bi bi-play-fill" />
            </span>
          </>
        )}
        {!cover && <i className={`bi bi-${folder.type === 'video' ? 'camera-video' : 'images'} cp-album-empty-icon`} aria-hidden="true" />}
        <span className="cp-album-badge">
          ✓ {folder.selected}/{folder.total}
        </span>
      </div>
      <span className="cp-album-name" title={folder.name} aria-label={folder.name}>
        {folder.name}
      </span>
    </Link>
  )
}

function EventHome({ selection }: { selection: ClientSelectionDto }) {
  const [params, setParams] = useSearchParams()
  if (params.get('submitted') === '1' && selection.readOnly) {
    return <ThankYou selection={selection} onContinue={() => setParams({}, { replace: true })} />
  }
  const c = selection.counts
  return (
    <div className="cp-page">
      <SubmittedBanner selection={selection} />
      <ShowcaseStrip selection={selection} />
      <div className="cp-studio-pill">
        <StudioLogo selection={selection} className="cp-studio-logo" />
        {selection.studio.name}
      </div>
      <main className="cp-main">
        <h1 className="cp-title">{selection.eventName} Photo Selection</h1>
        <div className="cp-stats">
          <StatCard icon="image" tone="orange" value={nf.format(c.photos)} label="Total Photos" />
          <StatCard
            icon="check-circle-fill"
            tone="green"
            value={
              <>
                {nf.format(c.selected)}
                {selection.selectionLimit !== null && <small> / {nf.format(selection.selectionLimit)}</small>}
              </>
            }
            label="Selected"
          />
          <StatCard icon="folder-fill" tone="purple" value={nf.format(c.folders)} label="Albums" />
          <StatCard icon="camera-video-fill" tone="red" value={nf.format(c.videos)} label="Videos" />
        </div>
        <ClientTabs selection={selection} active="albums" />
        <div className="cp-albums-head">
          <h2>Albums</h2>
          <SubmitSelection selection={selection} />
        </div>
        {selection.folders.length === 0 ? (
          <p className="cp-empty">Your photographer is still adding your photos. Please check back soon.</p>
        ) : (
          <div className="cp-albums">
            {selection.folders.map((f) => (
              <AlbumCard key={f.id} selection={selection} folder={f} />
            ))}
          </div>
        )}
      </main>
      <footer className="cp-foot">🔒 Secure access · Powered by {APP_NAME}</footer>
    </div>
  )
}

/** /selection/:eventId: the customer's albums (one per folder), counts and Submit. */
export default function ClientEvent() {
  const { eventId = '' } = useParams()
  return <ClientGate id={eventId}>{(s) => <EventHome selection={s} />}</ClientGate>
}
