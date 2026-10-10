import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { PrismaClient, type StoredFile } from '@prisma/client'
import { createStorage, isPhotoKey, previewKey, thumbKey, type StorageService } from '../src/infra/storage.service'
import { readAll, renderUploadCopies } from '../src/selections/previews.service'

/**
 * Cleans the original photos out of storage (R2), safely, in three separate runs:
 *
 *   pnpm --filter @weddyzone/api r2:originals                     dry run: report only, deletes nothing
 *   pnpm --filter @weddyzone/api r2:originals -- --generate       makes the missing previews + thumbnails
 *   pnpm --filter @weddyzone/api r2:originals -- --delete --confirm   deletes the originals (after the owner says yes)
 *
 * The report lists every object outside previews/ and thumbs/, sorted into:
 *   photo-original   a photo's full-size original (kept beside a compressed copy, or uploaded as is)
 *   photo-copy       an older 1600 px customer copy or server-made preview (replaced by previews/)
 *   studio-asset     logos, banners and support attachments: not photos, never deleted here
 *   unknown          in the bucket but not in the database: reported, deleted only with --include-unknown
 *
 * --delete removes photo originals and old copies only when every live photo that used them has its
 * preview and thumbnail under previews/ and thumbs/ (run --generate first). Studio assets are never
 * touched. Each run writes r2-report-<mode>-<time>.json next to where it runs.
 */

type Category = 'photo-original' | 'photo-copy' | 'studio-asset' | 'unknown'

interface Row {
  key: string
  size: number
  category: Category
  fileId: string | null
  /** Live photos that use this object (as file, original or preview). */
  photoIds: string[]
}

const GB = 1024 ** 3
const gb = (n: number) => Math.round((n / GB) * 1000) / 1000

export async function classify(prisma: PrismaClient, storage: StorageService) {
  const files = await prisma.storedFile.findMany({
    include: {
      photo: { select: { id: true, deletedAt: true, compressed: true } },
      photoOriginal: { select: { id: true, deletedAt: true } },
      photoPreview: { select: { id: true, deletedAt: true } },
    },
  })
  const byKey = new Map(files.map((f) => [f.storageKey, f]))
  const rows: Row[] = []
  for await (const o of storage.list()) {
    if (isPhotoKey(o.key)) continue
    const f = byKey.get(o.key)
    if (!f) {
      rows.push({ key: o.key, size: o.size, category: 'unknown', fileId: null, photoIds: [] })
      continue
    }
    const live = (p: { id: string; deletedAt: Date | null } | null) => (p && !p.deletedAt ? [p.id] : [])
    let category: Category
    if (f.kind !== 'PHOTO') category = 'studio-asset'
    else if (f.photoOriginal) category = 'photo-original'
    else if (f.photo && !f.photo.compressed) category = 'photo-original'
    else category = 'photo-copy'
    rows.push({ key: o.key, size: o.size, category, fileId: f.id, photoIds: [...live(f.photo), ...live(f.photoOriginal), ...live(f.photoPreview)] })
  }
  return rows
}

function summary(rows: Row[]) {
  const by = (c: Category) => rows.filter((r) => r.category === c)
  const line = (c: Category) => ({ count: by(c).length, gb: gb(by(c).reduce((n, r) => n + r.size, 0)) })
  return {
    outsidePreviewsAndThumbs: { count: rows.length, gb: gb(rows.reduce((n, r) => n + r.size, 0)) },
    photoOriginals: line('photo-original'),
    oldPhotoCopies: line('photo-copy'),
    studioAssetsKept: line('studio-asset'),
    unknown: line('unknown'),
  }
}

/** Live photos without a preview + thumbnail under previews/ and thumbs/. */
export async function photosMissingPreviews(prisma: PrismaClient) {
  const photos = await prisma.photo.findMany({
    where: { deletedAt: null, file: { mimeType: { startsWith: 'image/' } } },
    include: { file: true, thumb: true, originalFile: true },
  })
  return photos.filter((p) => !isPhotoKey(p.file.storageKey) || !p.thumb || p.thumb.deletedAt || !isPhotoKey(p.thumb.storageKey))
}

/** Makes the preview + thumbnail of one photo from the best copy there is (its original if kept). */
async function generate(prisma: PrismaClient, storage: StorageService, p: Awaited<ReturnType<typeof photosMissingPreviews>>[number]) {
  const source: StoredFile = p.originalFile && !p.originalFile.deletedAt ? p.originalFile : p.file
  const stream = await storage.open(source.storageKey)
  if (!stream) throw new Error(`source missing in storage: ${source.storageKey}`)
  const copies = await renderUploadCopies(await readAll(stream))
  const keys = { preview: previewKey(p.eventId, p.id, 'webp'), thumb: thumbKey(p.eventId, p.id, 'webp') }
  await storage.saveAt(keys.preview, copies.preview, 'image/webp')
  await storage.saveAt(keys.thumb, copies.thumb, 'image/webp')
  const name = (p.originalName ?? p.file.originalName).slice(0, 200)
  await prisma.$transaction(async (tx) => {
    const preview = await tx.storedFile.create({ data: { studioId: p.studioId, kind: 'PHOTO', storageKey: keys.preview, originalName: name, mimeType: 'image/webp', size: copies.preview.length, checksum: p.sha256 ?? p.file.checksum } })
    const thumb = await tx.storedFile.create({ data: { studioId: p.studioId, kind: 'PHOTO', storageKey: keys.thumb, originalName: name, mimeType: 'image/webp', size: copies.thumb.length, checksum: `thumb:${p.sha256 ?? p.file.checksum}` } })
    // The old file row stays (unlinked) until --delete removes its object; the server-made preview is remade under previews/.
    await tx.photo.update({
      where: { id: p.id },
      data: {
        fileId: preview.id,
        thumbFileId: thumb.id,
        previewFileId: null,
        compressed: true,
        format: 'webp',
        originalWidth: p.originalWidth ?? copies.width,
        originalHeight: p.originalHeight ?? copies.height,
        originalSize: p.originalSize ?? (p.compressed ? null : p.file.size),
        // Kept so Copy from my computer can still match the original by its fingerprint.
        sha256: p.sha256 ?? (p.originalFile && !p.originalFile.deletedAt ? p.originalFile.checksum : p.compressed ? null : p.file.checksum),
      },
    })
  })
}

export interface CleanupOptions {
  mode: 'dry-run' | 'generate' | 'delete'
  confirm?: boolean
  includeUnknown?: boolean
  log?: (line: string) => void
}

/** One run of the cleanup. Returns the report (written to a file by the CLI). */
export async function cleanup(prisma: PrismaClient, storage: StorageService, o: CleanupOptions) {
  const out: Record<string, unknown> = { mode: o.mode, at: new Date().toISOString() }
  if (o.mode === 'generate') {
    const missing = await photosMissingPreviews(prisma)
    let made = 0
    const failed: { photoId: string; error: string }[] = []
    for (const p of missing) {
      try {
        await generate(prisma, storage, p)
        made++
      } catch (e) {
        failed.push({ photoId: p.id, error: (e as Error).message })
      }
      if ((made + failed.length) % 50 === 0) o.log?.(`  ${made + failed.length} / ${missing.length}`)
    }
    Object.assign(out, { photosMissingPreviews: missing.length, generated: made, failed })
  }

  const rows = await classify(prisma, storage)
  const stillMissing = await photosMissingPreviews(prisma)
  Object.assign(out, { summary: summary(rows), photosStillMissingPreviews: stillMissing.length })

  if (o.mode === 'delete') {
    if (!o.confirm) throw new Error('Refusing to delete without --confirm (run the dry run and get the owner’s OK first).')
    if (stillMissing.length) throw new Error(`${stillMissing.length} photos still have no preview/thumbnail. Run --generate first; nothing was deleted.`)
    const doomed = rows.filter((r) => r.category === 'photo-original' || r.category === 'photo-copy' || (r.category === 'unknown' && o.includeUnknown))
    let freed = 0
    let deleted = 0
    for (const r of doomed) {
      await storage.remove(r.key)
      if (r.fileId) {
        await prisma.storedFile.update({ where: { id: r.fileId }, data: { deletedAt: new Date() } })
        await prisma.photo.updateMany({ where: { originalFileId: r.fileId }, data: { originalFileId: null } })
        await prisma.photo.updateMany({ where: { previewFileId: r.fileId }, data: { previewFileId: null } })
      }
      freed += r.size
      deleted++
    }
    Object.assign(out, { deleted, gbFreed: gb(freed), bytesFreed: freed })
  }
  out.objects = rows
  return out
}

async function main() {
  const args = process.argv.slice(2)
  const mode = args.includes('--delete') ? 'delete' : args.includes('--generate') ? 'generate' : 'dry-run'
  const prisma = new PrismaClient()
  try {
    const out = await cleanup(prisma, createStorage(), { mode, confirm: args.includes('--confirm'), includeUnknown: args.includes('--include-unknown'), log: console.log })
    out.bucket = process.env.S3_BUCKET ?? '(local UPLOAD_DIR)'
    const file = `r2-report-${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    writeFileSync(file, JSON.stringify(out, null, 2))
    console.log(JSON.stringify({ ...out, objects: `${(out.objects as unknown[]).length} listed in ${file}` }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error((e as Error).message)
    process.exit(1)
  })
}
