/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly FEATURE_FACE_RECOGNITION?: string
}

const env = import.meta.env as unknown as ImportMetaEnv

/** Empty in the usual setup: /api is proxied by Vite (dev) and rewritten by Vercel (prod). */
export const API_BASE = (env.VITE_API_URL ?? '').replace(/\/$/, '')

export const features = {
  /** AI Face Recognition is out of scope for v1. The code stays, hidden behind this flag. */
  faceRecognition: env.FEATURE_FACE_RECOGNITION === 'true',
}

/** Turns an API-relative file URL (/api/v1/files/…) into one the browser can load. */
export function fileUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  return path.startsWith('http') ? path : `${API_BASE}${path}`
}
