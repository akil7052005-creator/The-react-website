import aboutJpg from '../../../assets/Wedding_image.jpg'
import heroJpg from '../../../assets/home-hero-mandap.jpg'
import { useMeQuery } from '../../../auth/AuthProvider'
import { HeroActions, SignupCard } from '../../../components/public/HeroSignup'
import { PricingSection } from '../../../components/public/PricingSection'
import { PublicShell, SectionTitle, usePageMeta } from '../../../components/public/PublicShell'
import type { Arrival } from '../../../components/public/SiteHeader'
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

const META: Record<Arrival | 'home', [string, string]> = {
  home: ['Photo selection for wedding studios', `${APP_NAME}: upload a wedding, share it on WhatsApp and get the couple's photo picks back. Free 14-day trial.`],
  about: ['About Us', `The story behind ${APP_NAME}, photo selection made for Indian wedding studios.`],
  pricing: ['Plans & Pricing', 'Trial, Pro and VIP plans for wedding studios, for 1, 6 or 12 months. Start with a free 14-day trial.'],
  login: ['Log in', `Log in to your ${APP_NAME} studio.`],
  signup: ['Start free trial', `Create your ${APP_NAME} studio: free for 14 days, no card needed.`],
}

/**
 * Public home page (logged-in studios get their dashboard at / instead): the hero with the Create
 * your studio card. /about, /pricing and /login show it with that menu panel open (About and
 * Pricing scroll to their section on phones); /signup focuses the card.
 */
export default function Home({ panel }: { panel?: Arrival }) {
  usePageMeta(...META[panel ?? 'home'])
  // /about, /pricing and /login also reach logged-in studios: no sign-up card for them.
  const signedIn = Boolean(useMeQuery({ cached: true }).data?.studio)
  return (
    <PublicShell panel={panel}>
      <section className="pub-hero pub-hero-fixed">
        <img className="pub-hero-img" src={heroJpg} alt="Floral wedding mandap with a decorated stage sofa" fetchPriority="high" />
        <div className={`pub-wrap pub-hero-grid${signedIn ? ' solo' : ''}`}>
          <div className="pub-hero-copy">
            <p className="pub-tagline">For wedding photographers</p>
            <h1>Photo selection made simple for wedding studios</h1>
            <p className="pub-hero-line">Upload a wedding, share it on WhatsApp and get the couple's picks back, with your originals safe on your computer.</p>
            <HeroActions signedIn={signedIn} />
          </div>
          {!signedIn && <SignupCard />}
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

      <section className="pub-section alt" id="about" aria-labelledby="about-title">
        <div className="pub-wrap pub-about">
          <div>
            <SectionTitle id="about-title">About {APP_NAME}</SectionTitle>
            <p className="pub-lead">We build simple tools for wedding studios, so choosing photos becomes the easy part of the job.</p>
            <p className="pub-placeholder">[Owner to write] Our story: who we are, why we started, and the studios we work with.</p>
            <p className="pub-placeholder">[Owner to write] What we believe: originals stay with the photographer, couples pick on their phone, no app to install.</p>
          </div>
          <img className="pub-about-img" src={aboutJpg} alt="A couple's hands with wedding rings" loading="lazy" />
        </div>
        <div className="pub-wrap">
          <div className="pub-cards three pub-values">
            <article className="pub-card">
              <h3>
                <i className="bi bi-shield-lock" aria-hidden="true" /> Your originals stay yours
              </h3>
              <p>Only light previews go online. The full-size photos never leave your computer.</p>
            </article>
            <article className="pub-card">
              <h3>
                <i className="bi bi-phone" aria-hidden="true" /> Made for phones
              </h3>
              <p>Couples open the link on WhatsApp and pick on any phone, with no app or account.</p>
            </article>
            <article className="pub-card">
              <h3>
                <i className="bi bi-lightning-charge" aria-hidden="true" /> Fast delivery
              </h3>
              <p>Copy exactly the selected originals into a folder in one click, ready for editing.</p>
            </article>
          </div>
        </div>
      </section>

      <PricingSection />
    </PublicShell>
  )
}
