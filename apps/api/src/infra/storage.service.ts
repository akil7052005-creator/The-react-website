import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Injectable } from '@nestjs/common'
import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { createReadStream } from 'fs'
import { access, mkdir, readdir, rm, stat, writeFile } from 'fs/promises'
import { dirname, join, relative, resolve, sep } from 'path'
import type { Readable } from 'stream'
import { config } from '../config'

/** Opaque key for new uploads: year/month folders + a random UUID, e.g. 2026/10/<uuid>.jpg. */
export function newStorageKey(ext: string, now = new Date()) {
  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`
}

// ---------------------------------------------------------------- photo keys
//
// Photos never reach the bucket as originals: the browser uploads a 2048 px preview and a 400 px
// thumbnail, each under its own prefix. Every photo key the API signs or accepts goes through
// assertPhotoKey, so the upload routes can't write anything else.

/** Largest preview or thumbnail accepted (a 2048 px WebP is about 250–450 KB). */
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024
export const PREVIEW_PREFIX = 'previews/'
export const THUMB_PREFIX = 'thumbs/'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
/** previews/<eventId>/<photoId>.webp|jpg, thumbs/<eventId>/<photoId>.webp|jpg, previews/<eventId>/wm/<name>.jpg */
const PHOTO_KEY = new RegExp(`^(previews|thumbs)/${UUID}/(${UUID}\\.(webp|jpg)|wm/[a-z0-9-]{1,120}\\.jpg)$`)

export const isPhotoKey = (key: string) => PHOTO_KEY.test(key)

export function assertPhotoKey(key: string) {
  if (!isPhotoKey(key)) throw new Error(`Refused storage key outside previews/ and thumbs/: ${key}`)
  return key
}

export const previewKey = (eventId: string, photoId: string, ext: 'webp' | 'jpg') => assertPhotoKey(`${PREVIEW_PREFIX}${eventId}/${photoId}.${ext}`)
export const thumbKey = (eventId: string, photoId: string, ext: 'webp' | 'jpg') => assertPhotoKey(`${THUMB_PREFIX}${eventId}/${photoId}.${ext}`)
/** A preview the server made from the uploaded one (watermark, smaller size). */
export const renderedPreviewKey = (eventId: string, name: string) => assertPhotoKey(`${PREVIEW_PREFIX}${eventId}/wm/${name}.jpg`)

/** Signed upload links last this long. */
export const SIGNED_PUT_SECONDS = 15 * 60

/** A signed upload: PUT exactly `size` bytes of `contentType` to `url` before `expiresAt`. */
export interface SignedPut {
  key: string
  url: string
  /** Headers the browser must send with the PUT. */
  headers: Record<string, string>
  expiresAt: string
}

/** One object in the bucket, for the cleanup report. */
export interface ListedObject {
  key: string
  size: number
}

/** Inclusive byte range, for video seeking (HTTP Range). */
export interface ByteRange {
  start: number
  end: number
}

/**
 * Where uploaded bytes live: S3StorageService (R2 / S3) when S3_BUCKET is set, otherwise
 * LocalStorageService (UPLOAD_DIR on disk, for development). Callers only see storage keys.
 */
export abstract class StorageService {
  /** Stores the bytes and returns an opaque storage key. */
  abstract save(data: Buffer, ext: string, contentType: string): Promise<string>
  /** A stream of the stored bytes (or bytes start..end, inclusive), or null if nothing is stored under the key. */
  abstract open(key: string, range?: ByteRange): Promise<Readable | null>
  abstract remove(key: string): Promise<void>
  /** Stores bytes under a key the caller chose (previews the server makes). */
  abstract saveAt(key: string, data: Buffer, contentType: string): Promise<void>
  /** Byte size of the object, or null when there is none. */
  abstract size(key: string): Promise<number | null>
  /** A link the browser can PUT one preview or thumbnail to (photo keys only). */
  abstract signPut(key: string, contentType: string, size: number): Promise<SignedPut>
  /** Every object (or those under `prefix`), for the cleanup report. */
  abstract list(prefix?: string): AsyncIterable<ListedObject>
}

// ---------------------------------------------------------------- local signed uploads
//
// Without a bucket (development, tests) the browser PUTs to the API itself: /uploads/local/<token>,
// where the token carries the key, type, size and expiry, signed with an HMAC.

const localSecret = () => `local-upload:${config().JWT_REFRESH_SECRET}`

export function localUploadToken(key: string, contentType: string, size: number, expires: number) {
  const body = Buffer.from(JSON.stringify({ k: key, t: contentType, s: size, e: expires })).toString('base64url')
  const sig = createHmac('sha256', localSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

/** The upload a local token allows, or null when it is forged, expired or not a photo key. */
export function readLocalUploadToken(token: string): { key: string; contentType: string; size: number } | null {
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const want = Buffer.from(createHmac('sha256', localSecret()).update(body).digest('base64url'))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as { k: string; t: string; s: number; e: number }
    if (Date.now() > p.e || !isPhotoKey(p.k) || p.s > MAX_PREVIEW_BYTES) return null
    return { key: p.k, contentType: p.t, size: p.s }
  } catch {
    return null
  }
}

@Injectable()
export class LocalStorageService extends StorageService {
  private get root() {
    return resolve(config().UPLOAD_DIR)
  }

  private pathFor(key: string) {
    // Keys are generated by us (date folders + UUID) — still refuse anything that escapes the root.
    const full = resolve(join(this.root, key))
    if (!full.startsWith(this.root)) throw new Error('Invalid storage key')
    return full
  }

  async save(data: Buffer, ext: string, _contentType?: string): Promise<string> {
    const key = newStorageKey(ext)
    await this.saveAt(key, data, _contentType ?? '')
    return key
  }

  async open(key: string, range?: ByteRange): Promise<Readable | null> {
    const full = this.pathFor(key)
    try {
      await access(full)
    } catch {
      return null
    }
    return createReadStream(full, range)
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true })
  }

  async saveAt(key: string, data: Buffer, _contentType: string): Promise<void> {
    const full = this.pathFor(key)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, data)
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await stat(this.pathFor(key))).size
    } catch {
      return null
    }
  }

  async signPut(key: string, contentType: string, size: number): Promise<SignedPut> {
    assertPhotoKey(key)
    const expires = Date.now() + SIGNED_PUT_SECONDS * 1000
    const url = `/api/v1/uploads/local/${localUploadToken(key, contentType, size, expires)}`
    return { key, url, headers: { 'Content-Type': contentType }, expiresAt: new Date(expires).toISOString() }
  }

  async *list(prefix = ''): AsyncIterable<ListedObject> {
    const root = this.root
    async function* walk(dir: string): AsyncIterable<ListedObject> {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const full = join(dir, e.name)
        if (e.isDirectory()) yield* walk(full)
        else yield { key: relative(root, full).split(sep).join('/'), size: (await stat(full)).size }
      }
    }
    for await (const o of walk(root)) if (o.key.startsWith(prefix)) yield o
  }
}

/** Files in a private S3-compatible bucket (Cloudflare R2, AWS S3, MinIO, …). */
@Injectable()
export class S3StorageService extends StorageService {
  private readonly bucket: string
  private readonly client: S3Client

  constructor(client?: S3Client) {
    super()
    const c = config()
    this.bucket = c.S3_BUCKET!
    this.client =
      client ??
      new S3Client({
        region: c.S3_REGION,
        endpoint: c.S3_ENDPOINT || undefined,
        forcePathStyle: c.S3_FORCE_PATH_STYLE,
        credentials: { accessKeyId: c.S3_ACCESS_KEY_ID!, secretAccessKey: c.S3_SECRET_ACCESS_KEY! },
      })
  }

  async save(data: Buffer, ext: string, contentType: string): Promise<string> {
    const key = newStorageKey(ext)
    await this.saveAt(key, data, contentType)
    return key
  }

  async open(key: string, range?: ByteRange): Promise<Readable | null> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range ? 'bytes=' + range.start + '-' + range.end : undefined }),
      )
      return (out.Body as Readable | undefined) ?? null
    } catch (e) {
      if (isMissing(e)) return null
      throw e
    }
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  async saveAt(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType, ContentLength: data.length }))
  }

  async size(key: string): Promise<number | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return out.ContentLength ?? 0
    } catch (e) {
      if (isMissing(e)) return null
      throw e
    }
  }

  /**
   * A presigned PUT straight to the bucket: the photo never passes through the API. Length and type
   * are signed, so the bucket refuses any other size; the API checks the size again before it
   * records the photo.
   */
  async signPut(key: string, contentType: string, size: number): Promise<SignedPut> {
    assertPhotoKey(key)
    if (size > MAX_PREVIEW_BYTES) throw new Error('Preview larger than 2 MB')
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: size })
    const url = await getSignedUrl(this.client, cmd, { expiresIn: SIGNED_PUT_SECONDS, signableHeaders: new Set(['content-type', 'content-length']) })
    return { key, url, headers: { 'Content-Type': contentType }, expiresAt: new Date(Date.now() + SIGNED_PUT_SECONDS * 1000).toISOString() }
  }

  async *list(prefix?: string): AsyncIterable<ListedObject> {
    let token: string | undefined
    do {
      const out = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix || undefined, ContinuationToken: token }))
      for (const o of out.Contents ?? []) if (o.Key) yield { key: o.Key, size: o.Size ?? 0 }
      token = out.IsTruncated ? out.NextContinuationToken : undefined
    } while (token)
  }
}

function isMissing(e: unknown) {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } }
  return err?.name === 'NoSuchKey' || err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404
}

/** Picks the storage backend from the environment (used by CoreModule). */
export function createStorage(): StorageService {
  return config().S3_BUCKET ? new S3StorageService() : new LocalStorageService()
}
