import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BANNER_PLACEMENT_LABELS, BANNER_PLACEMENTS, bannerSchema, type BannerDto } from '@weddyzone/shared'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader, Card, StatusPill, FeatureTooltip, FeatureBar, EmptyState, ErrorState, Skeleton, Toggle, type FeatureBarItem } from '../components/ui'
import { applyApiErrors, FieldShell, SelectField, SubmitButton, TextField, useGuardedClose, useZodForm } from '../components/form/form'
import { Modal, useConfirm } from '../components/Modal'
import { featureInfo } from '../data/featureInfo'
import { api, isApiError, request, upload } from '../lib/api'
import { fileUrl } from '../lib/env'
import { toastError } from '../lib/query'
import { formatBytes, formatDate } from '../utils/format'

const bannerFeatures: FeatureBarItem[] = [
  {
    title: 'Scheduled Campaigns',
    badge: 'Marketing',
    icon: 'calendar-range',
    summary: 'Give promotional banners start and end dates for wedding season, Diwali offers, or monsoon shoots.',
    highlights: ['Set start and end campaign dates', 'Switch banners on or off anytime', 'Choose where each banner appears'],
    tip: 'Promote your destination wedding package 6 months in advance.',
  },
  {
    title: 'Call-to-Action Buttons',
    badge: 'Conversion',
    icon: 'hand-index-thumb',
    summary: 'Add a button like "Check Availability" or "Book Consultation" on top of a banner.',
    highlights: ['Custom button text and link', 'Link to a wa.me WhatsApp chat or any web page'],
    tip: 'Add a seasonal discount code on your hero banner.',
  },
]

const MAX_BYTES = 5 * 1024 * 1024
const TYPES = ['image/jpeg', 'image/png', 'image/webp']
const placementOptions = BANNER_PLACEMENTS.map((p) => ({ value: p, label: BANNER_PLACEMENT_LABELS[p] }))

function checkFile(f: File): string | null {
  if (!TYPES.includes(f.type)) return 'Use a PNG, JPG or WebP image'
  if (f.size > MAX_BYTES) return `This image is ${formatBytes(f.size)} — banners can be up to 5 MB`
  return null
}

function BannerModal({ banner, file: initialFile, onClose }: { banner: BannerDto | null; file: File | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(initialFile)
  const [fileError, setFileError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const form = useZodForm(bannerSchema, {
    defaultValues: banner
      ? {
          title: banner.title,
          placement: banner.placement,
          ctaText: banner.ctaText ?? '',
          ctaUrl: banner.ctaUrl ?? '',
          startDate: banner.startDate ?? '',
          endDate: banner.endDate ?? '',
          active: banner.active,
        }
      : { title: '', placement: 'GALLERY_HERO', ctaText: '', ctaUrl: '', startDate: '', endDate: '', active: true },
  })

  // Local preview of the chosen file; the object URL is released when it changes.
  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }, [objectUrl])
  const previewUrl = objectUrl ?? (banner ? fileUrl(banner.imageUrl) : undefined)

  const save = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const fd = new FormData()
      for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== null) fd.append(k, String(v))
      if (file) fd.append('file', file)
      setProgress(0)
      // Edits send multipart through the normal client (with silent refresh); new banners show upload progress.
      if (banner) return request<BannerDto>('PATCH', `/banners/${banner.id}`, { body: fd })
      return upload<BannerDto>('/banners', fd, setProgress)
    },
    onSuccess: (b) => {
      toast.success(banner ? `Banner “${b.title}” updated` : `Banner “${b.title}” added`)
      qc.invalidateQueries({ queryKey: ['banners'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onClose()
    },
    onError: (e) => {
      const fields = isApiError(e) ? e.fields : undefined
      if (fields?.file) setFileError(fields.file)
      applyApiErrors(form, e)
    },
    onSettled: () => setProgress(null),
  })
  const close = useGuardedClose(form.formState.isDirty || (Boolean(file) && !banner), onClose)

  const pick = (f: File | undefined) => {
    if (!f) return
    const err = checkFile(f)
    setFileError(err)
    if (!err) setFile(f)
  }

  const submit = form.handleSubmit((v) => {
    if (!banner && !file) {
      setFileError('Choose a banner image')
      return
    }
    save.mutate(v as Record<string, unknown>)
  })

  return (
    <Modal
      open
      onClose={close}
      title={banner ? 'Edit banner' : 'New banner'}
      subtitle="1920 × 1080 recommended · PNG, JPG or WebP up to 5 MB"
      icon="image"
      size="lg"
      busy={save.isPending}
      footer={
        <>
          <button className="btn btn-ghost" onClick={close} disabled={save.isPending}>
            Cancel
          </button>
          <SubmitButton busy={save.isPending} form="banner-form" icon="check2">
            {progress !== null && progress < 100 ? `Uploading ${progress}%` : banner ? 'Save banner' : 'Add banner'}
          </SubmitButton>
        </>
      }
    >
      <form id="banner-form" onSubmit={submit} noValidate data-testid="banner-form">
        <FieldShell label="Banner image" htmlFor="banner-file" required={!banner} error={fileError ?? undefined} full>
          <button type="button" className="banner-preview" onClick={() => input.current?.click()} aria-label="Choose banner image">
            {previewUrl ? <img src={previewUrl} alt="Banner preview" /> : <span><i className="bi bi-cloud-arrow-up" /> Choose an image</span>}
          </button>
          <input id="banner-file" ref={input} type="file" accept={TYPES.join(',')} hidden onChange={(e) => pick(e.target.files?.[0])} />
          {file && <p className="field-hint">{file.name} · {formatBytes(file.size)}</p>}
        </FieldShell>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <TextField form={form} name="title" label="Title" required maxLength={80} showCounter />
          <SelectField form={form} name="placement" label="Placement" required options={placementOptions} />
          <TextField form={form} name="ctaText" label="Button text" maxLength={30} showCounter placeholder="Book a call" />
          <TextField form={form} name="ctaUrl" label="Button link" placeholder="https://…" />
          <TextField form={form} name="startDate" label="Start date" type="date" hint="Leave empty to start now" />
          <TextField form={form} name="endDate" label="End date" type="date" hint="Leave empty to run until turned off" />
          <div className="field full">
            <Toggle label="Active" checked={Boolean(form.watch('active'))} onChange={() => form.setValue('active', !form.getValues('active'), { shouldDirty: true })} />
          </div>
        </div>
      </form>
    </Modal>
  )
}

function GalleryBanner() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<{ banner: BannerDto | null; file: File | null } | null>(null)
  const [dragging, setDragging] = useState(false)
  const q = useQuery({ queryKey: ['banners'], queryFn: () => api.get<BannerDto[]>('/banners') })
  const banners = q.data ?? []

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['banners'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const onDrop = (f: File | undefined) => {
    if (!f) return
    const err = checkFile(f)
    if (err) return toast.error(err)
    setEditing({ banner: null, file: f })
  }

  const setActive = async (b: BannerDto) => {
    try {
      await api.patch(`/banners/${b.id}/active`, { active: !b.active })
      toast.success(b.active ? `“${b.title}” turned off` : `“${b.title}” turned on`)
      refresh()
    } catch (e) {
      toastError(e)
    }
  }

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= banners.length) return
    const next = [...banners]
    ;[next[i], next[j]] = [next[j], next[i]]
    // Move the cards right away; roll back if the server refuses.
    qc.setQueryData(['banners'], next)
    try {
      await api.put('/banners/order', { ids: next.map((b) => b.id) })
      toast.success('Banner order saved', { id: 'banner-order' })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (e) {
      qc.setQueryData(['banners'], banners)
      toastError(e)
    }
  }

  const remove = (b: BannerDto) =>
    confirm({
      title: `Delete “${b.title}”?`,
      tone: 'danger',
      message: 'The banner is removed from your galleries and website right away.',
      confirmLabel: 'Delete banner',
      onConfirm: async () => {
        try {
          await api.delete(`/banners/${b.id}`)
          toast.success(`Banner “${b.title}” deleted`)
          refresh()
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Business Suite"
        featureBadge="Visual Merchandising Engine"
        title="Gallery & Website Banners"
        subtitle="Hero banners shown prominently at the top of client galleries and your public portfolio site. Recommended resolution: 1920 × 1080."
      />

      {/* Feature Capabilities Ribbon */}
      <FeatureBar items={bannerFeatures} />

      <FeatureTooltip
        title="Smart Banner Uploader"
        badge="Drag & Drop"
        icon="cloud-upload"
        summary="Upload any PNG, JPG, or WebP photo up to 5 MB, then set its title, button and schedule."
        position="bottom"
        width={310}
      >
        <label
          className={`dropzone dropzone-catchy${dragging ? ' is-dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            onDrop(e.dataTransfer.files[0])
          }}
        >
          <input type="file" accept={TYPES.join(',')} onChange={(e) => (onDrop(e.target.files?.[0]), (e.target.value = ''))} aria-label="Upload a new banner" />
          <i className="bi bi-cloud-arrow-up" />
          <strong>Drop a new campaign banner here, or click to browse</strong>
          <span className="muted">PNG, JPG or WebP · High-resolution up to 5 MB · 1920 × 1080 recommended</span>
          <span className="dropzone-hint">Point cursor to upload</span>
        </label>
      </FeatureTooltip>

      {q.isPending ? (
        <div className="album-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={260} radius={16} />
          ))}
        </div>
      ) : q.isError ? (
        <div className="card">
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </div>
      ) : banners.length === 0 ? (
        <div className="card">
          <EmptyState icon="image" title="No banners yet" text="Drop an image above to create your first campaign banner." />
        </div>
      ) : (
        <div className="album-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {banners.map((b, i) => (
            <FeatureTooltip
              key={b.id}
              title={b.title}
              badge={BANNER_PLACEMENT_LABELS[b.placement]}
              icon="image"
              summary={`Banner on '${BANNER_PLACEMENT_LABELS[b.placement]}'. Status: ${b.status}.${b.startDate ? ` Starts ${formatDate(b.startDate)}.` : ''}${b.endDate ? ` Ends ${formatDate(b.endDate)}.` : ''}`}
              highlights={b.ctaText ? [`Button: “${b.ctaText}” → ${b.ctaUrl}`] : undefined}
              position="top"
              width={280}
            >
              <article className="album album-catchy">
                <div style={{ position: 'relative' }}>
                  <img src={fileUrl(b.imageUrl)} alt={b.title} loading="lazy" style={{ aspectRatio: '16 / 9', objectFit: 'cover', width: '100%' }} />
                  <span className="banner-tag-overlay">{BANNER_PLACEMENT_LABELS[b.placement]}</span>
                </div>
                <div className="album-body row-between">
                  <div>
                    <h3>{b.title}</h3>
                    <p className="cell-sub">{BANNER_PLACEMENT_LABELS[b.placement]}</p>
                  </div>
                  <StatusPill status={b.status} />
                </div>
                <div className="banner-actions">
                  <Toggle label="Active" checked={b.active} onChange={() => setActive(b)} />
                  <span className="row-actions">
                    <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${b.title} earlier`}>
                      <i className="bi bi-arrow-left" />
                    </button>
                    <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === banners.length - 1} aria-label={`Move ${b.title} later`}>
                      <i className="bi bi-arrow-right" />
                    </button>
                    <button className="icon-btn" onClick={() => setEditing({ banner: b, file: null })} aria-label={`Edit ${b.title}`}>
                      <i className="bi bi-pencil" />
                    </button>
                    <button className="icon-btn" onClick={() => remove(b)} aria-label={`Delete ${b.title}`}>
                      <i className="bi bi-trash" />
                    </button>
                  </span>
                </div>
              </article>
            </FeatureTooltip>
          ))}
        </div>
      )}

      <Card title="Tips for Award-Winning Banners" feature={featureInfo.galleryBanner}>
        <ul className="checklist" style={{ marginBottom: 0 }}>
          <li>
            <i className="bi bi-check-circle-fill" />
            Keep important subjects and faces in the center or right side so text doesn't cover them on mobile screens.
          </li>
          <li>
            <i className="bi bi-check-circle-fill" />
            Export as modern WebP format — it loads up to 5× faster than standard PNG files with identical color fidelity.
          </li>
          <li>
            <i className="bi bi-check-circle-fill" />
            Schedule seasonal promotions in advance (e.g. Winter Wedding Early Bird) so they switch on automatically.
          </li>
        </ul>
      </Card>

      {editing && <BannerModal banner={editing.banner} file={editing.file} onClose={() => setEditing(null)} />}
    </div>
  )
}

export default GalleryBanner
