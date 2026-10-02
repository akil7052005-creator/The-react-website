import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  WEBSITE_FONTS,
  WEBSITE_THEMES,
  websiteSettingsSchema,
  type LeadDto,
  type Paginated,
  type PublicWebsiteDto,
  type WebsiteSectionDto,
  type WebsiteSettingsDto,
  type WebsiteSettingsInput,
} from '@weddyzone/shared'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  PageHeader,
  Card,
  StatCard,
  StatusPill,
  FeatureTooltip,
  FeatureBar,
  EmptyState,
  ErrorState,
  Skeleton,
  TableSkeleton,
  Pagination,
  Toggle,
  type FeatureBarItem,
} from '../components/ui'
import { applyApiErrors, FieldShell, SelectField, SubmitButton, TextField, TextAreaField, useGuardedClose, useZodForm } from '../components/form/form'
import { Modal } from '../components/Modal'
import { SiteView, type SiteSettings } from '../components/website/SiteView'
import { formatDate, formatNumber, timeAgo } from '../utils/format'
import { featureInfo } from '../data/featureInfo'
import { useMe } from '../auth/AuthProvider'
import { useUrlState } from '../hooks/useUrlState'
import { api } from '../lib/api'
import { toastError } from '../lib/query'

const websiteFeatures: FeatureBarItem[] = [
  {
    title: 'Enquiry Form Lead Capture',
    badge: 'Instant Alert',
    icon: 'envelope-paper',
    summary: "An enquiry form on your website collects the couple's name, phone, email, wedding date, city and message.",
    highlights: ['New enquiries appear in your Leads list', 'In-app notification for every new lead', 'Built-in spam protection'],
    tip: 'Responding to enquiries quickly helps you win more bookings.',
  },
  {
    title: 'Video Embeds',
    badge: 'Films',
    icon: 'play-btn',
    summary: 'Embed your YouTube or Vimeo wedding highlight film on your website.',
    highlights: ['Paste a YouTube or Vimeo link', 'Plays right on your website'],
    tip: 'A short 60-second teaser film works best.',
  },
]

const sectionTooltips: Record<string, { title: string; summary: string }> = {
  portfolio: { title: 'Featured Wedding Stories', summary: 'Your published digital albums, newest first.' },
  packages: { title: 'Services & Investment', summary: 'Invites couples to send their dates so you can share packages and pricing.' },
  reviews: { title: 'Bride & Groom Testimonials', summary: 'Client testimonials (coming soon).' },
  about: { title: 'About the Photographer', summary: 'Your studio story from My Profile → About your studio.' },
  video: { title: 'Highlight Film', summary: 'Your YouTube or Vimeo highlight film, set in Edit Design.' },
  blog: { title: 'Studio Blog', summary: 'Wedding stories and tips (coming soon).' },
  enquiry: { title: 'Direct Enquiry Form', summary: 'Lead capture form — enquiries arrive in My Website and your notifications.' },
}

const toBody = (s: WebsiteSettingsDto) => ({
  sections: s.sections.map(({ key, on }) => ({ key, on })),
  theme: s.theme,
  primaryColor: s.primaryColor,
  font: s.font,
  tagline: s.tagline ?? '',
  customDomain: s.customDomain ?? '',
  seoTitle: s.seoTitle ?? '',
  seoDescription: s.seoDescription ?? '',
  videoUrl: s.videoUrl ?? '',
})

function DesignModal({ settings, onClose, onDraft }: { settings: WebsiteSettingsDto; onClose: () => void; onDraft: (d: Partial<SiteSettings> | null) => void }) {
  const qc = useQueryClient()
  const form = useZodForm(websiteSettingsSchema, { defaultValues: toBody(settings) as WebsiteSettingsInput })
  const [theme, primaryColor, font, tagline, videoUrl] = form.watch(['theme', 'primaryColor', 'font', 'tagline', 'videoUrl'])
  useEffect(() => {
    onDraft({ theme, primaryColor: /^#[0-9a-f]{6}$/i.test(primaryColor ?? '') ? primaryColor : settings.primaryColor, font, tagline: String(tagline ?? '') || null, videoUrl: String(videoUrl ?? '') || null })
  }, [theme, primaryColor, font, tagline, videoUrl, onDraft, settings.primaryColor])

  const save = useMutation({
    mutationFn: (body: object) => api.put<WebsiteSettingsDto>('/website', body),
    onSuccess: (s) => {
      qc.setQueryData(['website'], s)
      qc.invalidateQueries({ queryKey: ['public-site'] })
      toast.success('Website design saved')
      onDraft(null)
      onClose()
    },
    onError: (e) => applyApiErrors(form, e),
  })
  const close = useGuardedClose(form.formState.isDirty, () => {
    onDraft(null)
    onClose()
  })

  return (
    <Modal
      open
      onClose={close}
      title="Edit Design"
      subtitle="Changes show in the Live Preview as you type"
      icon="brush"
      size="lg"
      busy={save.isPending}
      footer={
        <>
          <button className="btn btn-ghost" onClick={close} disabled={save.isPending}>
            Cancel
          </button>
          <SubmitButton busy={save.isPending} form="design-form" disabled={!form.formState.isDirty}>
            Save design
          </SubmitButton>
        </>
      }
    >
      <form id="design-form" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <div className="form-grid">
          <SelectField form={form} name="theme" label="Theme" required options={WEBSITE_THEMES.map((t) => ({ value: t, label: t }))} />
          <SelectField form={form} name="font" label="Heading font" required options={WEBSITE_FONTS.map((f) => ({ value: f, label: f }))} />
          <FieldShell label="Accent colour" htmlFor="f-primaryColor" required error={form.formState.errors.primaryColor?.message as string | undefined}>
            <div className="color-field">
              <input type="color" aria-label="Pick accent colour" value={/^#[0-9a-f]{6}$/i.test(primaryColor ?? '') ? primaryColor : '#8b1e3f'} onChange={(e) => form.setValue('primaryColor', e.target.value, { shouldDirty: true, shouldValidate: true })} />
              <input id="f-primaryColor" {...form.register('primaryColor')} />
            </div>
          </FieldShell>
          <TextField form={form} name="tagline" label="Tagline" maxLength={120} showCounter placeholder="Candid wedding stories, told with light." />
          <TextField form={form} name="customDomain" label="Custom domain" placeholder="gallery.yourstudio.com" hint="Point a CNAME record to your studio site. Format is checked; DNS is not." />
          <TextField form={form} name="videoUrl" label="Highlight film (YouTube / Vimeo)" placeholder="https://youtu.be/…" />
          <TextField form={form} name="seoTitle" label="SEO title" maxLength={60} showCounter full placeholder="Golden Hour Studios — Wedding Photographers in Chennai" />
          <TextAreaField form={form} name="seoDescription" label="SEO description" maxLength={160} rows={2} />
        </div>
      </form>
    </Modal>
  )
}

function MyWebsite() {
  const { studio } = useMe()
  const qc = useQueryClient()
  const [url, setUrl] = useUrlState({ design: '', leadsPage: '1' })
  const [draft, setDraft] = useState<Partial<SiteSettings> | null>(null)
  const leadsPage = Math.max(1, Number(url.leadsPage) || 1)

  const q = useQuery({ queryKey: ['website'], queryFn: () => api.get<WebsiteSettingsDto>('/website') })
  const site = useQuery({ queryKey: ['public-site', studio.slug], queryFn: () => api.get<PublicWebsiteDto>(`/public/sites/${studio.slug}`) })
  const leads = useQuery({
    queryKey: ['leads', leadsPage],
    queryFn: () => api.get<Paginated<LeadDto>>('/website/leads', { page: leadsPage, limit: 8 }),
    placeholderData: (p) => p,
  })

  const saveSections = useMutation({
    mutationFn: (sections: WebsiteSectionDto[]) => api.put<WebsiteSettingsDto>('/website', { ...toBody(q.data!), sections: sections.map(({ key, on }) => ({ key, on })) }),
    onMutate: async (sections) => {
      const prev = qc.getQueryData<WebsiteSettingsDto>(['website'])
      qc.setQueryData<WebsiteSettingsDto>(['website'], (s) => (s ? { ...s, sections } : s))
      return { prev }
    },
    onSuccess: (s) => {
      qc.setQueryData(['website'], s)
      toast.success('Website sections saved', { id: 'sections' })
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['website'], ctx.prev)
      toastError(e)
    },
  })

  const w = q.data
  const flip = (key: string) => w && saveSections.mutate(w.sections.map((s) => (s.key === key ? { ...s, on: !s.on } : s)))
  const move = (i: number, dir: -1 | 1) => {
    if (!w) return
    const next = [...w.sections]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    saveSections.mutate(next)
  }
  const previewSettings: SiteSettings | null = w
    ? { sections: w.sections, theme: w.theme, primaryColor: w.primaryColor, font: w.font, tagline: w.tagline, videoUrl: w.videoUrl, ...draft }
    : null
  const siteLink = w?.publicUrl.replace(/^https?:\/\/[^/]+/, window.location.origin)
  const shownDomain = w?.customDomain ?? siteLink?.replace(/^https?:\/\//, '')

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Business Suite"
        featureBadge="Portfolio Builder"
        title="My Studio Website"
        subtitle="Your modern photography portfolio — where couples discover your style, browse previous weddings, and send booking enquiries."
        actions={
          <>
            <FeatureTooltip title="Visit Live Website" summary={`Open ${shownDomain ?? 'your site'} in a new tab to see how couples view your portfolio.`} position="bottom" width={260}>
              <a href={siteLink} target="_blank" rel="noreferrer" className="btn btn-ghost">
                <i className="bi bi-box-arrow-up-right" />
                Visit Site
              </a>
            </FeatureTooltip>

            <FeatureTooltip title="Visual Theme Customizer" summary="Change your theme, colour, font, tagline and highlight film to match your studio branding." position="bottom" width={280}>
              <button className="btn btn-primary" onClick={() => setUrl({ design: '1' })} disabled={!w}>
                <i className="bi bi-brush" />
                Edit Design
              </button>
            </FeatureTooltip>
          </>
        }
      />

      {/* Feature Capabilities Ribbon */}
      <FeatureBar items={websiteFeatures} />

      <div className="grid grid-3">
        <StatCard
          icon="broadcast"
          label="Website Status"
          value={w ? <StatusPill status={w.status} /> : '—'}
          tone={w?.status === 'Live' ? 'green' : 'gold'}
          tooltip={
            w?.status === 'Live'
              ? {
                  title: 'Website Status',
                  badge: 'Online',
                  icon: 'broadcast',
                  summary: 'Your portfolio is live and showing your published albums to couples.',
                }
              : {
                  title: 'Website Status',
                  badge: 'Draft',
                  icon: 'broadcast',
                  summary: 'Your website goes live once your portfolio has at least one item.',
                  highlights: ['Publish a digital album to add it to your portfolio'],
                }
          }
        />
        <StatCard
          icon="eye"
          label="Visits This Month"
          value={w ? formatNumber(w.visits) : '—'}
          tone="blue"
          tooltip={{
            title: 'Website Visits',
            badge: `${formatNumber(w?.visits ?? 0)} Views`,
            icon: 'eye',
            summary: 'Page views of your public studio website.',
            tip: 'Keep your Instagram bio link updated with this URL.',
          }}
        />
        <StatCard
          icon="envelope-heart"
          label="Bridal Enquiries"
          value={w ? w.leadCount : '—'}
          tone="wine"
          tooltip={{
            title: 'Direct High-Intent Enquiries',
            badge: `${w?.leadCount ?? 0} Leads`,
            icon: 'envelope-heart',
            summary: 'Booking enquiries submitted through your website contact form.',
            tip: 'Fast replies close bookings before competitors respond.',
          }}
        />
      </div>

      {q.isError ? (
        <div className="card">
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </div>
      ) : (
        <div className="grid grid-2-1">
          <FeatureTooltip
            title="Interactive Live Browser Preview"
            badge={previewSettings?.theme}
            summary={`Your live portfolio theme is currently '${previewSettings?.theme ?? ''}'. Section and design changes appear here instantly.`}
            position="right"
            width={300}
          >
            <Card title="Live Preview" subtitle={`Theme: ${previewSettings?.theme ?? '…'} · Responsive viewport`}>
              <div className="browser browser-catchy">
                <div className="browser-bar">
                  <i />
                  <i />
                  <i />
                  <span>
                    <i className="bi bi-lock-fill" style={{ background: 'none', width: 'auto', height: 'auto', color: 'var(--success)' }} />
                    https://{shownDomain}
                  </span>
                  <span className="live-badge">LIVE</span>
                </div>
                <div className="site-frame" aria-label="Website preview">
                  {site.data && previewSettings ? <SiteView data={site.data} settings={previewSettings} preview /> : <Skeleton height={320} radius={0} />}
                </div>
              </div>
            </Card>
          </FeatureTooltip>

          <Card title="Page Sections" subtitle="Toggle and reorder — changes save automatically" feature={featureInfo.myWebsite}>
            {!w
              ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={22} style={{ margin: '14px 0' }} />)
              : w.sections.map((s, i) => (
                  <div className="section-row" key={s.key}>
                    <Toggle label={s.label} checked={s.on} onChange={() => flip(s.key)} feature={sectionTooltips[s.key]} disabled={saveSections.isPending} />
                    <span className="section-order">
                      <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0 || saveSections.isPending} aria-label={`Move ${s.label} up`}>
                        <i className="bi bi-arrow-up" />
                      </button>
                      <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === w.sections.length - 1 || saveSections.isPending} aria-label={`Move ${s.label} down`}>
                        <i className="bi bi-arrow-down" />
                      </button>
                    </span>
                  </div>
                ))}
          </Card>
        </div>
      )}

      <Card title="Website Enquiries" subtitle="Leads from your enquiry form, newest first" flush>
        {leads.isPending ? (
          <TableSkeleton rows={4} cols={5} />
        ) : leads.isError ? (
          <ErrorState error={leads.error} onRetry={() => leads.refetch()} />
        ) : leads.data.data.length === 0 ? (
          <EmptyState icon="envelope-heart" title="No enquiries yet" text="Share your website link on Instagram and WhatsApp — enquiries will show up here." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Wedding date</th>
                  <th>City</th>
                  <th>Message</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {leads.data.data.map((l) => (
                  <tr key={l.id}>
                    <td className="cell-main">{l.name}</td>
                    <td>
                      <a className="link" href={`https://wa.me/${l.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
                        {l.phone}
                      </a>
                      {l.email && <div className="cell-sub">{l.email}</div>}
                    </td>
                    <td>{formatDate(l.eventDate)}</td>
                    <td>{l.city ?? '—'}</td>
                    <td className="cell-sub" style={{ maxWidth: 280 }}>
                      {l.message ?? '—'}
                    </td>
                    <td>{timeAgo(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {leads.data && <Pagination page={leadsPage} limit={leads.data.meta.limit} total={leads.data.meta.total} onPage={(p) => setUrl({ leadsPage: String(p) })} />}
      </Card>

      {url.design === '1' && w && <DesignModal settings={w} onClose={() => setUrl({ design: '' })} onDraft={setDraft} />}
    </div>
  )
}

export default MyWebsite
