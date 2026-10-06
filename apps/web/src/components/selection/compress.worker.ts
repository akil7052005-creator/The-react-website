/// <reference lib="webworker" />
// Compresses photos off the main thread so the page stays responsive during a big upload.

import { compressImage, Undecodable } from './imageCompress'

export interface CompressRequest {
  id: number
  file: Blob
  raw: boolean
}
export type CompressResponse =
  | { id: number; ok: true; blob: Blob; width: number; height: number; originalWidth: number | null; originalHeight: number | null; fromPreview: boolean }
  | { id: number; ok: false; undecodable: boolean; error: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = async (e: MessageEvent<CompressRequest>) => {
  const { id, file, raw } = e.data
  try {
    const out = await compressImage(file, { raw })
    ctx.postMessage({ id, ok: true, ...out } satisfies CompressResponse)
  } catch (err) {
    ctx.postMessage({ id, ok: false, undecodable: err instanceof Undecodable, error: (err as Error).message || 'Compression failed' } satisfies CompressResponse)
  }
}
