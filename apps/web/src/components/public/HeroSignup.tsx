import * as Dialog from '@radix-ui/react-dialog'
import { useRef, useState, type RefObject } from 'react'
import { DEMO_VIDEO_ID } from '../../lib/env'
import { SignupForm } from '../../pages/auth/Signup'
import { Arrow } from './PublicShell'
import { SIGNUP_CARD_ID, usePublicMenu } from './SiteHeader'

/** The hero's buttons: Start Free Trial (the card's first field), Watch demo, and Login. */
export function HeroActions({ signedIn }: { signedIn: boolean }) {
  const { startTrial, openPanel } = usePublicMenu()
  const [demo, setDemo] = useState(false)
  const demoButton = useRef<HTMLButtonElement>(null)
  return (
    <>
      <div className="pub-actions">
        <button type="button" className="pub-btn" onClick={() => startTrial()}>
          {signedIn ? 'Go to dashboard' : 'Start Free Trial'} <Arrow />
        </button>
        {DEMO_VIDEO_ID && (
          <button ref={demoButton} type="button" className="pub-demo-btn" onClick={() => setDemo(true)} aria-haspopup="dialog" aria-label="Watch demo video">
            <span className="pub-demo-play" aria-hidden="true">
              <i className="bi bi-play-fill" />
            </span>
            <span className="pub-demo-text">
              <strong>Watch demo</strong>
              <small>2 min · how it works</small>
            </span>
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
      {DEMO_VIDEO_ID && <DemoVideo open={demo} onClose={() => setDemo(false)} id={DEMO_VIDEO_ID} returnFocus={demoButton} />}
    </>
  )
}

/**
 * The demo on YouTube (privacy mode), in a dark popup. The player is only added while the popup is
 * open, so closing it (✕, Esc or a click outside) stops the video; focus goes back to the button.
 */
function DemoVideo({ open, onClose, id, returnFocus }: { open: boolean; onClose: () => void; id: string; returnFocus: RefObject<HTMLButtonElement | null> }) {
  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="pub-video-overlay">
          <Dialog.Content
            className="pub-video"
            aria-describedby={undefined}
            onCloseAutoFocus={(e) => {
              e.preventDefault()
              returnFocus.current?.focus()
            }}
          >
            <Dialog.Title className="sr-only">Wedmanage demo</Dialog.Title>
            <Dialog.Close className="pub-video-x" aria-label="Close video">
              <i className="bi bi-x-lg" aria-hidden="true" />
            </Dialog.Close>
            <div className="pub-video-frame">
              <iframe src={src} title="Wedmanage demo" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
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
