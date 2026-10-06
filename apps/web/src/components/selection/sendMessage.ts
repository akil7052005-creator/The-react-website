import { selectPath, type SendVia } from '@weddyzone/shared'
import { appLinks } from '../../lib/env'

export interface SendLinks {
  android: string | null
  ios: string | null
  /** Null until the public address (VITE_PUBLIC_APP_URL) is set. */
  web: string | null
}

/** Who the message is for and what it's about. */
export interface MessageEvent {
  customerName: string
  eventTitle: string
  code: string
}

/** One link in a message: its label, then the URL alone on the next line. */
interface MessageLink {
  label: string
  url: string
}

/**
 * Our customer message, used by every Send option:
 *
 *   Hi <Name>! 📸 Your <Event> photos from <Studio> are ready for you to pick.
 *
 *   Open your gallery:
 *   https://<public address>/select/<token>
 *
 *   Access code: <code>
 *
 *   Questions? Reply here or call <studio phone>
 *
 * Each URL sits alone on its line with a blank line after it (nothing touching its end), so WhatsApp
 * and SMS apps link the whole address. No period after the phone number, so it stays tappable too.
 * Without a studio phone the last line is "Questions? Reply here."
 */
function customerMessage(event: MessageEvent, studio: { name: string; phone: string | null }, links: MessageLink[]): string {
  return [
    `Hi ${event.customerName}! 📸 Your ${event.eventTitle} photos from ${studio.name} are ready for you to pick.`,
    ...links.map((l) => `${l.label}\n${l.url}`),
    `Access code: ${event.code}`,
    studio.phone ? `Questions? Reply here or call ${studio.phone}` : 'Questions? Reply here.',
  ].join('\n\n')
}

/** What the customer message needs about a selection. */
export interface CustomerMessageInput extends MessageEvent {
  /** The selection's share token: the link is <VITE_PUBLIC_APP_URL>/select/<token>. */
  shareToken: string
  studio: { name: string; phone: string | null }
}

/**
 * THE customer message, the same text for Send on WhatsApp, Send SMS, Copy message and Copy full
 * message, so pasting it anywhere gives exactly what WhatsApp sends. Null until the public address
 * (VITE_PUBLIC_APP_URL) is set: a message without its link is never sent.
 */
export function buildCustomerMessage(selection: CustomerMessageInput, base: string | null = appLinks.origin): string | null {
  const link = shareLink(selection.shareToken, base)
  return link ? customerMessage(selection, selection.studio, [{ label: 'Open your gallery:', url: link }]) : null
}

/** The link(s) of one Send Options card: its own link only, or all three for "All with Message". */
function cardLinks(option: SendVia, links: SendLinks): MessageLink[] {
  const android = links.android ? { label: 'Android app:', url: links.android } : null
  const ios = links.ios ? { label: 'iOS app:', url: links.ios } : null
  const web = links.web ? { label: 'Open your gallery:', url: links.web } : null
  switch (option) {
    case 'android':
      return android ? [android] : []
    case 'ios':
      return ios ? [ios] : []
    case 'all':
      return [android, ios, web].filter((l): l is MessageLink => !!l)
    default:
      return web ? [web] : []
  }
}

/** The WhatsApp message for one Send Options card. A link that isn't configured is left out. */
export function buildSendMessage(
  event: MessageEvent,
  studio: { name: string; phone: string | null },
  option: SendVia,
  links: SendLinks = appLinks,
): string {
  return customerMessage(event, studio, cardLinks(option, links))
}

/** Indian mobile number as WhatsApp wants it (91 + 10 digits), or null when it isn't one. */
export function whatsappPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`
  if (/^91[6-9]\d{9}$/.test(digits)) return digits
  if (/^0[6-9]\d{9}$/.test(digits)) return `91${digits.slice(1)}`
  return null
}

/** Opens WhatsApp with the message; without a valid phone WhatsApp asks who to send it to. */
export function whatsappSendUrl(phone: string | null | undefined, message: string) {
  const to = whatsappPhone(phone)
  return `https://api.whatsapp.com/send?${to ? `phone=${to}&` : ''}text=${encodeURIComponent(message)}`
}

// ---------------------------------------------------------------- Send/Share (Copy Link, QR, SMS, WhatsApp)

/** The customer's own link: https://<public address>/select/<token>, or null until the public address is set. */
export function shareLink(shareToken: string, base: string | null = appLinks.origin) {
  return base ? `${base}${selectPath(shareToken)}` : null
}

/** The links a Send/Share message can carry; null ones are left out. */
export interface ShareLinks {
  /** The customer's own link (/select/<token>). */
  personal: string | null
  /** Code-only sign-in (/selection/auth). */
  web: string | null
  android: string | null
  ios: string | null
}
export type ShareLinkKey = keyof ShareLinks

const LINK_INTRO: Record<ShareLinkKey, string> = {
  personal: 'Open your gallery:',
  web: 'Or sign in with your access code:',
  android: 'Android app:',
  ios: 'iOS app:',
}

/**
 * The message for one link (only) or for all of them (the full message), in the customer-message
 * layout above: the link(s), each URL on its own line, then the access code. Links that aren't set are left out.
 */
export function buildOptionMessage(
  event: MessageEvent,
  studio: { name: string; phone: string | null },
  links: ShareLinks,
  only?: ShareLinkKey,
): string {
  const keys = (only ? [only] : (Object.keys(LINK_INTRO) as ShareLinkKey[])).filter((k) => links[k])
  const items = keys.map((k) => ({ label: only === 'web' ? 'Open your gallery:' : LINK_INTRO[k], url: links[k]! }))
  return customerMessage(event, studio, items)
}

/** wa.me with the whole message encoded (encodeURIComponent); without a valid phone WhatsApp asks who to send it to. */
export function whatsappMeUrl(phone: string | null | undefined, message: string) {
  const to = whatsappPhone(phone)
  return `https://wa.me/${to ?? ''}?text=${encodeURIComponent(message)}`
}

/** The phone's SMS app with the message filled in. */
export function smsUrl(phone: string | null | undefined, message: string) {
  const digits = (phone ?? '').replace(/[^\d+]/g, '')
  return `sms:${digits}?body=${encodeURIComponent(message)}`
}
