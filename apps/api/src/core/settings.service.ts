import { Injectable } from '@nestjs/common'
import { alertSettingsSchema, DEFAULT_ALERT_SETTINGS, type AdminAlertSettingsDto, type AlertSettings } from '@weddyzone/shared'
import { PrismaService } from '../prisma/prisma.service'

const ALERTS_KEY = 'alerts'
const CACHE_MS = 30_000

/** Platform settings edited at /admin/settings. Read on every access check, so cached briefly. */
@Injectable()
export class SettingsService {
  private cache: { value: AdminAlertSettingsDto; at: number } | null = null

  constructor(private readonly prisma: PrismaService) {}

  async alerts(): Promise<AdminAlertSettingsDto> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value
    const row = await this.prisma.platformSetting.findUnique({ where: { key: ALERTS_KEY } })
    // Stored values are validated again so a hand-edited row can't break the job.
    const parsed = alertSettingsSchema.safeParse({ ...DEFAULT_ALERT_SETTINGS, ...((row?.value as object | null) ?? {}) })
    const value = { ...(parsed.success ? parsed.data : DEFAULT_ALERT_SETTINGS), updatedAt: row?.updatedAt.toISOString() ?? null }
    this.cache = { value, at: Date.now() }
    return value
  }

  async updateAlerts(input: AlertSettings, actorId: string): Promise<AdminAlertSettingsDto> {
    const value = { ...input } as object
    await this.prisma.platformSetting.upsert({
      where: { key: ALERTS_KEY },
      create: { key: ALERTS_KEY, value, updatedById: actorId },
      update: { value, updatedById: actorId },
    })
    this.cache = null
    return this.alerts()
  }

  clearCache() {
    this.cache = null
  }
}
