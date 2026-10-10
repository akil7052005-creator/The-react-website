import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { NO_EXPIRY_DATE } from '@weddyzone/shared'
import { toDate } from '../common/util'
import { config } from '../config'
import { StorageService } from '../infra/storage.service'
import { PrismaService } from '../prisma/prisma.service'

const HOUR = 3_600_000
const DAY = 86_400_000
/** Previews and thumbnails stay this long after a gallery expires, so the studio can still reopen it. */
export const EXPIRED_GALLERY_GRACE_DAYS = 15
/**
 * Galleries that had already expired when this cleanup shipped get the full grace from this day,
 * so nothing is deleted the moment it goes live.
 */
export const PREVIEW_CLEANUP_START = '2026-10-10'
/** Previews of a studio whose plan ended are kept this long, in case it renews. */
export const ENDED_PLAN_GRACE_DAYS = 30
/** Selections handled per run (the next run picks up the rest). */
const BATCH = 20

export interface PreviewCleanupReport {
  selections: number
  files: number
  bytes: number
}

/**
 * Deletes the previews and thumbnails of expired galleries 15 days after they expired: the photos'
 * rows, picks and activity stay (the studio still sees what was picked); only the online copies go.
 * A gallery the studio reopens (a new expiry date) before then keeps everything. Also: 30 days after
 * a studio's plan ends (unless renewed), the previews of all its galleries.
 */
@Injectable()
export class PreviewCleanupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('PreviewCleanup')
  private timers: NodeJS.Timeout[] = []
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  onApplicationBootstrap() {
    if (!config().JOBS_ENABLED) return
    const first = setTimeout(() => void this.tick(), 5 * 60_000)
    const every = setInterval(() => void this.tick(), HOUR)
    first.unref?.()
    every.unref?.()
    this.timers = [first, every]
  }

  onModuleDestroy() {
    for (const t of this.timers) clearTimeout(t)
  }

  private async tick() {
    if (this.running) return
    this.running = true
    try {
      const r = await this.run()
      if (r.files) this.logger.log(`Deleted ${r.files} previews (${(r.bytes / 1024 ** 2).toFixed(1)} MB) of ${r.selections} expired galleries`)
    } catch (e) {
      this.logger.error(`Preview cleanup failed: ${(e as Error).message}`)
    } finally {
      this.running = false
    }
  }

  /** The last expiry date whose galleries are past their grace at `now`. */
  static cutoff(now = new Date()) {
    const cut = new Date(now.getTime() - EXPIRED_GALLERY_GRACE_DAYS * DAY)
    // Before the start date + grace nothing qualifies (returns a date before any gallery).
    return cut < new Date(toDate(PREVIEW_CLEANUP_START).getTime() + EXPIRED_GALLERY_GRACE_DAYS * DAY) ? null : cut
  }

  /** The latest plan end whose studios are past the 30 days at `now` (never before the start date + 30 days). */
  static planCutoff(now = new Date()) {
    const cut = new Date(now.getTime() - ENDED_PLAN_GRACE_DAYS * DAY)
    return cut < new Date(toDate(PREVIEW_CLEANUP_START).getTime() + ENDED_PLAN_GRACE_DAYS * DAY) ? null : cut
  }

  async run(now = new Date()): Promise<PreviewCleanupReport> {
    const report: PreviewCleanupReport = { selections: 0, files: 0, bytes: 0 }
    const cutoff = PreviewCleanupService.cutoff(now)
    const planCutoff = PreviewCleanupService.planCutoff(now)
    if (!cutoff && !planCutoff) return report
    const hasPreviews = { some: { deletedAt: null, file: { deletedAt: null, mimeType: { startsWith: 'image/' } } } }
    // Plans that ended (not renewed, not on a trial still running) more than 30 days ago.
    const ended = planCutoff
      ? await this.prisma.subscription.findMany({ where: { currentPeriodEnd: { lt: planCutoff }, status: { in: ['EXPIRED', 'CANCELLED', 'GRACE'] } }, select: { studioId: true } })
      : []
    const due = await this.prisma.selection.findMany({
      where: {
        deletedAt: null,
        photos: hasPreviews,
        OR: [
          ...(cutoff ? [{ deadline: { lt: cutoff, not: toDate(NO_EXPIRY_DATE) } }] : []),
          ...(ended.length ? [{ studioId: { in: ended.map((e) => e.studioId) } }] : []),
        ],
      },
      select: { id: true },
      take: BATCH,
    })
    for (const s of due) {
      const photos = await this.prisma.photo.findMany({
        where: { selectionId: s.id, deletedAt: null, file: { mimeType: { startsWith: 'image/' } } },
        select: { file: true, thumb: true, preview: true },
      })
      const files = photos.flatMap((p) => [p.file, p.thumb, p.preview]).filter((f): f is NonNullable<typeof f> => !!f && !f.deletedAt)
      for (const f of files) {
        await this.storage.remove(f.storageKey)
        report.bytes += f.size
      }
      await this.prisma.storedFile.updateMany({ where: { id: { in: files.map((f) => f.id) } }, data: { deletedAt: now } })
      report.files += files.length
      report.selections++
    }
    return report
  }
}
