import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { adminPlanOrderSchema, adminPlanVerifySchema, adminStudioQuerySchema, removeStudioSchema, type AdminStudioQuery } from '@weddyzone/shared'
import type { Request } from 'express'
import { z } from 'zod'
import { AuthUser, CurrentUser, Roles } from '../auth/auth.decorators'
import { ApiZodBody, zod } from '../common/zod'
import { config } from '../config'
import { AuditService } from '../core/audit.service'
import { AdminPlanPaymentsService } from './admin-plan-payments.service'
import { AdminStudiosService } from './admin-studios.service'

/**
 * Admin → Studios: every registered studio, with remove / restore and Change plan (the admin pays).
 * SUPER_ADMIN only (403 for anyone else); every change is audited.
 */
@ApiTags('admin')
@Roles('SUPER_ADMIN')
@Throttle({ default: { limit: config().RATE_LIMIT_ADMIN_PER_MIN, ttl: 60_000 } })
@Controller('admin/studios')
export class AdminStudiosController {
  constructor(
    private readonly studios: AdminStudiosService,
    private readonly planPayments: AdminPlanPaymentsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query(zod(adminStudioQuerySchema)) q: AdminStudioQuery) {
    return this.studios.list(q)
  }

  @Post(':id/remove')
  @HttpCode(200)
  @ApiZodBody(removeStudioSchema)
  async remove(@CurrentUser() user: AuthUser, @Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body(zod(removeStudioSchema)) body: z.output<typeof removeStudioSchema>) {
    const s = await this.studios.remove(id, user, body.confirmName)
    await this.audit.record(user.userId, req, { action: 'studio.remove', target: { type: 'studio', id }, summary: `Removed studio "${s.name}" (restorable for 30 days)` })
    return { ok: true }
  }

  @Post(':id/restore')
  @HttpCode(200)
  async restore(@CurrentUser() user: AuthUser, @Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const s = await this.studios.restore(id)
    await this.audit.record(user.userId, req, { action: 'studio.restore', target: { type: 'studio', id }, summary: `Restored studio "${s.name}"` })
    return { ok: true }
  }

  /** Change plan: what the admin will pay (GST included, credit for the studio's unused days taken off). */
  @Get(':id/plan-quote')
  planQuote(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query(zod(adminPlanOrderSchema)) q: z.output<typeof adminPlanOrderSchema>) {
    return this.planPayments.quote(id, user.userId, q.planId, q.cycle)
  }

  /**
   * Change plan: opens a Razorpay order for the admin to pay, priced on the server. The plan changes
   * only once the payment is confirmed (plan-verify or Razorpay's webhook).
   */
  @Post(':id/plan-order')
  @HttpCode(200)
  @ApiZodBody(adminPlanOrderSchema)
  planOrder(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zod(adminPlanOrderSchema)) body: z.output<typeof adminPlanOrderSchema>) {
    return this.planPayments.order(id, user.userId, body.planId, body.cycle)
  }

  /** Change plan: Razorpay Checkout finished; the server checks it with Razorpay and applies the plan (once). */
  @Post(':id/plan-verify')
  @HttpCode(200)
  @ApiZodBody(adminPlanVerifySchema)
  planVerify(@Param('id', ParseUUIDPipe) id: string, @Body(zod(adminPlanVerifySchema)) body: z.output<typeof adminPlanVerifySchema>) {
    const { paymentId, ...checkout } = body
    return this.planPayments.verify(id, paymentId, checkout)
  }
}
