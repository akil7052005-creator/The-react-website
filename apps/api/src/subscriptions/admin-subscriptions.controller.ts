import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import {
  adminCancelSchema,
  adminChangePlanSchema,
  adminNotificationQuerySchema,
  adminSubscriptionQuerySchema,
  alertSettingsSchema,
  extendSubscriptionSchema,
  remindSchema,
  totpCodeSchema,
  type AdminSubscriptionQuery,
  type TwoFactorSetupDto,
  type TwoFactorStatusDto,
} from '@weddyzone/shared'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { AuthUser, CurrentUser, Roles } from '../auth/auth.decorators'
import { decryptSecret, encryptSecret, generateTotpSecret, otpauthUrl, verifyTotp } from '../auth/totp'
import { badRequest, conflict, notFound } from '../common/errors'
import { ApiZodBody, zod } from '../common/zod'
import { config } from '../config'
import { AuditService } from '../core/audit.service'
import { SettingsService } from '../core/settings.service'
import { PrismaService } from '../prisma/prisma.service'
import { AdminSubscriptionsService } from './admin-subscriptions.service'
import { AlertsService, WHATSAPP_SKIPPED } from './alerts.service'
import { istDay } from './format'
import { platformInvoiceDto } from './invoice'
import { SubscriptionJobsService } from './jobs.service'
import { SubscriptionLifecycleService } from './lifecycle.service'

const AdminThrottle = () => Throttle({ default: { limit: config().RATE_LIMIT_ADMIN_PER_MIN, ttl: 60_000 } })

/**
 * Platform admin: subscriptions, alerts and alert settings. SUPER_ADMIN only (403 for anyone
 * else), rate-limited, and every change is written to the admin audit log and the
 * subscription's own event timeline.
 */
@ApiTags('admin')
@Roles('SUPER_ADMIN')
@AdminThrottle()
@Controller('admin')
export class AdminSubscriptionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminSubscriptionsService,
    private readonly lifecycle: SubscriptionLifecycleService,
    private readonly jobs: SubscriptionJobsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly alerts: AlertsService,
  ) {}

  @Get('stats')
  stats() {
    return this.admin.stats()
  }

  @Get('subscriptions')
  list(@Query(zod(adminSubscriptionQuerySchema)) q: AdminSubscriptionQuery) {
    return this.admin.list(q)
  }

  @Get('subscriptions/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(@CurrentUser() user: AuthUser, @Req() req: Request, @Query(zod(adminSubscriptionQuerySchema)) q: AdminSubscriptionQuery, @Res({ passthrough: true }) res: Response) {
    const csv = await this.admin.csv(q)
    res.setHeader('Content-Disposition', `attachment; filename="subscriptions-${new Date().toISOString().slice(0, 10)}.csv"`)
    await this.audit.record(user.userId, req, { action: 'subscription.export', summary: `Exported subscriptions CSV (tab ${q.tab}${q.search ? `, search "${q.search}"` : ''})` })
    return csv
  }

  @Get('subscriptions/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.detail(id)
  }

  /** Printable GST invoice for any studio's paid plan payment. */
  @Get('payments/:id/invoice')
  async invoice(@Param('id', ParseUUIDPipe) id: string) {
    const p = await this.prisma.payment.findFirst({ where: { id, purpose: 'SUBSCRIPTION', status: 'SUCCESS' }, include: { studio: true } })
    if (!p?.invoiceNumber) throw notFound('Invoice')
    return platformInvoiceDto(p)
  }

  @Post('subscriptions/:id/extend')
  @HttpCode(200)
  @ApiZodBody(extendSubscriptionSchema)
  async extend(@CurrentUser() user: AuthUser, @Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body(zod(extendSubscriptionSchema)) body: z.output<typeof extendSubscriptionSchema>) {
    const { sub, end } = await this.lifecycle.extend(id, body.days, body.note, user.userId)
    await this.audit.record(user.userId, req, {
      action: 'subscription.extend',
      target: { type: 'subscription', id },
      summary: `Extended ${sub.plan.name} by ${body.days} day(s) to ${istDay(end)}: ${body.note}`,
    })
    return this.admin.detail(id)
  }

  @Post('subscriptions/:id/change-plan')
  @HttpCode(200)
  @ApiZodBody(adminChangePlanSchema)
  async changePlan(@CurrentUser() user: AuthUser, @Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body(zod(adminChangePlanSchema)) body: z.output<typeof adminChangePlanSchema>) {
    const { sub, plan } = await this.lifecycle.adminChangePlan(id, body.planId, body.billingCycle, body.note, user.userId)
    await this.audit.record(user.userId, req, {
      action: 'subscription.change_plan',
      target: { type: 'subscription', id },
      summary: `Changed plan ${sub.plan.name} (${sub.cycle}) → ${plan.name} (${body.billingCycle}): ${body.note}`,
    })
    return this.admin.detail(id)
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(200)
  @ApiZodBody(adminCancelSchema)
  async cancel(@CurrentUser() user: AuthUser, @Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body(zod(adminCancelSchema)) body: z.output<typeof adminCancelSchema>) {
    const sub = await this.lifecycle.adminCancel(id, body.note, user.userId)
    await this.audit.record(user.userId, req, { action: 'subscription.cancel', target: { type: 'subscription', id }, summary: `Cancelled ${sub.plan.name}: ${body.note}` })
    return this.admin.detail(id)
  }

  @Post('subscriptions/:id/remind')
  @HttpCode(200)
  @ApiZodBody(remindSchema)
  async remind(@CurrentUser() user: AuthUser, @Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body(zod(remindSchema)) body: z.output<typeof remindSchema>) {
    const sent = await this.lifecycle.remindNow(id, body.channels)
    const rows = await this.prisma.notification.findMany({ where: { id: { in: sent.map((s) => s.row.id) } } })
    const results = body.channels.map((channel) => {
      const r = rows.find((x) => x.channel === channel)
      // WhatsApp without a provider is skipped, not failed.
      return r ? { channel, delivered: !!r.sentAt, skipped: false, error: r.error } : { channel, delivered: false, skipped: true, error: WHATSAPP_SKIPPED }
    })
    const summary = results.map((r) => `${r.channel}${r.skipped ? ' (skipped)' : r.delivered ? '' : ' (failed)'}`).join(', ')
    await this.audit.record(user.userId, req, { action: 'subscription.remind', target: { type: 'subscription', id }, summary: `Sent a plan reminder: ${summary}` })
    return { results }
  }

  // ---------------------------------------------------------------- alerts feed + bell

  @Get('notifications')
  notifications(@Query(zod(adminNotificationQuerySchema)) q: z.output<typeof adminNotificationQuerySchema>) {
    return this.admin.notifications(q.page, q.limit, q.unread)
  }

  @Patch('notifications/:id/read')
  async read(@Param('id', ParseUUIDPipe) id: string) {
    await this.admin.markRead(id)
    return { ok: true }
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  async readAll() {
    await this.admin.markAllRead()
    return { ok: true }
  }

  // ---------------------------------------------------------------- settings

  @Get('settings/alerts')
  async alertSettings() {
    return { ...(await this.settings.alerts()), whatsappConfigured: this.alerts.whatsappConfigured() }
  }

  @Put('settings/alerts')
  @ApiZodBody(alertSettingsSchema)
  async updateAlertSettings(@CurrentUser() user: AuthUser, @Req() req: Request, @Body(zod(alertSettingsSchema)) body: z.output<typeof alertSettingsSchema>) {
    const before = await this.settings.alerts()
    const saved = await this.settings.updateAlerts(body, user.userId)
    const after = { ...saved, whatsappConfigured: this.alerts.whatsappConfigured() }
    const changes = (['reminderDays', 'graceDays', 'digestTime', 'winbackAfterDays', 'winbackPercentOff'] as const)
      .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
      .map((k) => `${k} ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`)
    await this.audit.record(user.userId, req, { action: 'settings.alerts', summary: `Alert settings: ${changes.join('; ') || 'saved with no changes'}` })
    return after
  }

  /** Runs the hourly job now (also useful after changing settings). */
  @Post('jobs/subscription-alerts/run')
  @HttpCode(200)
  async runJob(@CurrentUser() user: AuthUser, @Req() req: Request) {
    const report = await this.jobs.run()
    await this.audit.record(user.userId, req, { action: 'job.run', summary: `Ran the subscription job: ${report.alerts} alerts, ${report.statusChanges} status changes` })
    return report
  }

  // ---------------------------------------------------------------- two-factor sign-in

  @Get('2fa')
  async twoFactor(@CurrentUser() user: AuthUser): Promise<TwoFactorStatusDto> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId } })
    return { enabled: !!u.totpEnabledAt }
  }

  /** New secret for the authenticator app; not active until confirmed with a code. */
  @Post('2fa/setup')
  @HttpCode(200)
  async setup2fa(@CurrentUser() user: AuthUser): Promise<TwoFactorSetupDto> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId } })
    if (u.totpEnabledAt) throw conflict('Two-factor sign-in is already on. Turn it off first to set up a new device.')
    const secret = generateTotpSecret()
    await this.prisma.user.update({ where: { id: u.id }, data: { totpSecret: encryptSecret(secret) } })
    return { secret, otpauthUrl: otpauthUrl(secret, u.email) }
  }

  @Post('2fa/enable')
  @HttpCode(200)
  @ApiZodBody(totpCodeSchema)
  async enable2fa(@CurrentUser() user: AuthUser, @Req() req: Request, @Body(zod(totpCodeSchema)) body: z.output<typeof totpCodeSchema>): Promise<TwoFactorStatusDto> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId } })
    if (u.totpEnabledAt) throw conflict('Two-factor sign-in is already on')
    if (!u.totpSecret) throw badRequest('Start the setup first')
    if (!verifyTotp(decryptSecret(u.totpSecret), body.code)) throw badRequest('That code is not right', { code: 'That code is not right or has expired' })
    await this.prisma.user.update({ where: { id: u.id }, data: { totpEnabledAt: new Date() } })
    await this.audit.record(user.userId, req, { action: 'auth.2fa_on', summary: 'Turned on two-factor sign-in' })
    return { enabled: true }
  }

  @Post('2fa/disable')
  @HttpCode(200)
  @ApiZodBody(totpCodeSchema)
  async disable2fa(@CurrentUser() user: AuthUser, @Req() req: Request, @Body(zod(totpCodeSchema)) body: z.output<typeof totpCodeSchema>): Promise<TwoFactorStatusDto> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId } })
    if (!u.totpEnabledAt || !u.totpSecret) throw conflict('Two-factor sign-in is not on')
    if (!verifyTotp(decryptSecret(u.totpSecret), body.code)) throw badRequest('That code is not right', { code: 'That code is not right or has expired' })
    await this.prisma.user.update({ where: { id: u.id }, data: { totpEnabledAt: null, totpSecret: null } })
    await this.audit.record(user.userId, req, { action: 'auth.2fa_off', summary: 'Turned off two-factor sign-in' })
    return { enabled: false }
  }
}
