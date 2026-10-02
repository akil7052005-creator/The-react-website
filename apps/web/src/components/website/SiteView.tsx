import { leadSchema, type PublicWebsiteDto, type WebsiteSectionDto } from '@weddyzone/shared'
import { useMutation } from '@tanstack/react-query'
import { useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import poster from '../../assets/wedding-photo.jpg'
import { api } from '../../lib/api'
import { fileUrl } from '../../lib/env'
import { applyApiErrors, SubmitButton, TextAreaField, TextField, useZodForm } from '../form/form'

export interface SiteSettings {
  sections: WebsiteSectionDto[]
  theme: string
  primaryColor: string
  font: string
  tagline: string | null
  videoUrl: string | null
}

const themes: Record<string, { bg: string; surface: string; text: string; muted: string }> = {
  'Ivory Classic': { bg: '#faf6f0', surface: '#ffffff', text: '#2a1e22', muted: '#8f8286' },
  'Midnight Noir': { bg: '#15100f', surface: '#211a18', text: '#f5ede4', muted: '#b3a79f' },
  'Blush Editorial': { bg: '#fbeff0', surface: '#ffffff', text: '#3b2229', muted: '#9a7d84' },
  'Heritage Gold': { bg: '#fffaf0', surface: '#fffdf7', text: '#2f2414', muted: '#8a7a5c' },
}

/** YouTube/Vimeo watch URL → embeddable URL. */
export function embedUrl(url: string | null): string | null {
  if (!url) return null
  const yt = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{6,})/)
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`
  return null
}

function LeadForm({ slug }: { slug: string }) {
  const [done, setDone] = useState<string | null>(null)
  const form = useZodForm(leadSchema, { defaultValues: { name: '', phone: '', email: '', eventDate: '', city: '', message: '', company: '' } })
  const send = useMutation({
    mutationFn: (body: object) => api.post<{ message: string }>(`/public/sites/${slug}/leads`, body),
    onSuccess: (r) => {
      setDone(r.message)
      toast.success(r.message)
      form.reset()
    },
    onError: (e) => applyApiErrors(form, e),
  })
  if (done) {
    return (
      <p className="notice success" role="status">
        <i className="bi bi-check2-circle" /> {done}
      </p>
    )
  }
  return (
    <form className="site-lead-form" onSubmit={form.handleSubmit((v) => send.mutate(v))} noValidate>
      <div className="form-grid">
        <TextField form={form} name="name" label="Your name" required maxLength={80} />
        <TextField form={form} name="phone" label="Mobile number" type="tel" required />
        <TextField form={form} name="email" label="Email" type="email" />
        <TextField form={form} name="eventDate" label="Wedding date" type="date" />
        <TextField form={form} name="city" label="City" maxLength={60} />
        {/* Honeypot: hidden from people, bots fill it in. */}
        <div className="site-hp" aria-hidden="true">
          <label htmlFor="f-company">Company</label>
          <input id="f-company" tabIndex={-1} autoComplete="off" {...form.register('company')} />
        </div>
        <TextAreaField form={form} name="message" label="Tell us about your wedding" maxLength={1000} rows={3} />
      </div>
      <div className="form-foot">
        <SubmitButton busy={send.isPending} className="btn btn-primary" icon="send">
          Send enquiry
        </SubmitButton>
      </div>
    </form>
  )
}

/**
 * The studio's public website. `preview` renders a non-interactive version for
 * the Live Preview in My Website.
 */
export function SiteView({ data, settings, preview = false }: { data: PublicWebsiteDto; settings: SiteSettings; preview?: boolean }) {
  const t = themes[settings.theme] ?? themes['Ivory Classic']
  const accent = settings.primaryColor
  const style = {
    '--site-bg': t.bg,
    '--site-surface': t.surface,
    '--site-text': t.text,
    '--site-muted': t.muted,
    '--site-accent': accent,
    '--site-font': `'${settings.font}', var(--font-display)`,
  } as CSSProperties
  const heroBanner = data.banners.find((b) => b.placement === 'WEBSITE_HERO') ?? data.banners.find((b) => b.placement === 'GALLERY_HERO')
  const video = embedUrl(settings.videoUrl)
  const on = settings.sections.filter((s) => s.on)

  const section = (s: WebsiteSectionDto) => {
    switch (s.key) {
      case 'portfolio':
        return (
          <section key={s.key} className="site-section" id="portfolio">
            <h2>Portfolio</h2>
            {data.albums.length === 0 ? (
              <p className="site-muted">Our latest wedding stories will appear here soon.</p>
            ) : (
              <div className="site-albums">
                {data.albums.map((a) => (
                  <a key={a.link} className="site-album" href={preview ? undefined : a.link} target="_blank" rel="noreferrer">
                    {a.coverUrl ? <img src={fileUrl(a.coverUrl)} alt="" loading="lazy" /> : <span className="site-album-ph" />}
                    <strong>{a.title}</strong>
                    {a.subtitle && <small>{a.subtitle}</small>}
                  </a>
                ))}
              </div>
            )}
          </section>
        )
      case 'packages':
        return (
          <section key={s.key} className="site-section" id="packages">
            <h2>Packages & pricing</h2>
            <p className="site-muted">Every wedding is different. Send us your dates and we'll share packages tailored to your celebration.</p>
          </section>
        )
      case 'about':
        return data.studio.bio ? (
          <section key={s.key} className="site-section" id="about">
            <h2>About {data.studio.name}</h2>
            <p>{data.studio.bio}</p>
          </section>
        ) : null
      case 'video':
        return video ? (
          <section key={s.key} className="site-section" id="film">
            <h2>Highlight film</h2>
            <div className="site-video">
              {preview ? <div className="site-video-ph"><i className="bi bi-play-circle" /></div> : <iframe src={video} title="Highlight film" allowFullScreen loading="lazy" />}
            </div>
          </section>
        ) : null
      case 'enquiry':
        return (
          <section key={s.key} className="site-section" id="enquire">
            <h2>Check availability</h2>
            {preview ? <p className="site-muted">Couples fill in a short enquiry form here. Enquiries arrive in My Website and your notifications.</p> : <LeadForm slug={data.studio.slug} />}
          </section>
        )
      case 'reviews':
      case 'blog':
        // No reviews/blog content in v1 — the sections render only in the studio's preview as placeholders.
        return preview ? (
          <section key={s.key} className="site-section">
            <h2>{s.label}</h2>
            <p className="site-muted">Coming soon.</p>
          </section>
        ) : null
      default:
        return null
    }
  }

  return (
    <div className={`site${preview ? ' site-preview' : ''}`} style={style}>
      <header className="site-nav">
        <strong>{data.studio.name}</strong>
        <nav>
          {on.some((s) => s.key === 'portfolio') && <a href="#portfolio">Portfolio</a>}
          {on.some((s) => s.key === 'enquiry') && <a href="#enquire">Enquire</a>}
        </nav>
      </header>
      <section className="site-hero">
        <img src={heroBanner ? fileUrl(heroBanner.imageUrl) : poster} alt="" />
        <div className="site-hero-text">
          <h1>{data.studio.name}</h1>
          <p>{settings.tagline || `Wedding photography${data.studio.city ? ` · ${data.studio.city}` : ''}`}</p>
          {heroBanner?.ctaText && heroBanner.ctaUrl && (
            <a className="site-cta" href={preview ? undefined : heroBanner.ctaUrl} target="_blank" rel="noreferrer">
              {heroBanner.ctaText}
            </a>
          )}
        </div>
      </section>
      {on.map(section)}
      <footer className="site-foot">
        <span>
          © {new Date().getFullYear()} {data.studio.name}
        </span>
        <span>
          {data.studio.phone}
          {data.studio.email ? ` · ${data.studio.email}` : ''}
        </span>
      </footer>
    </div>
  )
}
