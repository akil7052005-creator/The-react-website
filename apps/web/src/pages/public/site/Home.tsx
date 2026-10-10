import { Link } from 'react-router-dom'
import heroJpg from '../../../assets/wedding-photo.jpg'
import { Arrow, PublicShell, SectionTitle, usePageMeta } from '../../../components/public/PublicShell'
import { APP_NAME } from '../../../lib/brand'

const STUDIO_STEPS = [
  { icon: 'cloud-arrow-up', text: 'Upload the event folders: only light previews go online, your originals stay on your computer.' },
  { icon: 'whatsapp', text: 'Share the link and code with the couple on WhatsApp in one tap.' },
  { icon: 'folder-check', text: 'Get their picks, then copy the selected originals from your computer in one click.' },
]
const COUPLE_STEPS = [
  { icon: 'link-45deg', text: 'Open the link from the studio on any phone or computer.' },
  { icon: 'key', text: 'Enter the 6-digit code.' },
  { icon: 'heart', text: 'Pick your favourite photos, then submit your selection.' },
]

/** Public home page (logged-in studios get their dashboard at / instead). */
export default function Home() {
  usePageMeta('Photo selection for wedding studios', `${APP_NAME}: upload a wedding, share it on WhatsApp and get the couple's photo picks back. Free 14-day trial.`)
  return (
    <PublicShell>
      <section className="pub-hero">
        <img className="pub-hero-img" src={heroJpg} alt="Bride and groom at their wedding" fetchPriority="high" />
        <div className="pub-wrap pub-hero-copy">
          <p className="pub-tagline">For wedding photographers</p>
          <h1>Let the couple pick their photos, without the back and forth.</h1>
          <div className="pub-actions">
            <Link to="/signup" className="pub-btn">
              Start free trial <Arrow />
            </Link>
            <Link to="/pricing" className="pub-btn ghost">
              See pricing <Arrow />
            </Link>
          </div>
        </div>
      </section>

      <section className="pub-section" aria-labelledby="how">
        <div className="pub-wrap">
          <SectionTitle id="how">How it works</SectionTitle>
          <div className="pub-cards two">
            <article className="pub-card">
              <h3>
                <i className="bi bi-camera" aria-hidden="true" /> For studios
              </h3>
              <ol className="pub-steps">
                {STUDIO_STEPS.map((s) => (
                  <li key={s.icon}>
                    <i className={`bi bi-${s.icon}`} aria-hidden="true" />
                    <span>{s.text}</span>
                  </li>
                ))}
              </ol>
            </article>
            <article className="pub-card">
              <h3>
                <i className="bi bi-hearts" aria-hidden="true" /> For couples
              </h3>
              <ol className="pub-steps">
                {COUPLE_STEPS.map((s) => (
                  <li key={s.icon}>
                    <i className={`bi bi-${s.icon}`} aria-hidden="true" />
                    <span>{s.text}</span>
                  </li>
                ))}
              </ol>
            </article>
          </div>
        </div>
      </section>

      <section className="pub-section alt" aria-labelledby="plans">
        <div className="pub-wrap pub-teaser">
          <div>
            <SectionTitle id="plans">Trial · Pro · VIP</SectionTitle>
            <p>Start free for 14 days. Then pay for 1, 3, 6 or 12 months, and upgrade any time with credit for the days you have left.</p>
          </div>
          <Link to="/pricing" className="pub-btn">
            See all plans <Arrow />
          </Link>
        </div>
      </section>
    </PublicShell>
  )
}
