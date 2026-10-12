import { useState } from 'react'
import { DEMO_VIDEO_URL } from '../../lib/env'
import { SignupForm } from '../../pages/auth/Signup'
import { Modal } from '../Modal'
import { Arrow } from './PublicShell'
import { SIGNUP_CARD_ID, usePublicMenu } from './SiteHeader'

/** The hero's buttons: Start Free Trial (the card's first field), Watch demo, and Login. */
export function HeroActions({ signedIn }: { signedIn: boolean }) {
  const { startTrial, openPanel } = usePublicMenu()
  const [demo, setDemo] = useState(false)
  return (
    <>
      <div className="pub-actions">
        <button type="button" className="pub-btn" onClick={() => startTrial()}>
          {signedIn ? 'Go to dashboard' : 'Start Free Trial'} <Arrow />
        </button>
        {DEMO_VIDEO_URL && (
          <button type="button" className="pub-btn ghost pub-demo-btn" onClick={() => setDemo(true)} aria-haspopup="dialog">
            <i className="bi bi-play-circle-fill" aria-hidden="true" /> Watch demo <small>2 min · how it works</small>
          </button>
        )}
      </div>
      {!signedIn && (
        <p className="pub-hero-login">
          Already have an account?{' '}
          <button type="button" className="pub-link light" onClick={() => openPanel('login')}>
            Login →
          </button>
        </p>
      )}
      {DEMO_VIDEO_URL && <DemoVideo open={demo} onClose={() => setDemo(false)} url={DEMO_VIDEO_URL} />}
    </>
  )
}

/** YouTube / Vimeo links play in their embed; anything else as a video file. */
function embedUrl(url: string) {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/)
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&rel=0`
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}?autoplay=1`
  return null
}

/** The demo in a dialog: Esc or a click outside closes it, and closing stops it (the player is removed). */
function DemoVideo({ open, onClose, url }: { open: boolean; onClose: () => void; url: string }) {
  const embed = embedUrl(url)
  return (
    <Modal open={open} onClose={onClose} title="How Wedmanage works" icon="play-circle" size="lg">
      {open && (
        <div className="pub-demo-frame">
          {embed ? (
            <iframe src={embed} title="Demo video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
          ) : (
            <video src={url} controls autoPlay playsInline aria-label="Demo video" />
          )}
        </div>
      )}
    </Modal>
  )
}

/** Create your studio: always visible next to the hero (not a popup). */
export function SignupCard() {
  const { signupPlan, setSignupPlan } = usePublicMenu()
  return (
    <section id={SIGNUP_CARD_ID} className="pub-signup-card" aria-labelledby="signup-title">
      <h2 id="signup-title">Create your studio</h2>
      <SignupForm plan={signupPlan} onPlanChange={setSignupPlan} />
    </section>
  )
}
