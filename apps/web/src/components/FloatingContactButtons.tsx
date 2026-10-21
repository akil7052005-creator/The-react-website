import { useLocation } from 'react-router-dom'
import { CONTACT } from '../lib/contact'

const WHATSAPP = CONTACT.find((c) => c.label === 'WhatsApp')!.href!

/** Pages that are not Wedmanage's own: the couple's gallery and album, a studio's own website, admin and print views. */
const HIDDEN_ON = /^\/(s|select|selection|a|w|admin)(\/|$)|\/print$/

/** Floating WhatsApp button, bottom-right, on every page except the hidden ones above. */
export function FloatingContactButtons() {
  const { pathname } = useLocation()
  if (HIDDEN_ON.test(pathname)) return null
  return (
    <div className="fcb">
      <a className="fcb-btn fcb-wa" href={WHATSAPP} target="_blank" rel="noopener noreferrer" aria-label="Chat with us on WhatsApp" title="Chat with us on WhatsApp">
        <i className="bi bi-whatsapp" aria-hidden="true" />
      </a>
    </div>
  )
}
