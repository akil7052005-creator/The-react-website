import { CallHandler, Controller, ExecutionContext, Get, HttpStatus, Injectable, NestInterceptor } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { ERROR_CODES, graceEnd, resolveUploadLimits, type PlanLimits, type UploadLimitsDto } from '@weddyzone/shared'
import type { Request, Response } from 'express'
import multer, { memoryStorage, MulterError } from 'multer'
import type { Observable } from 'rxjs'
import { StudioId, type AuthUser } from '../auth/auth.decorators'
import { AppError, badRequest, forbidden, planLimit } from '../common/errors'
import { PlansService, stateOf } from '../core/plans.service'
import { SettingsService } from '../core/settings.service'
import { PrismaService, type Tx } from '../prisma/prisma.service'
import { renewPath } from '../subscriptions/format'

const MB = 1024 * 1024
const GB = 1024 ** 3

// ---------------------------------------------------------------- errors (photo uploads only)

export const fileTooLarge = (l: Pick<UploadLimitsDto, 'maxPhotoMb' | 'planName'>) => {
  const message = `Larger than ${l.maxPhotoMb} MB on your ${l.planName} plan`
  return new AppError(HttpStatus.PAYLOAD_TOO_LARGE, ERROR_CODES.FILE_TOO_LARGE, message, { file: message }, { resource: 'photoSize', limit: l.maxPhotoMb })
}

export const renewToUpload = (l: Pick<UploadLimitsDto, 'renewLink' | 'planCode'>) =>
  new AppError(HttpStatus.FORBIDDEN, ERROR_CODES.PLAN_LIMIT, 'Renew your plan to upload', { file: 'Renew your plan to upload' }, { resource: 'subscription', renewLink: l.renewLink, plan: l.planCode })

export const storageFull = (usedBytes: number, l: Pick<UploadLimitsDto, 'storageGb' | 'planCode'>) => {
  const used = Math.round((usedBytes / GB) * 10) / 10
  return planLimit(`Storage full: ${used} of ${l.storageGb} GB used. Upgrade for more space.`, { resource: 'storage', limit: l.storageGb, used, plan: l.planCode })
}

// ---------------------------------------------------------------- limits

/** A studio's photo upload limits, from its subscription plan and status. */
@Injectable()
export class UploadLimitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly settings: SettingsService,
  ) {}

  /** Same sum as My Subscription → Storage (all the studio's files that aren't deleted). */
  async storageUsed(studioId: string, db: Tx | PrismaService = this.prisma): Promise<number> {
    const r = await db.storedFile.aggregate({ where: { studioId, deletedAt: null }, _sum: { size: true } })
    return r._sum.size ?? 0
  }

  async forStudio(studioId: string): Promise<UploadLimitsDto> {
    const eff = await this.plans.effective(studioId)
    const limits = this.plans.limits(eff.plan) as PlanLimits
    const storageGb = limits.storageGb
    const used = await this.storageUsed(studioId)
    const grace = eff.status === 'GRACE' ? graceEnd(stateOf(eff.subscription), await this.settings.alerts()).toISOString() : null
    return {
      planCode: eff.plan.code,
      planName: eff.plan.name,
      ...resolveUploadLimits(limits),
      storageGb,
      storageUsedBytes: used,
      storageLeftBytes: storageGb === null ? null : Math.max(0, storageGb * GB - used),
      readOnly: eff.readOnly,
      status: eff.status,
      graceEndsAt: grace,
      renewLink: renewPath(eff.plan.code, eff.subscription.cycle),
    }
  }
}

@ApiTags('selections')
@Controller('me')
export class UploadLimitsController {
  constructor(private readonly limits: UploadLimitsService) {}

  /** The studio's photo upload limits (plan, size per photo, files per upload, storage left). */
  @Get('upload-limits')
  get(@StudioId() studioId: string): Promise<UploadLimitsDto> {
    return this.limits.forStudio(studioId)
  }
}

// ---------------------------------------------------------------- request handling

export type UploadRequest = Request & { user?: AuthUser; uploadLimits?: UploadLimitsDto }

/**
 * Reads a photo upload with the studio's own plan limits: refuses a read-only studio before
 * reading the body, and stops reading a file as soon as it passes the plan's per-photo size
 * (multer drains the rest, so the browser still gets the 413). The limits are passed on to the
 * service on `req.uploadLimits`.
 */
@Injectable()
export class PlanUploadInterceptor implements NestInterceptor {
  constructor(private readonly limits: UploadLimitsService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = ctx.switchToHttp().getRequest<UploadRequest>()
    const res = ctx.switchToHttp().getResponse<Response>()
    const studioId = req.user?.studioId
    if (!studioId) throw forbidden('This action needs a studio account')
    const limits = await this.limits.forStudio(studioId)
    if (limits.readOnly) throw renewToUpload(limits)

    const parse = multer({ storage: memoryStorage(), limits: { fileSize: limits.maxPhotoMb * MB, files: 1, fields: 5, fieldSize: 2048 } }).single('file')
    await new Promise<void>((resolve, reject) =>
      parse(req, res, (err: unknown) => {
        if (!err) return resolve()
        if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') return reject(fileTooLarge(limits))
        if (err instanceof MulterError) return reject(badRequest(`Upload rejected: ${err.message}`))
        reject(err)
      }),
    )
    req.uploadLimits = limits
    return next.handle()
  }
}

/**
 * The folder a photo came from, from the form field the uploader sends ("Haldi", "Wedding/Stage").
 * Normalised and bounded; anything odd (empty, "..", absurdly long) is stored as no folder.
 */
export function cleanFolder(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const parts = raw
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p && p !== '.')
  if (!parts.length || parts.some((p) => p === '..')) return null
  const folder = parts.join('/')
  return folder.length > 300 ? null : folder
}
