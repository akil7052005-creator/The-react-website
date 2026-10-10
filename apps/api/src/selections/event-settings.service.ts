import { HttpStatus, Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import {
  ERROR_CODES,
  NO_EXPIRY_DATE,
  resolveStoredSettings,
  todayIST,
  type EventSettings,
  type EventSettingsPatch,
  type StoredEventSettings,
} from '@weddyzone/shared'
import { quotaOf } from '@weddyzone/shared'
import sharp from 'sharp'
import { AppError, badRequest, fileInvalid } from '../common/errors'
import { sha256, toDate, toIso } from '../common/util'
import { fileUrls, type UploadedFile } from '../core/files.service'
import { sniff } from '../infra/file-sniff'
import { StorageService } from '../infra/storage.service'
import { PrismaService } from '../prisma/prisma.service'
import { PhotoPreviewService } from './previews.service'
import { writeLog } from './selection-log'
import { SelectionsService } from './selections.service'

const MB = 1024 * 1024
export const LOGO_MAX_BYTES = 2 * MB
const DAY = 86_400_000

const isSvg = (buf: Buffer) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(buf.subarray(0, 2048).toString('utf8'))

/**
 * Per-event Photo Selection settings (the settings page). Some live in their own columns (downloads,
 * notes, watermark on/off, gallery expiry), the rest in the selection's settings JSON.
 */
@Injectable()
export class EventSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly selections: SelectionsService,
    private readonly previews: PhotoPreviewService,
    private readonly storage: StorageService,
  ) {}

  /** What the studio's plan includes: video downloads and favourites on VIP; Trial galleries stay open 7 days at most. */
  private async addons(studioId: string): Promise<EventSettings['addons']> {
    const sub = await this.prisma.subscription.findUnique({ where: { studioId }, include: { plan: true } })
    const quota = quotaOf(sub?.plan.limits)
    return { videoDownload: sub?.plan.code === 'ALL_ACCESS', favourites: quota.favourites, galleryDaysMax: quota.galleryDays }
  }

  private dto(s: { deadline: Date; quota: number; allowDownload: boolean; notesAllowed: boolean; watermark: boolean; settings: unknown }, addons: EventSettings['addons']): EventSettings {
    const st = resolveStoredSettings(s.settings)
    const expires = toIso(s.deadline)
    const none = expires === NO_EXPIRY_DATE
    return {
      allowClientView: st.allowClientView,
      downloadOn: s.allowDownload,
      downloadAllFolder: s.allowDownload && st.downloadAllFolder,
      instagramFollow: st.instagramFollow,
      // Favourites are a VIP feature: off (and locked in Settings) on other plans.
      favoriteOption: st.favoriteOption && addons.favourites,
      photoNotes: s.notesAllowed,
      galleryExpiry: none ? null : st.galleryExpiryDays !== undefined && st.galleryExpiryDays !== null ? st.galleryExpiryDays : 'custom',
      galleryExpiresOn: none ? null : expires,
      videoDownload: addons.videoDownload && st.videoDownload,
      allowSelection: st.allowSelection,
      highQuality: st.highQuality,
      limitOn: st.limitOn,
      selectionLimit: s.quota,
      videoSelection: st.videoSelection,
      watermark: { ...st.watermark, logoUrl: st.watermark.logoFileId ? fileUrls.studio(st.watermark.logoFileId) : null, enabled: s.watermark },
      addons,
    }
  }

  async get(studioId: string, id: string): Promise<EventSettings> {
    const s = await this.selections.find(studioId, id)
    return this.dto(s, await this.addons(studioId))
  }

  async patch(studioId: string, id: string, body: EventSettingsPatch): Promise<EventSettings> {
    const s = await this.selections.find(studioId, id)
    const addons = await this.addons(studioId)
    const st = resolveStoredSettings(s.settings)
    const next: StoredEventSettings = { ...st, watermark: { ...st.watermark } }
    const data: Prisma.SelectionUpdateInput = {}
    const changes: string[] = []
    const say = (label: string, on: boolean) => changes.push(`${label} ${on ? 'on' : 'off'}`)

    const labels = {
      allowClientView: 'client view',
      instagramFollow: 'Instagram follow',
      favoriteOption: 'favourites',
      allowSelection: 'client selection',
      highQuality: 'high-quality photos',
      limitOn: 'selection limit',
      videoSelection: 'video selection',
    } as const
    if (body.favoriteOption && !addons.favourites) {
      throw new AppError(HttpStatus.PAYMENT_REQUIRED, ERROR_CODES.PLAN_LIMIT, 'Customer favourites come with the VIP plan.', undefined, { resource: 'favourites', upgrade: '/subscriptions' })
    }
    for (const k of Object.keys(labels) as (keyof typeof labels)[]) {
      if (body[k] !== undefined && body[k] !== st[k]) {
        next[k] = body[k]!
        say(labels[k], body[k]!)
      }
    }
    // Already a whole number (the route parses the body); the patch type is the form's input type.
    const limit = body.selectionLimit === undefined ? undefined : Number(body.selectionLimit)
    if (limit !== undefined && limit !== s.quota) {
      data.quota = limit
      changes.push(`selection limit ${limit}`)
    }
    for (const k of ['videoDownload'] as const) {
      if (body[k] === undefined) continue
      if (body[k] && !addons[k]) {
        throw new AppError(HttpStatus.PAYMENT_REQUIRED, ERROR_CODES.PLAN_LIMIT, 'Video Download needs the Video add-on bundle.', undefined, { upgrade: '/subscriptions' })
      }
      if (body[k] !== st[k]) {
        next[k] = body[k]!
        say('video download', body[k]!)
      }
    }
    const downloadOn = body.downloadOn ?? s.allowDownload
    if (body.downloadOn !== undefined && body.downloadOn !== s.allowDownload) {
      data.allowDownload = body.downloadOn
      say('downloads', body.downloadOn)
    }
    if (body.downloadAllFolder && !downloadOn) throw badRequest('Turn Download On first.', { downloadAllFolder: 'Needs Download On' })
    const folderDl = downloadOn ? (body.downloadAllFolder ?? st.downloadAllFolder) : false
    if (folderDl !== st.downloadAllFolder) {
      next.downloadAllFolder = folderDl
      say('folder downloads', folderDl)
    }
    if (body.photoNotes !== undefined && body.photoNotes !== s.notesAllowed) {
      data.notesAllowed = body.photoNotes
      say('photo notes', body.photoNotes)
    }
    const max = addons.galleryDaysMax
    if (max !== null && (body.galleryExpiry === null || (typeof body.galleryExpiry === 'number' && body.galleryExpiry > max))) {
      throw badRequest(`Customer galleries stay open up to ${max} days on your plan.`, { galleryExpiry: `At most ${max} days on your plan` })
    }
    if (max !== null && body.linkExpiresOn !== undefined && (body.linkExpiresOn === null || toDate(body.linkExpiresOn).getTime() > toDate(todayIST()).getTime() + max * DAY)) {
      throw badRequest(`Customer galleries stay open up to ${max} days on your plan.`, { linkExpiresOn: `At most ${max} days from today on your plan` })
    }
    if (body.galleryExpiry !== undefined) {
      const date = body.galleryExpiry === null ? NO_EXPIRY_DATE : toIso(new Date(toDate(todayIST()).getTime() + body.galleryExpiry * DAY))
      data.deadline = toDate(date)
      next.galleryExpiryDays = body.galleryExpiry
      changes.push(body.galleryExpiry === null ? 'gallery: no expiry' : `gallery expires in ${body.galleryExpiry} days`)
    } else if (body.linkExpiresOn !== undefined) {
      // A chosen last day (shown as "custom"), or none.
      if (body.linkExpiresOn !== null && body.linkExpiresOn < todayIST()) throw badRequest('Choose today or a later date.', { linkExpiresOn: 'Choose today or a later date' })
      const date = body.linkExpiresOn ?? NO_EXPIRY_DATE
      if (date !== toIso(s.deadline)) {
        data.deadline = toDate(date)
        next.galleryExpiryDays = body.linkExpiresOn === null ? null : undefined
        changes.push(body.linkExpiresOn === null ? 'link: no expiry' : `link expires after ${body.linkExpiresOn}`)
      }
    }

    let watermarkChanged = false
    const w = body.watermark
    if (w) {
      if (w.enabled !== undefined && w.enabled !== s.watermark) {
        data.watermark = w.enabled
        say('watermark', w.enabled)
        watermarkChanged = true
      }
      for (const k of ['position', 'sizePct', 'spacingPct', 'opacityPct'] as const) {
        if (w[k] !== undefined && w[k] !== st.watermark[k]) {
          ;(next.watermark as Record<string, unknown>)[k] = w[k]
          watermarkChanged = true
        }
      }
      if (w.removeLogo && st.watermark.logoFileId) {
        await this.prisma.storedFile.update({ where: { id: st.watermark.logoFileId }, data: { deletedAt: new Date() } })
        next.watermark.logoFileId = null
        watermarkChanged = true
        changes.push('logo removed')
      }
      if (watermarkChanged && !changes.some((c) => c.startsWith('watermark'))) changes.push('watermark layout changed')
    }

    data.settings = next as unknown as Prisma.InputJsonValue
    await this.prisma.selection.update({ where: { id }, data })
    if (watermarkChanged) await this.previews.clear(id)
    if (changes.length) await writeLog(this.prisma, id, 'STUDIO', 'Settings changed', changes.join(' · '))
    return this.get(studioId, id)
  }

  /** The watermark logo: PNG, JPEG, WebP or SVG up to 2 MB, stored as a PNG (SVGs are drawn first). */
  async uploadLogo(studioId: string, id: string, file: UploadedFile | undefined): Promise<EventSettings> {
    const s = await this.selections.find(studioId, id)
    if (!file?.buffer?.length) throw fileInvalid('Choose a logo to upload')
    if (file.size > LOGO_MAX_BYTES) throw fileInvalid('The logo must be 2 MB or smaller')
    const type = sniff(file.buffer)
    const svg = !type && isSvg(file.buffer)
    if (!svg && (!type || !['image/png', 'image/jpeg', 'image/webp'].includes(type.mime))) throw fileInvalid('Upload a PNG, JPG or SVG logo')
    let png: Buffer
    try {
      png = await sharp(file.buffer, svg ? { density: 300 } : {})
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: !svg })
        .png()
        .toBuffer()
    } catch {
      throw fileInvalid('That logo could not be read. Try a PNG.')
    }
    const st = resolveStoredSettings(s.settings)
    const storageKey = await this.storage.save(png, 'png', 'image/png')
    const stored = await this.prisma.storedFile.create({
      data: { studioId, kind: 'LOGO', storageKey, originalName: `watermark-${file.originalname}`.replace(/\.[^.]+$/, '.png').slice(0, 200), mimeType: 'image/png', size: png.length, checksum: sha256(png) },
    })
    if (st.watermark.logoFileId) await this.prisma.storedFile.update({ where: { id: st.watermark.logoFileId }, data: { deletedAt: new Date() } })
    const next = { ...st, watermark: { ...st.watermark, logoFileId: stored.id } }
    await this.prisma.selection.update({ where: { id }, data: { settings: next as unknown as Prisma.InputJsonValue } })
    await this.previews.clear(id)
    await writeLog(this.prisma, id, 'STUDIO', 'Settings changed', 'watermark logo uploaded')
    return this.get(studioId, id)
  }
}
