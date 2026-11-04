import type { INestApplication } from '@nestjs/common'
import type { Plan, PrismaClient } from '@prisma/client'
import { splitInclusiveGstPaise, type AdminPlanOrderDto, type AdminPlanQuoteDto } from '@weddyzone/shared'
import { createHmac } from 'crypto'
import request from 'supertest'
import { createAdmin } from '../prisma/create-admin'
import { RazorpayPaymentService } from '../src/core/razorpay-payment.service'
import { MailService, type MailMessage } from '../src/infra/mail.service'
import { signWebhook } from '../src/subscriptions/webhooks.controller'
import { fakeRazorpay, KEY_ID, KEY_SECRET } from './fake-razorpay'
import { createTestApp, resetDb, signup, type SignedUp } from './helpers'

type Agent = ReturnType<typeof request.agent>
const WEBHOOK_SECRET = 'test-webhook-secret'
const DAY = 86_400_000

/** Logs in a new platform admin; returns the agent and the admin's user id. */
async function adminAgent(app: INestApplication, prisma: PrismaClient, email: string, name: string) {
  const created = await createAdmin(prisma, { email, name })
  const agent = request.agent(app.getHttpServer())
  await agent.post('/api/v1/auth/login').send({ email: created.email, password: created.password }).expect(200)
  const user = await prisma.user.findUniqueOrThrow({ where: { email: created.email } })
  return { agent, id: user.id, email: created.email }
}

describe('Admin → Studios → Change plan: the admin pays (Razorpay test mode)', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let admin: Agent
  let adminId: string
  let adminEmail: string
  let F: SignedUp
  let pro: Plan
  let vip: Plan
  const mails: MailMessage[] = []
  const rzp = fakeRazorpay()

  const base = (studioId: string) => `/api/v1/admin/studios/${studioId}`
  const quote = async (studioId: string, plan: Plan, cycle: string) =>
    (await admin.get(`${base(studioId)}/plan-quote`).query({ planId: plan.id, cycle }).expect(200)).body as AdminPlanQuoteDto
  const order = async (studioId: string, plan: Plan, cycle: string) =>
    (await admin.post(`${base(studioId)}/plan-order`).send({ planId: plan.id, cycle }).expect(200)).body as AdminPlanOrderDto
  const verify = (studioId: string, paymentId: string, paid: ReturnType<typeof rzp.pay>) => admin.post(`${base(studioId)}/plan-verify`).send({ ...paid, paymentId })
  const sub = (studioId: string) => prisma.subscription.findUniqueOrThrow({ where: { studioId }, include: { plan: true } })
  const hook = (body: object, eventId: string) => {
    const raw = JSON.stringify(body)
    return request(app.getHttpServer())
      .post('/api/v1/webhooks/payments')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', signWebhook(raw, WEBHOOK_SECRET))
      .set('X-Razorpay-Event-Id', eventId)
      .send(raw)
  }
  const row = async (studioId: string) => {
    const res = await admin.get('/api/v1/admin/studios').query({ limit: 100 }).expect(200)
    return res.body.data.find((r: { id: string }) => r.id === studioId)
  }

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp({ payments: new RazorpayPaymentService(KEY_ID, KEY_SECRET, rzp.http) }))
    await resetDb(prisma)
    jest.spyOn(app.get(MailService), 'send').mockImplementation(async (m) => {
      mails.push(m)
    })
    F = await signup(app, { plan: 'trial', studioName: 'Free Frames' })
    ;({ agent: admin, id: adminId, email: adminEmail } = await adminAgent(app, prisma, 'plans-admin@weddyzone.test', 'Ops Admin'))
    pro = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } })
    vip = await prisma.plan.findUniqueOrThrow({ where: { code: 'ALL_ACCESS' } })
  })
  afterAll(() => app.close())

  it('is for platform admins only: studios get 403, signed-out callers 401', async () => {
    await F.agent.get(`${base(F.studioId)}/plan-quote`).query({ planId: pro.id, cycle: 'MONTHLY' }).expect(403)
    await F.agent.post(`${base(F.studioId)}/plan-order`).send({ planId: pro.id, cycle: 'MONTHLY' }).expect(403)
    await F.agent
      .post(`${base(F.studioId)}/plan-verify`)
      .send({ paymentId: F.userId, razorpayOrderId: 'order_x', razorpayPaymentId: 'pay_x', razorpaySignature: 'a'.repeat(64) })
      .expect(403)
    await request(app.getHttpServer()).post(`${base(F.studioId)}/plan-order`).send({ planId: pro.id, cycle: 'MONTHLY' }).expect(401)
    expect(rzp.orders.size).toBe(0)
  })

  it('Free → Pro: the order is for exactly the GST-inclusive price shown, and nothing changes until it is paid', async () => {
    const q = await quote(F.studioId, pro, 'MONTHLY')
    // ₹600 includes 18% GST: ₹508.47 taxable + ₹91.53 GST. No credit on the free subscription.
    expect(q).toMatchObject({ planName: 'Pro', planCode: 'PRO', cycle: 'MONTHLY', pricePaise: 60_000, creditPaise: 0, payablePaise: 60_000, basePaise: 50_847, gstPaise: 9_153, paymentMode: 'test' })
    expect(q.basePaise + q.gstPaise).toBe(q.payablePaise)

    const res = await order(F.studioId, pro, 'MONTHLY')
    expect(res.payment).toMatchObject({ status: 'PENDING', amountPaise: 60_000, gstPaise: 9_153, paidByAdmin: true, purpose: 'SUBSCRIPTION' })
    // Checkout is opened for the admin (prefilled with the admin's details), for the same amount.
    expect(res.checkout).toMatchObject({ provider: 'razorpay', keyId: KEY_ID, paymentId: res.payment.id, amountPaise: 60_000, prefill: { email: adminEmail } })
    expect(rzp.orders.get(res.checkout!.orderId)).toMatchObject({ amount: q.payablePaise, receipt: res.payment.id })

    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: res.payment.id } })
    expect(stored).toMatchObject({ studioId: F.studioId, planId: pro.id, cycle: 'MONTHLY', amount: 60_000, gst: 9_153, paidByAdminId: adminId, description: 'Pro plan · Monthly' })
    expect(stored.meta).toMatchObject({ paidBy: 'admin', adminUserId: adminId, basePaise: 50_847, gstPaise: 9_153, gstIncluded: true })

    const s = await sub(F.studioId)
    expect(s).toMatchObject({ isTrial: true })
    expect(s.plan.code).toBe('STARTER')
  })

  it('a wrong signature, another studio or a studio-paid order is refused; the plan stays as it is', async () => {
    const pending = await prisma.payment.findFirstOrThrow({ where: { studioId: F.studioId, status: 'PENDING', paidByAdminId: adminId } })
    const paid = rzp.pay(pending.gatewayOrderId!)
    await verify(F.studioId, pending.id, { ...paid, razorpaySignature: 'b'.repeat(64) }).expect(400)
    const other = await signup(app, { plan: 'trial' })
    await verify(other.studioId, pending.id, paid).expect(404)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('PENDING')
    expect((await sub(F.studioId)).plan.code).toBe('STARTER')

    // A payment the studio opened itself can't be confirmed through the admin endpoint.
    const own = await other.agent.post('/api/v1/subscription/change').send({ planCode: 'PRO', cycle: 'MONTHLY' }).expect(200)
    await verify(other.studioId, own.body.payment.id, rzp.pay(own.body.checkout.orderId)).expect(404)
  })

  it('once Razorpay confirms it: the plan, dates, billing history, invoice, audit log and the studio are all updated', async () => {
    const pending = await prisma.payment.findFirstOrThrow({ where: { studioId: F.studioId, status: 'PENDING', paidByAdminId: adminId } })
    const paid = rzp.pay(pending.gatewayOrderId!, 'authorized')
    const res = await verify(F.studioId, pending.id, paid).expect(200)
    expect(res.body.payment).toMatchObject({ id: pending.id, status: 'SUCCESS', amountPaise: 60_000, gstPaise: 9_153, paidByAdmin: true })
    expect(rzp.payments.get(paid.razorpayPaymentId)?.status).toBe('captured')

    const s = await sub(F.studioId)
    expect(s).toMatchObject({ isTrial: false, cycle: 'MONTHLY', status: 'ACTIVE', amountPaid: 60_000, gstAmount: 9_153 })
    expect(s.plan.code).toBe('PRO')
    const days = (s.currentPeriodEnd.getTime() - s.currentPeriodStart.getTime()) / DAY
    expect(days).toBeGreaterThanOrEqual(28)
    expect(days).toBeLessThanOrEqual(31)
    expect(Math.abs(s.currentPeriodStart.getTime() - Date.now())).toBeLessThan(60_000)
    // Monthly limits restart from the new plan's start, like a normal purchase.
    expect(s.usageAnchor?.getTime()).toBe(s.currentPeriodStart.getTime())

    // The admin table row: plan, dates, status.
    expect(await row(F.studioId)).toMatchObject({
      plan: 'Pro',
      planCode: 'PRO',
      cycle: 'MONTHLY',
      period: '1 month',
      status: 'ACTIVE',
      startDate: s.currentPeriodStart.toISOString(),
      expiryDate: s.currentPeriodEnd.toISOString(),
    })

    // The studio sees Pro as its current plan, and the payment as paid by admin (without the admin's name).
    const overview = (await F.agent.get('/api/v1/subscription').expect(200)).body
    expect(overview.subscription).toMatchObject({ isTrial: false, cycle: 'MONTHLY', status: 'ACTIVE' })
    expect(overview.subscription.plan.code).toBe('PRO')
    expect(overview.recentPayments[0]).toMatchObject({ id: pending.id, status: 'SUCCESS', amountPaise: 60_000, gstPaise: 9_153, paidByAdmin: true, paidByAdminName: null })

    // GST invoice: taxable value + GST = the amount charged, marked as paid by admin.
    const inv = (await F.agent.get(`/api/v1/subscription/payments/${pending.id}/invoice`).expect(200)).body
    expect(inv).toMatchObject({ totalPaise: 60_000, taxablePaise: 50_847, paidByAdmin: true, paymentRef: paid.razorpayPaymentId })
    expect(inv.taxablePaise + inv.cgstPaise + inv.sgstPaise + inv.igstPaise).toBe(60_000)
    const adminInv = (await admin.get(`/api/v1/admin/payments/${pending.id}/invoice`).expect(200)).body
    expect(adminInv).toMatchObject({ number: inv.number, paidByAdmin: true })

    // Audit log: admin, studio, old → new plan, duration, amount, payment id (and when).
    const logs = await prisma.adminAuditLog.findMany({ where: { action: 'studio.plan_paid', targetId: F.studioId } })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ actorUserId: adminId, targetType: 'studio' })
    expect(logs[0].summary).toBe(`Paid ₹600 (incl. ₹91.53 GST) for "Free Frames": Free Subscription → Pro (Monthly) · payment ${paid.razorpayPaymentId} · invoice ${inv.number}`)
    expect(logs[0].createdAt).toBeInstanceOf(Date)

    // Subscription timeline (who did it) and the admin's payment table (which admin).
    const events = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: s.id }, orderBy: { createdAt: 'asc' } })
    expect(events.at(-1)).toMatchObject({ type: 'CREATED', fromPlan: 'Free Subscription', toPlan: 'Pro', amount: 60_000, actorId: adminId })
    expect(events.at(-1)?.note).toContain('paid by admin Ops Admin')
    const detail = (await admin.get(`/api/v1/admin/subscriptions/${s.id}`).expect(200)).body
    expect(detail.payments[0]).toMatchObject({ id: pending.id, paidByAdmin: true, paidByAdminName: 'Ops Admin' })

    // The studio is told Wedmanage upgraded it; admins see who paid.
    const note = await prisma.notification.findFirstOrThrow({ where: { studioId: F.studioId, type: 'SUBSCRIPTION_PURCHASED', channel: 'IN_APP' } })
    expect(note.body).toMatch(/^is now active \(1 month\) until \d{2} \w{3} \d{4} · upgraded and paid for by Wedmanage/)
    const mail = mails.find((m) => m.to === F.email && m.subject === `Wedmanage upgraded your plan: Pro (Monthly) · invoice ${inv.number}`)
    expect(mail?.text).toContain('Wedmanage upgraded your studio to the Pro (Monthly) plan and paid for it on your behalf')
    expect(mail?.text).toContain('Taxable value: ₹508.47')
    expect(mail?.text).toContain('Total paid by Wedmanage (incl. GST): ₹600')
    expect(mails.some((m) => m.to === adminEmail && m.subject === 'Admin payment: Ops Admin paid ₹600 for Free Frames (Pro (Monthly))')).toBe(true)
    const adminAlert = await prisma.notification.findFirstOrThrow({ where: { recipientType: 'ADMIN', type: 'SUBSCRIPTION_PURCHASED', channel: 'IN_APP' } })
    expect(adminAlert.title).toBe('Ops Admin paid for Free Frames: Pro (Monthly)')
    expect(adminAlert.body).toMatch(/^₹600 incl\. ₹91\.53 GST · paid by admin · created · expires /)
  })

  it('confirming again, refreshing, or Razorpay’s webhook afterwards does not apply the plan twice', async () => {
    const paid = await prisma.payment.findFirstOrThrow({ where: { studioId: F.studioId, status: 'SUCCESS', paidByAdminId: adminId } })
    const before = await sub(F.studioId)
    const events = await prisma.subscriptionEvent.count({ where: { subscriptionId: before.id } })
    // The same Checkout response again (e.g. the admin refreshed or the browser retried).
    const again = {
      razorpayOrderId: paid.gatewayOrderId!,
      razorpayPaymentId: paid.gatewayPaymentId!,
      razorpaySignature: createHmac('sha256', KEY_SECRET).update(`${paid.gatewayOrderId}|${paid.gatewayPaymentId}`).digest('hex'),
    }
    expect((await verify(F.studioId, paid.id, again).expect(200)).body.payment).toMatchObject({ id: paid.id, status: 'SUCCESS' })
    expect((await verify(F.studioId, paid.id, again).expect(200)).body.payment.status).toBe('SUCCESS')
    const hooked = await hook(
      { event: 'payment.captured', payload: { payment: { entity: { id: paid.gatewayPaymentId, order_id: paid.gatewayOrderId, amount: paid.amount, status: 'captured' } } } },
      'evt_admin_paid_1',
    ).expect(200)
    expect(hooked.body.handled).toBe('already_paid')

    const after = await sub(F.studioId)
    expect(after.currentPeriodEnd.getTime()).toBe(before.currentPeriodEnd.getTime())
    expect(await prisma.subscriptionEvent.count({ where: { subscriptionId: before.id } })).toBe(events)
    expect(await prisma.payment.count({ where: { studioId: F.studioId, status: 'SUCCESS' } })).toBe(1)
    expect(await prisma.adminAuditLog.count({ where: { action: 'studio.plan_paid', targetId: F.studioId } })).toBe(1)
    expect(await prisma.notification.count({ where: { studioId: F.studioId, type: 'SUBSCRIPTION_PURCHASED', channel: 'IN_APP' } })).toBe(1)
  })

  it('Pro → VIP: the credit for unused days comes off the inclusive price first, then GST is split out of what is left', async () => {
    const q = await quote(F.studioId, vip, 'MONTHLY')
    // Pro (₹600) was paid moments ago: almost all of it is credit.
    expect(q.pricePaise).toBe(120_000)
    expect(q.creditPaise).toBeGreaterThan(59_000)
    expect(q.creditPaise).toBeLessThanOrEqual(60_000)
    expect(q.payablePaise).toBe(q.pricePaise - q.creditPaise)
    expect(splitInclusiveGstPaise(q.payablePaise)).toMatchObject({ basePaise: q.basePaise, gstPaise: q.gstPaise })

    const res = await order(F.studioId, vip, 'MONTHLY')
    // The order is for exactly what's charged; the credit shrinks by the second, so it's within a few paise of the quote.
    expect(rzp.orders.get(res.checkout!.orderId)!.amount).toBe(res.payment.amountPaise)
    expect(Math.abs(res.payment.amountPaise - q.payablePaise)).toBeLessThanOrEqual(5)
    expect(res.payment.gstPaise).toBe(splitInclusiveGstPaise(res.payment.amountPaise).gstPaise)

    await verify(F.studioId, res.payment.id, rzp.pay(res.checkout!.orderId)).expect(200)
    const s = await sub(F.studioId)
    expect(s.plan.code).toBe('ALL_ACCESS')
    expect(s).toMatchObject({ cycle: 'MONTHLY', amountPaid: res.payment.amountPaise, gstAmount: res.payment.gstPaise })
    const last = await prisma.subscriptionEvent.findFirstOrThrow({ where: { subscriptionId: s.id }, orderBy: { createdAt: 'desc' } })
    expect(last).toMatchObject({ type: 'UPGRADED', fromPlan: 'Pro', toPlan: 'VIP', actorId: adminId })
    expect(await row(F.studioId)).toMatchObject({ plan: 'VIP', period: '1 month', status: 'ACTIVE' })
  })

  it('changing the duration (VIP 1 month → 1 year) works the same way', async () => {
    const q = await quote(F.studioId, vip, 'YEARLY')
    expect(q.pricePaise).toBe(1_000_000)
    expect(q.creditPaise).toBeGreaterThan(0)
    const res = await order(F.studioId, vip, 'YEARLY')
    await verify(F.studioId, res.payment.id, rzp.pay(res.checkout!.orderId)).expect(200)
    const s = await sub(F.studioId)
    expect(s.plan.code).toBe('ALL_ACCESS')
    expect(s.cycle).toBe('YEARLY')
    expect((s.currentPeriodEnd.getTime() - s.currentPeriodStart.getTime()) / DAY).toBeGreaterThanOrEqual(365)
    expect(await row(F.studioId)).toMatchObject({ plan: 'VIP', period: '1 year', status: 'ACTIVE' })
    expect(await prisma.adminAuditLog.count({ where: { action: 'studio.plan_paid', targetId: F.studioId } })).toBe(3)
  })

  it('a failed payment leaves the plan as it is, and the studio is not told', async () => {
    const before = await sub(F.studioId)
    const res = await order(F.studioId, pro, 'HALF_YEARLY')
    const failed = await hook(
      {
        event: 'payment.failed',
        payload: { payment: { entity: { id: 'pay_admin_declined', order_id: res.checkout!.orderId, amount: res.payment.amountPaise, error_description: 'Your bank declined this payment' } } },
      },
      'evt_admin_failed_1',
    ).expect(200)
    expect(failed.body.handled).toBe('payment_failed')
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: res.payment.id } })).status).toBe('FAILED')
    const after = await sub(F.studioId)
    expect(after).toMatchObject({ planId: before.planId, cycle: before.cycle, currentPeriodEnd: before.currentPeriodEnd, lastPaymentFailedAt: null, status: before.status })
    expect(await prisma.notification.count({ where: { studioId: F.studioId, type: 'PAYMENT_FAILED' } })).toBe(0)

    // The studio's billing history shows the plans an admin paid for, not the admin's failed or unfinished attempts.
    await order(F.studioId, pro, 'YEARLY')
    const overview = (await F.agent.get('/api/v1/subscription').expect(200)).body
    const history = (await F.agent.get('/api/v1/subscription/payments').expect(200)).body
    for (const list of [overview.recentPayments, history.data]) {
      expect(list.map((p: { status: string }) => p.status)).toEqual(['SUCCESS', 'SUCCESS', 'SUCCESS'])
      expect(list.every((p: { paidByAdmin: boolean }) => p.paidByAdmin)).toBe(true)
    }
    // Admins still see every attempt.
    const detail = (await admin.get(`/api/v1/admin/subscriptions/${after.id}`).expect(200)).body
    expect(detail.payments.map((p: { status: string }) => p.status).slice(0, 2)).toEqual(['PENDING', 'FAILED'])
  })

  it('says when the studio is already on that plan, and refuses removed studios', async () => {
    const same = await admin.get(`${base(F.studioId)}/plan-quote`).query({ planId: vip.id, cycle: 'YEARLY' }).expect(409)
    expect(same.body.error.message).toBe('This studio is already on the VIP plan (1 year)')
    const free = await prisma.plan.findUniqueOrThrow({ where: { code: 'STARTER' } })
    await admin.get(`${base(F.studioId)}/plan-quote`).query({ planId: free.id, cycle: 'MONTHLY' }).expect(400)

    const gone = await signup(app, { plan: 'trial', studioName: 'Gone Frames' })
    await admin.post(`${base(gone.studioId)}/remove`).send({ confirmName: 'Gone Frames' }).expect(200)
    await admin.post(`${base(gone.studioId)}/plan-order`).send({ planId: pro.id, cycle: 'MONTHLY' }).expect(400)
    await admin.post(`${base('00000000-0000-4000-8000-000000000000')}/plan-order`).send({ planId: pro.id, cycle: 'MONTHLY' }).expect(404)
  })
})

describe('Admin → Studios → Change plan with simulated payments (no Razorpay keys)', () => {
  let app: INestApplication
  let prisma: PrismaClient

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp())
    await resetDb(prisma)
  })
  afterAll(() => app.close())

  it('is confirmed at once, like a studio checkout, and recorded as paid by admin', async () => {
    const T = await signup(app, { plan: 'trial', studioName: 'Mock Frames' })
    const { agent, id } = await adminAgent(app, prisma, 'mock-plans-admin@weddyzone.test', 'Mock Admin')
    const vip = await prisma.plan.findUniqueOrThrow({ where: { code: 'ALL_ACCESS' } })
    const res = await agent.post(`/api/v1/admin/studios/${T.studioId}/plan-order`).send({ planId: vip.id, cycle: 'HALF_YEARLY' }).expect(200)
    // ₹6,000 includes ₹915.25 GST.
    expect(res.body).toMatchObject({ checkout: null, paymentMode: 'mock', payment: { status: 'SUCCESS', amountPaise: 600_000, gstPaise: 91_525, paidByAdmin: true } })
    const s = await prisma.subscription.findUniqueOrThrow({ where: { studioId: T.studioId }, include: { plan: true } })
    expect(s.plan.code).toBe('ALL_ACCESS')
    expect(s).toMatchObject({ cycle: 'HALF_YEARLY', isTrial: false })
    expect(await prisma.adminAuditLog.count({ where: { action: 'studio.plan_paid', targetId: T.studioId, actorUserId: id } })).toBe(1)
  })
})
