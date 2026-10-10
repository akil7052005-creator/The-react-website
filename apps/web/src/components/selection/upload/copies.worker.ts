/// <reference lib="webworker" />
// Makes each photo's preview and thumbnail off the main thread, so the page never freezes during
// a big upload.

import { makeCopies, Undecodable, type Copies } from './copies'

export interface CopiesRequest {
  id: number
  file: Blob
  raw: boolean
  /** The original's bytes when `file` is a converted copy (HEIC): the fingerprint is of the original. */
  data?: ArrayBuffer
}
export type CopiesResponse = ({ id: number; ok: true } & Copies) | { id: number; ok: false; undecodable: boolean; error: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = async (e: MessageEvent<CopiesRequest>) => {
  const { id, file, raw, data } = e.data
  try {
    const out = await makeCopies(file, { raw, data })
    ctx.postMessage({ id, ok: true, ...out } satisfies CopiesResponse)
  } catch (err) {
    ctx.postMessage({ id, ok: false, undecodable: err instanceof Undecodable, error: (err as Error).message || 'Could not make the preview' } satisfies CopiesResponse)
  }
}
