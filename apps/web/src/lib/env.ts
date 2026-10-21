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
const VITE_DEMO_VIDEO_ID: string | undefined = import.meta.env.VITE_DEMO_VIDEO_ID

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

/** The live site: customer links use it in a production build when VITE_PUBLIC_APP_URL is not set. */
const LIVE_SITE = 'https://www.wedmanage.com'
/** A Vercel preview/default address is never a customer link: if a host still has one configured it is ignored. */
const RETIRED_HOST = /\.vercel\.app(\/|$)/i

/** The configured address, or the live site in production when it is unset or still the old one. */
export function choosePublicBase(value: string | undefined, allowLan: boolean, production: boolean): string | null {
  const v = clean(value)
  return resolvePublicBase(v && !RETIRED_HOST.test(v) ? v : production ? LIVE_SITE : undefined, allowLan)
}

/** The public address customers open (VITE_PUBLIC_APP_URL; the live site in production). Never this computer. */
const publicBase = choosePublicBase(VITE_PUBLIC_APP_URL, lanLinksAllowed, import.meta.env.PROD)

export const appLinks = {
  android: clean(VITE_ANDROID_APP_URL),
  ios: clean(VITE_IOS_APP_URL),
  /** Code-only sign-in (/selection/auth) on the public address, or null when that isn't set. */
  web: publicBase ? `${publicBase}/selection/auth` : null,
  /** The public address for share links (/select/<token>), or null when it isn't set. */
  origin: publicBase,
}

/** The home page's "Watch demo" video: a YouTube video id. The button is hidden without it. */
export const DEMO_VIDEO_ID = VITE_DEMO_VIDEO_ID?.trim() || null
