/// <reference types="vite/client" />

// Read each variable as `import.meta.env.NAME` so Vite inlines just that value. Copying the whole
// `import.meta.env` object would embed every VITE_/FEATURE_ variable in the production bundle.
const VITE_API_URL: string | undefined = import.meta.env.VITE_API_URL
const FEATURE_FACE_RECOGNITION: string | undefined = import.meta.env.FEATURE_FACE_RECOGNITION
const VITE_ANDROID_APP_URL: string | undefined = import.meta.env.VITE_ANDROID_APP_URL
const VITE_IOS_APP_URL: string | undefined = import.meta.env.VITE_IOS_APP_URL
const VITE_PUBLIC_APP_URL: string | undefined = import.meta.env.VITE_PUBLIC_APP_URL
const VITE_APP_NAME: string | undefined = import.meta.env.VITE_APP_NAME
const VITE_ALLOW_LAN_LINKS: string | undefined = import.meta.env.VITE_ALLOW_LAN_LINKS

/** Empty in the usual setup: /api is proxied by Vite (dev) and rewritten by Vercel (prod). */
export const API_BASE = (VITE_API_URL ?? '').replace(/\/$/, '')

export const features = {
  /** AI Face Recognition is out of scope for v1. The code stays, hidden behind this flag. */
  faceRecognition: FEATURE_FACE_RECOGNITION === 'true',
}

/** Turns an API-relative file URL (/api/v1/files/…) into one the browser can load. */
export function fileUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  return path.startsWith('http') ? path : `${API_BASE}${path}`
}

/** Shown in "Powered by …" on the customer pages. */
export const APP_NAME = VITE_APP_NAME?.trim() || 'Wedmanage Studio'

const clean = (v: string | undefined) => v?.trim().replace(/\/+$/, '') || null

/**
 * Links the studio sends its customers (Send Options). The store links stay null until they are
 * set; the web link falls back to this site's address.
 */
/** This computer (localhost, 127.x, 0.0.0.0, ::1): never in a customer link. */
export const isLoopbackUrl = (url: string) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(url)
/** A private-network (Wi-Fi) address: 10.x, 172.16–31.x, 192.168.x. */
export const isPrivateNetworkUrl = (url: string) => /^https?:\/\/(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/i.test(url)
/** A link a customer can't open from anywhere (this computer, or a private address). */
export const isLocalUrl = (url: string) => isLoopbackUrl(url) || isPrivateNetworkUrl(url)

/**
 * The address customer links are built on, or null when there isn't a usable one. This computer is
 * always refused; a private-network address only when `allowLan` (Wi-Fi testing).
 */
export function resolvePublicBase(value: string | undefined, allowLan: boolean): string | null {
  const v = clean(value)
  if (!v || isLoopbackUrl(v)) return null
  if (isPrivateNetworkUrl(v)) return allowLan ? v : null
  return v
}

/**
 * Wi-Fi testing only: VITE_ALLOW_LAN_LINKS=true under `pnpm dev` lets VITE_PUBLIC_APP_URL be this
 * computer's network address (e.g. http://192.168.1.4:5173) so a phone on the same Wi-Fi can open it.
 * Always off in a production build.
 */
export const lanLinksAllowed = import.meta.env.DEV && VITE_ALLOW_LAN_LINKS === 'true'

/** The public address customers open (VITE_PUBLIC_APP_URL). Never this computer: null until it is set. */
const publicBase = resolvePublicBase(VITE_PUBLIC_APP_URL, lanLinksAllowed)

export const appLinks = {
  android: clean(VITE_ANDROID_APP_URL),
  ios: clean(VITE_IOS_APP_URL),
  /** Code-only sign-in (/selection/auth) on the public address, or null when that isn't set. */
  web: publicBase ? `${publicBase}/selection/auth` : null,
  /** The public address for share links (/select/<token>), or null when it isn't set. */
  origin: publicBase,
}
