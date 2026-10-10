import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  GALLERY_EXPIRY_OPTIONS,
  WATERMARK_POSITION_LABELS,
  WATERMARK_POSITIONS,
  watermarkBox,
  type EventSettings,
  type EventSettingsPatch,
  type SelectionOverviewDto,
  type WatermarkPosition,
} from '@weddyzone/shared'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import landscapeSample from '../assets/preview-landscape.jpg'
import portraitSample from '../assets/preview-portrait.jpg'
import { EventDetailsModal } from '../components/selection/EventDetailsModal'
import { refreshSelection, selectionPath } from '../components/selection/selectionUi'
import { ResetSelectionModal } from '../components/selection/ResetSelectionModal'
import { SettingsModal } from '../components/selection/SettingsModal'
import { CloudStorageMeter } from '../components/selection/CloudStorageMeter'
import { ErrorState, Skeleton, Spinner } from '../components/ui'
import { api, upload } from '../lib/api'
import { fileUrl } from '../lib/env'
import { toastError } from '../lib/query'
import { formatDate } from '../utils/format'

type Bool = 'allowClientView' | 'downloadOn' | 'downloadAllFolder' | 'instagramFollow' | 'favoriteOption' | 'photoNotes' | 'videoDownload'
type Layout = { position: WatermarkPosition; sizePct: number; spacingPct: number; opacityPct: number; enabled: boolean }

/** A blue/grey switch in a white pill. */
function SwitchPill({ label, checked, onChange, disabled, hint, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string; testId?: string }) {
  return (
    <label className={`ss-pill${disabled ? ' is-disabled' : ''}`} title={hint}>
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span className="ss-switch" aria-hidden="true" />
    </label>
  )
}

function Section({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <section className="ss-section" aria-label={title}>
      <h3 className="ss-section-title">
        <span className="ss-section-icon" aria-hidden="true">
          <i className={`bi bi-${icon}`} />
        </span>
        {title}
      </h3>
      {children}
    </section>
  )
}

/** A photo with the watermark drawn on top from the current settings (same geometry as the server). */
function PreviewImage({ src, width, height, layout, logo, caption }: { src: string; width: number; height: number; layout: Layout; logo: { url: string; w: number; h: number } | null; caption: string }) {
  const mark = logo ? { width: logo.w, height: logo.h } : { width: 'Your Logo'.length * 0.6, height: 1.3 }
  const box = watermarkBox({ width, height }, mark, layout)
  const style: CSSProperties = { left: box.left, top: box.top, width: box.width, height: box.height, opacity: layout.opacityPct / 100 }
  return (
    <figure className="ss-preview">
      <figcaption>{caption}</figcaption>
      <div className="ss-preview-frame" style={{ width, height }}>
        <img src={src} alt="" width={width} height={height} />
        {logo ? (
          <img className="ss-mark" src={logo.url} alt="" style={style} data-testid="preview-mark" />
        ) : (
          <span className="ss-mark ss-mark-text" style={{ ...style, fontSize: box.height * 0.72 }} data-testid="preview-mark">
            Your Logo
          </span>
        )}
      </div>
    </figure>
  )
}

type Rules = Pick<EventSettings, 'allowSelection' | 'downloadOn' | 'highQuality' | 'limitOn' | 'selectionLimit' | 'videoSelection'> & { linkExpiresOn: string }

const rulesOf = (d: EventSettings): Rules => ({
  allowSelection: d.allowSelection,
  downloadOn: d.downloadOn,
  highQuality: d.highQuality,
  limitOn: d.limitOn,
  selectionLimit: d.selectionLimit,
  videoSelection: d.videoSelection,
  linkExpiresOn: d.galleryExpiresOn ?? '',
})

/** What the client may do, saved together with "Save Settings". */
function SelectionRules({ data, onSaved, selectionId }: { data: EventSettings; selectionId: string; onSaved: (next: EventSettings) => void }) {
  const [draft, setDraft] = useState<Rules>(() => rulesOf(data))
  const [saving, setSaving] = useState(false)
  const set = (p: Partial<Rules>) => setDraft((d) => ({ ...d, ...p }))
  const changed = JSON.stringify(draft) !== JSON.stringify(rulesOf(data))
  const limitOk = !draft.limitOn || (Number.isInteger(draft.selectionLimit) && draft.selectionLimit >= 1)

  const saveRules = async () => {
    setSaving(true)
    try {
      const next = await api.patch<EventSettings>(`/selections/${selectionId}/settings`, {
        allowSelection: draft.allowSelection,
        downloadOn: draft.downloadOn,
        highQuality: draft.highQuality,
        limitOn: draft.limitOn,
        videoSelection: draft.videoSelection,
        ...(draft.limitOn ? { selectionLimit: draft.selectionLimit } : {}),
        ...(draft.linkExpiresOn !== (data.galleryExpiresOn ?? '') ? { linkExpiresOn: draft.linkExpiresOn || null } : {}),
      })
      onSaved(next)
      toast.success('Settings saved')
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section icon="check2-square" title="Client selection">
      <div className="ss-pills">
        <SwitchPill label="Allow client selection" checked={draft.allowSelection} onChange={(v) => set({ allowSelection: v })} testId="allowSelection" />
        <SwitchPill label="Allow download" checked={draft.downloadOn} onChange={(v) => set({ downloadOn: v })} testId="allowDownload" />
        <SwitchPill label="Show photos in high quality" checked={draft.highQuality} onChange={(v) => set({ highQuality: v })} testId="highQuality" />
        <SwitchPill label="Allow video selection" checked={draft.videoSelection} onChange={(v) => set({ videoSelection: v })} testId="videoSelection" />
        <div className="ss-pill ss-limit">
          <label className="ss-inline">
            <span>Selection limit</span>
            <input type="checkbox" role="switch" checked={draft.limitOn} onChange={(e) => set({ limitOn: e.target.checked })} data-testid="limitOn" />
            <span className="ss-switch" aria-hidden="true" />
          </label>
          <input
            type="number"
            className="ss-num"
            min={1}
            max={100000}
            aria-label="Selection limit (photos)"
            value={Number.isFinite(draft.selectionLimit) ? draft.selectionLimit : ''}
            disabled={!draft.limitOn}
            onChange={(e) => set({ selectionLimit: e.target.valueAsNumber })}
          />
        </div>
        <label className="ss-pill">
          <span>Link expiry date</span>
          <input type="date" className="ss-date" value={draft.linkExpiresOn} min={new Date().toISOString().slice(0, 10)} onChange={(e) => set({ linkExpiresOn: e.target.value })} aria-label="Link expiry date" />
          {draft.linkExpiresOn && (
            <button type="button" className="link ss-small" onClick={() => set({ linkExpiresOn: '' })}>
              No expiry
            </button>
          )}
        </label>
      </div>
      {!limitOk && <p className="field-error">Enter a selection limit of at least 1 photo.</p>}
      <button type="button" className="ss-save" onClick={() => void saveRules()} disabled={saving || !changed || !limitOk} data-testid="save-settings">
        {saving ? <Spinner size={14} /> : null} Save Settings
      </button>
    </Section>
  )
}

/** Photo Selection Settings for one event: permissions, client options, quality, watermark, preview. */
export default function SelectionSettings() {
  const { selectionId = '' } = useParams()
  const qc = useQueryClient()
  const key = ['selection-settings', selectionId]
  const q = useQuery({ queryKey: key, queryFn: () => api.get<EventSettings>(`/selections/${selectionId}/settings`) })
  const overview = useQuery({ queryKey: ['selection-overview', selectionId], queryFn: () => api.get<SelectionOverviewDto>(`/selections/${selectionId}/overview`) })
  const [editing, setEditing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [resetting, setResetting] = useState(false)

  // Watermark form (saved with its own button).
  const [layout, setLayout] = useState<Layout | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<{ url: string; w: number; h: number } | null>(null)
  const [savingWm, setSavingWm] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const s = q.data
  const current = layout ?? (s ? { position: s.watermark.position, sizePct: s.watermark.sizePct, spacingPct: s.watermark.spacingPct, opacityPct: s.watermark.opacityPct, enabled: s.watermark.enabled } : null)
  const logoSrc = logoFile ? logoPreview?.url : s?.watermark.logoUrl ? fileUrl(s.watermark.logoUrl) : undefined

  // The logo's real size, for the live preview.
  const [savedLogo, setSavedLogo] = useState<{ url: string; w: number; h: number } | null>(null)
  useEffect(() => {
    if (!logoSrc || logoFile) return
    const img = new Image()
    img.onload = () => setSavedLogo({ url: logoSrc, w: img.naturalWidth, h: img.naturalHeight })
    img.src = logoSrc
  }, [logoSrc, logoFile])
  useEffect(() => {
    if (!logoFile) return
    const url = URL.createObjectURL(logoFile)
    const img = new Image()
    img.onload = () => setLogoPreview({ url, w: img.naturalWidth || 400, h: img.naturalHeight || 160 })
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [logoFile])
  const logo = logoFile ? logoPreview : s?.watermark.logoUrl ? savedLogo : null

  useEffect(() => {
    if (overview.data) document.title = `Settings · ${overview.data.selection.event.title}`
  }, [overview.data])

  const titleBar = useMemo(
    () => (
      <Link to={selectionPath(selectionId)} className="sw-back">
        <i className="bi bi-arrow-left" /> Back to folders
      </Link>
    ),
    [selectionId],
  )

  if (q.isPending || overview.isPending) {
    return (
      <div className="stack ss-page">
        {titleBar}
        <div className="card ss-card">
          <Skeleton width={260} height={26} />
          <div className="ss-pills">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} width={190} height={44} radius={99} />
            ))}
          </div>
          <Skeleton height={220} radius={12} />
        </div>
      </div>
    )
  }
  if (q.isError || overview.isError) {
    return (
      <div className="stack ss-page">
        {titleBar}
        <div className="card ss-card">
          <ErrorState error={q.error ?? overview.error} onRetry={() => void Promise.all([q.refetch(), overview.refetch()])} />
        </div>
      </div>
    )
  }

  const data = q.data
  const sel = overview.data.selection
  const lay = current!

  /** Optimistic save of one or more settings; rolls back if the server says no. */
  const save = async (patch: EventSettingsPatch, optimistic: Partial<EventSettings>) => {
    const before = qc.getQueryData<EventSettings>(key)
    qc.setQueryData<EventSettings>(key, (d) => (d ? { ...d, ...optimistic } : d))
    try {
      const next = await api.patch<EventSettings>(`/selections/${selectionId}/settings`, patch)
      qc.setQueryData(key, next)
      refreshSelection(qc, selectionId)
      toast.success('Saved', { id: 'settings-saved' })
    } catch (e) {
      qc.setQueryData(key, before)
      toastError(e)
    }
  }
  const toggle = (k: Bool, v: boolean) => {
    const patch: EventSettingsPatch = { [k]: v }
    const optimistic: Partial<EventSettings> = { [k]: v }
    if (k === 'downloadOn' && !v) optimistic.downloadAllFolder = false
    void save(patch, optimistic)
  }


  const saveWatermark = async () => {
    setSavingWm(true)
    try {
      if (logoFile) {
        const fd = new FormData()
        fd.append('file', logoFile)
        await upload<EventSettings>(`/selections/${selectionId}/settings/logo`, fd)
      }
      const next = await api.patch<EventSettings>(`/selections/${selectionId}/settings`, {
        watermark: { position: lay.position, sizePct: lay.sizePct, spacingPct: lay.spacingPct, opacityPct: lay.opacityPct, enabled: lay.enabled },
      })
      qc.setQueryData(key, next)
      setLayout(null)
      setLogoFile(null)
      setLogoPreview(null)
      if (fileInput.current) fileInput.current.value = ''
      refreshSelection(qc, selectionId)
      toast.success('Watermark settings saved')
    } catch (e) {
      toastError(e)
    } finally {
      setSavingWm(false)
    }
  }
  const setLay = (p: Partial<Layout>) => setLayout({ ...lay, ...p })
  const expiryValue = data.galleryExpiry === null ? 'none' : String(data.galleryExpiry)

  return (
    <div className="stack ss-page">
      {titleBar}
      <div className="card ss-card">
        <header className="ss-head">
          <div>
            <h1 className="ss-title">Photo Selection Settings</h1>
            <span className="ss-underline" aria-hidden="true" />
            <p className="muted ss-sub">
              {sel.event.title} · {sel.client.name}
            </p>
          </div>
          <div className="ss-head-actions">
            <button type="button" className="ss-outline" onClick={() => setSharing(true)}>
              <i className="bi bi-send" /> Share &amp; activity
            </button>
            <button type="button" className="ss-outline" onClick={() => setEditing(true)}>
              <i className="bi bi-pencil-square" /> Edit Event Details
            </button>
          </div>
        </header>

        <SelectionRules
          key={JSON.stringify(rulesOf(data))}
          data={data}
          selectionId={selectionId}
          onSaved={(next) => {
            qc.setQueryData(key, next)
            refreshSelection(qc, selectionId)
          }}
        />

        <Section icon="lightning-charge-fill" title="Quick permissions">
          <div className="ss-pills">
            <SwitchPill label="Gallery visible to client" checked={data.allowClientView} onChange={(v) => toggle('allowClientView', v)} testId="allowClientView" />
            <SwitchPill label="Client can download" checked={data.downloadOn} onChange={(v) => toggle('downloadOn', v)} testId="downloadOn" />
            <SwitchPill
              label="Allow full-album download"
              checked={data.downloadAllFolder}
              disabled={!data.downloadOn}
              hint={!data.downloadOn ? 'Turn on “Client can download” first' : undefined}
              onChange={(v) => toggle('downloadAllFolder', v)}
              testId="downloadAllFolder"
            />
            <SwitchPill label="Ask client to follow our Instagram" checked={data.instagramFollow} onChange={(v) => toggle('instagramFollow', v)} testId="instagramFollow" />
          </div>
        </Section>

        <Section icon="sliders" title="Client options">
          <div className="ss-pills">
            <SwitchPill label="Favorite Option" checked={data.favoriteOption} onChange={(v) => toggle('favoriteOption', v)} testId="favoriteOption" />
            <SwitchPill label="Photo Notes" checked={data.photoNotes} onChange={(v) => toggle('photoNotes', v)} testId="photoNotes" />
            <label className="ss-pill">
              <span>Gallery Expiry</span>
              <select
                className="ss-select"
                value={expiryValue}
                aria-label="Gallery Expiry"
                data-testid="galleryExpiry"
                onChange={(e) => {
                  if (e.target.value === 'custom') return
                  const v = e.target.value === 'none' ? null : (Number(e.target.value) as 7 | 15 | 30 | 60 | 90)
                  void save({ galleryExpiry: v }, { galleryExpiry: v })
                }}
              >
                {GALLERY_EXPIRY_OPTIONS.map((d) => (
                  <option key={String(d)} value={d === null ? 'none' : String(d)}>
                    {d === null ? 'No expiry' : `${d} days`}
                  </option>
                ))}
                {data.galleryExpiry === 'custom' && <option value="custom">Until {formatDate(data.galleryExpiresOn)}</option>}
              </select>
            </label>
            <div className="ss-pill">
              <span>Reset Selection</span>
              <button type="button" className="ss-reset" onClick={() => setResetting(true)} disabled={sel.pickedCount === 0 && sel.status !== 'DELIVERED'}>
                ↺ Reset
              </button>
            </div>
          </div>
          {data.galleryExpiresOn && <p className="muted ss-small">The gallery closes for the client after {formatDate(data.galleryExpiresOn)}.</p>}
        </Section>

        <div className="ss-block">
          <h3 className="ss-label">Photos online</h3>
          <p className="ss-help" data-testid="upload-quality-help">
            Each photo is uploaded as a 2048 px preview and a small thumbnail for fast client viewing. Originals are not stored online. Keep your original folder on this
            computer until delivery.
          </p>
          <CloudStorageMeter />
          {data.addons.videoDownload ? (
            <SwitchPill label="Video Download" checked={data.videoDownload} onChange={(v) => toggle('videoDownload', v)} testId="videoDownload" />
          ) : (
            <div className="ss-notice">
              <span>
                <strong>Video Download:</strong> Requires active Video add-on bundle.
              </span>
              <Link to="/subscriptions" className="ss-upgrade">
                UPGRADE
              </Link>
            </div>
          )}
        </div>
        <hr className="ss-divider" />

        <div className="ss-block">
          <h2 className="ss-h2">Watermark Settings</h2>
          <div className="ss-cols">
            <div className="field">
              <label htmlFor="wm-logo">
                Upload Logo{' '}
                <i className="bi bi-info-circle ss-tip" title="PNG with transparent background recommended, max 2 MB" aria-label="PNG with transparent background recommended, max 2 MB" />
              </label>
              <div className="ss-logo-row">
                <input
                  id="wm-logo"
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,.svg"
                  className="input"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null
                    if (f && f.size > 2 * 1024 * 1024) {
                      toast.error('The logo must be 2 MB or smaller')
                      e.target.value = ''
                      return
                    }
                    setLogoFile(f)
                  }}
                />
                {logoSrc && <img className="ss-logo-thumb" src={logoSrc} alt="Logo" />}
              </div>
              {s?.watermark.logoUrl && !logoFile && (
                <button
                  type="button"
                  className="link ss-small"
                  onClick={() => void save({ watermark: { removeLogo: true } }, { watermark: { ...data.watermark, logoUrl: null } })}
                >
                  Remove logo (use the studio name)
                </button>
              )}
            </div>
            <div className="field">
              <label htmlFor="wm-pos">Watermark Position</label>
              <select id="wm-pos" className="input" value={lay.position} onChange={(e) => setLay({ position: e.target.value as WatermarkPosition })}>
                {WATERMARK_POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {WATERMARK_POSITION_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span className="ss-field-label">Enable Watermark</span>
              <label className="ss-check">
                <input type="checkbox" checked={lay.enabled} onChange={(e) => setLay({ enabled: e.target.checked })} />
                Enable Watermark on Downloads
              </label>
            </div>
          </div>
          <div className="ss-cols">
            {(
              [
                ['sizePct', 'Watermark Size (%)', 5, 50],
                ['spacingPct', 'Spacing from Edge (%)', 0, 20],
                ['opacityPct', 'Opacity (%)', 10, 100],
              ] as const
            ).map(([k, label, min, max]) => (
              <div key={k} className="ss-slider">
                <div className="ss-slider-head">
                  <label htmlFor={`wm-${k}`}>{label}</label>
                  <span className="ss-value" data-testid={`value-${k}`}>
                    {lay[k]}%
                  </span>
                </div>
                <input id={`wm-${k}`} type="range" min={min} max={max} value={lay[k]} onChange={(e) => setLay({ [k]: Number(e.target.value) })} />
              </div>
            ))}
          </div>
          <button type="button" className="ss-save" onClick={() => void saveWatermark()} disabled={savingWm}>
            {savingWm ? <Spinner size={14} /> : null} Save Watermark Settings
          </button>
        </div>

        <div className="ss-block">
          <h2 className="ss-h2">Preview</h2>
          <div className="ss-previews">
            <PreviewImage src={landscapeSample} width={330} height={210} layout={lay} logo={logo} caption="Horizontal Preview" />
            <PreviewImage src={portraitSample} width={200} height={210} layout={lay} logo={logo} caption="Vertical Preview" />
          </div>
          <p className="ss-banner blue">
            <i className="bi bi-info-circle" /> This is a real-time preview. Adjust the settings above to see changes instantly.
          </p>
        </div>
      </div>

      {editing && <EventDetailsModal open selection={sel} onClose={() => setEditing(false)} />}
      {sharing && <SettingsModal open onClose={() => setSharing(false)} overview={overview.data} />}
      {resetting && <ResetSelectionModal selection={sel} onClose={() => setResetting(false)} />}
    </div>
  )
}
