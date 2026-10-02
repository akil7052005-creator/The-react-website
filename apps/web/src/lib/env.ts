/// <reference types="vite/client" />

// Read each variable as `import.meta.env.NAME` so Vite inlines just that value. Copying the whole
// `import.meta.env` object would embed every VITE_/FEATURE_ variable in the production bundle.
const VITE_API_URL: string | undefined = import.meta.env.VITE_API_URL
const FEATURE_FACE_RECOGNITION: string | undefined = import.meta.env.FEATURE_FACE_RECOGNITION

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
