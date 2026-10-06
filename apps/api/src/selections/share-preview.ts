import { Controller, Get, Injectable, Param, Req, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { todayIST } from '@weddyzone/shared'
import type { Request, Response } from 'express'
import sharp from 'sharp'
import { Public } from '../auth/auth.decorators'
import { PublicThrottle } from '../common/throttle'
import { toDate } from '../common/util'
import { config } from '../config'
import { notFound } from '../common/errors'
import { StorageService } from '../infra/storage.service'
import { PrismaService } from '../prisma/prisma.service'
import { readAll } from './previews.service'

// WhatsApp (and other link previews) for a share link, /select/<token>. Their crawlers don't run the
// web app, so the web host sends them here instead (a Vite middleware in development, a user-agent
// rewrite in vercel.json in production): a tiny page with the event's og:title, og:description and
// og:image. People opening the link still get the web app.

/** og:image size WhatsApp shows as a large card. */
const OG_W = 1200
const OG_H = 630
/** WhatsApp drops images much over 300 KB. */
const OG_MAX_BYTES = 300 * 1024
/** Shown when the studio has no gallery banner (apps/web/public/og/share-card.jpg). */
const DEFAULT_CARD = '/og/share-card.jpg'

const escapeHtml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' })[c]!)
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim() || null

/**
 * The site's https address for absolute og: URLs: APP_URL when it is https (production), otherwise
 * the https host the request came through (a Cloudflare tunnel in development), else APP_URL.
 */
export function publicOrigin(req: Pick<Request, 'headers'>): string {
  const app = config().APP_URL.replace(/\/+$/, '')
  if (app.startsWith('https://')) return app
  const host = first(req.headers['x-forwarded-host']) ?? first(req.headers.host)
  const proto = first(req.headers['x-forwarded-proto'])
  if (host && proto === 'https' && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) return `https://${host}`
  return app
}

export interface SharePreview {
  title: string
  description: string
  /** Path of the image on this site (made absolute with publicOrigin). */
  imagePath: string
}

/** Fits a banner to 1200×630 as a JPEG under 300 KB. */
export async function ogJpeg(input: Buffer): Promise<Buffer> {
  const base = sharp(input, { failOn: 'none', limitInputPixels: 300_000_000 }).rotate().resize(OG_W, OG_H, { fit: 'cover', position: 'attention' }).flatten({ background: '#ffffff' })
  let out = Buffer.alloc(0)
  for (const quality of [82, 74, 66, 58, 50]) {
    out = await base.clone().jpeg({ quality, progressive: true, mozjpeg: true }).toBuffer()
    if (out.length < OG_MAX_BYTES) break
  }
  return out
}

@Injectable()
export class SharePreviewService {
  /** Rendered banners by file id (a banner rarely changes; a few dozen studios share a server). */
  private readonly images = new Map<string, Buffer>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private selection(token: string) {
    return this.prisma.selection.findFirst({
      where: { publicToken: token, deletedAt: null },
      select: { studioId: true, studio: { select: { name: true } }, event: { select: { title: true, client: { select: { name: true } } } } },
    })
  }

  /** The studio's current gallery banner (the first one the customer gallery shows). */
  private async bannerFileId(studioId: string) {
    const today = toDate(todayIST())
    const b = await this.prisma.banner.findFirst({
      where: {
        studioId,
        deletedAt: null,
        active: true,
        placement: 'GALLERY_HERO',
        AND: [{ OR: [{ startDate: null }, { startDate: { lte: today } }] }, { OR: [{ endDate: null }, { endDate: { gte: today } }] }],
      },
      orderBy: { position: 'asc' },
      select: { imageFileId: true },
    })
    return b?.imageFileId ?? null
  }

  async preview(token: string): Promise<SharePreview> {
    const s = await this.selection(token)
    if (!s) return { title: 'Your photo gallery', description: 'Tap to open your gallery and pick your favourites.', imagePath: DEFAULT_CARD }
    const banner = await this.bannerFileId(s.studioId)
    return {
      title: `${s.studio.name} · ${s.event.title} photos`,
      description: `Hi ${s.event.client.name}! Tap to open your gallery and pick your favourites.`,
      imagePath: banner ? `/api/v1/public/og/select/${encodeURIComponent(token)}/image.jpg?v=${banner.slice(0, 8)}` : DEFAULT_CARD,
    }
  }

  /** The studio banner as the 1200×630 share image, or null without one. */
  async image(token: string): Promise<Buffer | null> {
    const s = await this.selection(token)
    const fileId = s && (await this.bannerFileId(s.studioId))
    if (!fileId) return null
    const cached = this.images.get(fileId)
    if (cached) return cached
    const file = await this.prisma.storedFile.findUnique({ where: { id: fileId } })
    const stream = file && !file.deletedAt ? await this.storage.open(file.storageKey) : null
    if (!stream) return null
    const out = await ogJpeg(await readAll(stream))
    if (this.images.size >= 50) this.images.delete(this.images.keys().next().value!)
    this.images.set(fileId, out)
    return out
  }
}

/** The page a link-preview crawler gets for /select/<token>. */
export function sharePreviewHtml(p: SharePreview, origin: string, path: string) {
  const url = `${origin}${path}`
  const image = `${origin}${p.imagePath}`
  const t = escapeHtml(p.title)
  const d = escapeHtml(p.description)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${t}</title>
<meta name="description" content="${d}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Weddyzone Studio" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:url" content="${escapeHtml(url)}" />
<meta property="og:image" content="${escapeHtml(image)}" />
<meta property="og:image:secure_url" content="${escapeHtml(image)}" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:width" content="${OG_W}" />
<meta property="og:image:height" content="${OG_H}" />
<meta name="twitter:card" content="summary_large_image" />
</head>
<body><p><a href="${escapeHtml(url)}">${t}</a></p></body>
</html>
`
}

@ApiTags('public')
@Public()
@PublicThrottle()
@Controller('public/og/select')
export class SharePreviewController {
  constructor(private readonly previews: SharePreviewService) {}

  /** Link preview page for /select/:token (og:title, og:description, og:image). */
  @Get(':token')
  async page(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const html = sharePreviewHtml(await this.previews.preview(token), publicOrigin(req), `/select/${encodeURIComponent(token)}`)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.send(html)
  }

  /** The studio banner as a 1200×630 JPEG under 300 KB. */
  @Get(':token/image.jpg')
  async image(@Param('token') token: string, @Res() res: Response) {
    const jpeg = await this.previews.image(token)
    if (!jpeg) throw notFound('Image')
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.send(jpeg)
  }
}
