import { Link } from 'react-router-dom'
import aboutJpg from '../../../assets/Wedding_image.jpg'
import { Arrow, PublicShell, SectionTitle, usePageMeta } from '../../../components/public/PublicShell'
import { APP_NAME } from '../../../lib/brand'

/** About Us: a short story and a photo. The owner writes the final text. */
export default function About() {
  usePageMeta('About Us', `The story behind ${APP_NAME}, photo selection made for Indian wedding studios.`)
  return (
    <PublicShell>
      <section className="pub-section first">
        <div className="pub-wrap pub-about">
          <div>
            <h1 className="pub-h1">About {APP_NAME}</h1>
            <p className="pub-lead">We build simple tools for wedding studios, so choosing photos becomes the easy part of the job.</p>
            <p className="pub-placeholder">[Owner to write] Our story: who we are, why we started, and the studios we work with.</p>
            <p className="pub-placeholder">[Owner to write] What we believe: originals stay with the photographer, couples pick on their phone, no app to install.</p>
            <Link to="/signup" className="pub-btn">
              Start free trial <Arrow />
            </Link>
          </div>
          <img className="pub-about-img" src={aboutJpg} alt="A couple's hands with wedding rings" loading="lazy" />
        </div>
      </section>
      <section className="pub-section alt" aria-labelledby="values">
        <div className="pub-wrap">
          <SectionTitle id="values">What we care about</SectionTitle>
          <div className="pub-cards three">
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
    </PublicShell>
  )
}
