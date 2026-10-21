import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import { createHmac } from 'crypto'
import request from 'supertest'
import { RazorpayPaymentService } from '../src/core/razorpay-payment.service'
import { SubscriptionLifecycleService } from '../src/subscriptions/lifecycle.service'
import { signWebhook } from '../src/subscriptions/webhooks.controller'
import { createTestApp, putOnPlan, resetDb, signup, type SignedUp } from './helpers'

const KEY_ID = 'rzp_test_fake123'
const KEY_SECRET = 'fake-key-secret'
const WEBHOOK_SECRET = 'test-webhook-secret'

/** An in-memory Razorpay: orders, payments, capture. Nothing leaves the machine. */
function fakeRazorpay() {
  const orders = new Map<string, { id: string; amount: number; receipt: string }>()
  const payments = new Map<string, { id: string; order_id: string; amount: number; currency: string; status: string }>()
  const calls: string[] = []
  let down = false
  let n = 0
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const http = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url))
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${u.pathname}`)
    if (down) return json(500, { error: { description: 'Server error' } })
    const auth = new Headers(init?.headers).get('Authorization')
    if (auth !== `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`) return json(401, { error: { description: 'Authentication failed' } })
    if (method === 'POST' && u.pathname === '/v1/orders') {
      const body = JSON.parse(String(init?.body)) as { amount: number; receipt: string; currency: string }
      expect(body.currency).toBe('INR')
      const order = { id: `order_fake${++n}`, amount: body.amount, receipt: body.receipt }
      orders.set(order.id, order)
      return json(200, order)
    }
    const pay = u.pathname.match(/^\/v1\/payments\/([^/]+)(\/capture)?$/)
    if (pay) {
      const p = payments.get(decodeURIComponent(pay[1]))
      if (!p) return json(404, { error: { description: 'No such payment' } })
      if (pay[2] && method === 'POST') {
        if (p.status !== 'authorized') return json(400, { error: { description: 'This payment has already been captured' } })
        p.status = 'captured'
      }
      return json(200, p)
    }
    return json(404, { error: { description: 'Unknown endpoint' } })
  }) as typeof fetch
  /** The studio pays the order in Checkout (Razorpay holds it "authorized" until captured, unless auto-capture is on). */
  const pay = (orderId: string, status: 'authorized' | 'captured' = 'authorized', amount?: number) => {
    const order = orders.get(orderId)!
    const id = `pay_fake${++n}`
    payments.set(id, { id, order_id: orderId, amount: amount ?? order.amount, currency: 'INR', status })
    const signature = createHmac('sha256', KEY_SECRET).update(`${orderId}|${id}`).digest('hex')
    return { razorpayPaymentId: id, razorpayOrderId: orderId, razorpaySignature: signature }
  }
  return {
    http,
    orders,
    payments,
    calls,
    pay,
    setDown: (v: boolean) => {
      down = v
    },
  }
}

describe('Razorpay: Checkout orders, confirmation, webhooks', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let A: SignedUp
  const rzp = fakeRazorpay()

  const hook = (body: object, eventId: string) => {
    const raw = JSON.stringify(body)
    return request(app.getHttpServer())
      .post('/api/v1/webhooks/payments')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', signWebhook(raw, WEBHOOK_SECRET))
      .set('X-Razorpay-Event-Id', eventId)
      .send(raw)
  }
  const captured = (orderId: string, paymentId: string, amount: number) => ({
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, status: 'captured' } } },
  })
  const failed = (orderId: string, paymentId: string, amount: number) => ({
    event: 'payment.failed',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, error_description: 'Your bank declined this payment' } } },
  })
  const sub = () => prisma.subscription.findUniqueOrThrow({ where: { studioId: A.studioId }, include: { plan: true } })

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp({ payments: new RazorpayPaymentService(KEY_ID, KEY_SECRET, rzp.http) }))
    await resetDb(prisma)
    A = await signup(app, { plan: 'trial', studioName: 'Razor Studio' })
  })
  afterAll(() => app.close())

  it('says payments are in Razorpay test mode, without auto-renew', async () => {
    const res = await A.agent.get('/api/v1/subscription').expect(200)
    expect(res.body).toMatchObject({ testMode: true, paymentMode: 'test', autoRenewAvailable: false })
    const credits = await A.agent.get('/api/v1/credits').expect(200)
    expect(credits.body).toMatchObject({ testMode: true, paymentMode: 'test' })
  })

  it('opens a Razorpay order for a plan; nothing changes until it is paid', async () => {
    const res = await A.agent.post('/api/v1/subscription/change').send({ planCode: 'PRO', cycle: 'YEARLY' }).expect(200)
    expect(res.body.payment).toMatchObject({ status: 'PENDING', amountPaise: 590_000, provider: 'razorpay' })
    expect(res.body.checkout).toMatchObject({
      provider: 'razorpay',
      keyId: KEY_ID,
      paymentId: res.body.payment.id,
      amountPaise: 590_000,
      currency: 'INR',
      name: 'Wedmanage Studio',
      prefill: { email: A.email },
    })
    const order = rzp.orders.get(res.body.checkout.orderId)!
    expect(order).toMatchObject({ amount: 590_000, receipt: res.body.payment.id })
    expect((await sub()).plan.code).toBe('STARTER')
  })

  it('refuses a Checkout response with a wrong signature', async () => {
    const pending = await prisma.payment.findFirstOrThrow({ where: { studioId: A.studioId, status: 'PENDING' } })
    const paid = rzp.pay(pending.gatewayOrderId!)
    await A.agent.post(`/api/v1/subscription/payments/${pending.id}/verify`).send({ ...paid, razorpaySignature: 'a'.repeat(64) }).expect(400)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('PENDING')
    expect((await sub()).plan.code).toBe('STARTER')
    // Another studio can't confirm it either.
    const B = await signup(app, { plan: 'trial' })
    await B.agent.post(`/api/v1/subscription/payments/${pending.id}/verify`).send(paid).expect(404)
  })

  it('confirms the paid Checkout with Razorpay (capturing it), activates the plan; the webhook afterwards is a no-op', async () => {
    const pending = await prisma.payment.findFirstOrThrow({ where: { studioId: A.studioId, status: 'PENDING' } })
    const paid = rzp.pay(pending.gatewayOrderId!, 'authorized')
    const res = await A.agent.post(`/api/v1/subscription/payments/${pending.id}/verify`).send(paid).expect(200)
    expect(res.body.payment).toMatchObject({ status: 'SUCCESS', amountPaise: 590_000 })
    expect(res.body.payment.invoiceNumber).toMatch(/^WZ\//)
    expect(rzp.payments.get(paid.razorpayPaymentId)!.status).toBe('captured')
    const after = await sub()
    expect(after).toMatchObject({ isTrial: false, cycle: 'YEARLY', status: 'ACTIVE' })
    expect(after.plan.code).toBe('PRO')

    const hooked = await hook(captured(paid.razorpayOrderId, paid.razorpayPaymentId, 590_000), 'evt_rzp_1').expect(200)
    expect(hooked.body.handled).toBe('already_paid')
    expect((await sub()).currentPeriodEnd).toEqual(after.currentPeriodEnd)
    // Confirming again is harmless.
    await A.agent.post(`/api/v1/subscription/payments/${pending.id}/verify`).send(paid).expect(200)
    expect((await sub()).currentPeriodEnd).toEqual(after.currentPeriodEnd)
  })

  it('applies a payment once when the Checkout confirmation and the webhook arrive together', async () => {
    const res = await A.agent.post('/api/v1/subscription/change').send({ planCode: 'ALL_ACCESS', cycle: 'MONTHLY' }).expect(200)
    const paid = rzp.pay(res.body.checkout.orderId, 'captured')
    const amount = res.body.checkout.amountPaise
    await Promise.all([
      A.agent.post(`/api/v1/subscription/payments/${res.body.payment.id}/verify`).send(paid).expect(200),
      hook(captured(paid.razorpayOrderId, paid.razorpayPaymentId, amount), 'evt_rzp_together').expect(200),
    ])
    const s = await sub()
    expect(s.plan.code).toBe('ALL_ACCESS')
    const events = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: s.id, type: 'UPGRADED' } })
    expect(events).toHaveLength(1)
    expect(await prisma.payment.count({ where: { studioId: A.studioId, status: 'SUCCESS', purpose: 'SUBSCRIPTION' } })).toBe(2)
  })

  it('a failed upgrade attempt leaves the paid plan active; one alert per order, in the app only', async () => {
    const res = await A.agent.post('/api/v1/subscription/change').send({ planCode: 'ALL_ACCESS', cycle: 'YEARLY' }).expect(200)
    const { orderId, amountPaise } = res.body.checkout
    await hook(failed(orderId, 'pay_fail_a', amountPaise), 'evt_rzp_fail_a').expect(200)
    await hook(failed(orderId, 'pay_fail_b', amountPaise), 'evt_rzp_fail_b').expect(200)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: res.body.payment.id } })).status).toBe('FAILED')
    expect((await sub()).status).toBe('ACTIVE')
    const alerts = await prisma.notification.findMany({ where: { studioId: A.studioId, type: 'PAYMENT_FAILED' } })
    expect(alerts.map((a) => a.channel)).toEqual(['IN_APP'])
    // The studio tries again in the same window and it goes through.
    const paid = rzp.pay(orderId, 'captured')
    await A.agent.post(`/api/v1/subscription/payments/${res.body.payment.id}/verify`).send(paid).expect(200)
    expect(await sub()).toMatchObject({ cycle: 'YEARLY', status: 'ACTIVE' })
  })

  it('credit packs: pending until paid, then the credits are added once', async () => {
    const before = (await prisma.studio.findUniqueOrThrow({ where: { id: A.studioId } })).creditBalance
    const res = await A.agent.post('/api/v1/credits/purchase').send({ packCode: 'PACK_500' }).expect(200)
    expect(res.body.payment).toMatchObject({ status: 'PENDING', purpose: 'CREDIT_PACK' })
    expect(res.body.creditBalance).toBe(before)
    expect(res.body.checkout.orderId).toBeTruthy()
    const paid = rzp.pay(res.body.checkout.orderId, 'captured')
    expect((await hook(captured(paid.razorpayOrderId, paid.razorpayPaymentId, res.body.checkout.amountPaise), 'evt_rzp_cr').expect(200)).body.handled).toBe('credits_added')
    expect((await hook(captured(paid.razorpayOrderId, paid.razorpayPaymentId, res.body.checkout.amountPaise), 'evt_rzp_cr2').expect(200)).body.handled).toBe('already_paid')
    const after = (await prisma.studio.findUniqueOrThrow({ where: { id: A.studioId } })).creditBalance
    expect(after - before).toBe(500)
    expect(await prisma.creditLedger.count({ where: { studioId: A.studioId, reason: 'PURCHASE' } })).toBe(1)
  })

  it('+5 events: a failed attempt adds nothing; the retry that is paid adds them', async () => {
    await putOnPlan(prisma, A.studioId, 'PRO')
    const res = await A.agent.post('/api/v1/subscription/addon-events').expect(200)
    expect(res.body.payment).toMatchObject({ status: 'PENDING', purpose: 'EVENT_ADDON' })
    const { orderId, amountPaise } = res.body.checkout
    await hook(failed(orderId, 'pay_addon_fail', amountPaise), 'evt_rzp_addon_fail').expect(200)
    expect(await prisma.usageAddon.count({ where: { studioId: A.studioId } })).toBe(0)
    expect((await sub()).status).toBe('ACTIVE')
    const paid = rzp.pay(orderId, 'captured')
    await A.agent.post(`/api/v1/subscription/payments/${res.body.payment.id}/verify`).send(paid).expect(200)
    const addons = await prisma.usageAddon.findMany({ where: { studioId: A.studioId } })
    expect(addons.map((a) => a.events)).toEqual([5])
    const meter = await A.agent.get('/api/v1/me/usage').expect(200)
    expect(meter.body.events.addon).toBe(5)
  })

  it('refuses a payment for a different amount than the order', async () => {
    const res = await A.agent.post('/api/v1/credits/purchase').send({ packCode: 'PACK_500' }).expect(200)
    const paid = rzp.pay(res.body.checkout.orderId, 'captured', 100)
    expect((await hook(captured(paid.razorpayOrderId, paid.razorpayPaymentId, 100), 'evt_rzp_short').expect(200)).body.handled).toBe('amount_mismatch')
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: res.body.payment.id } })).status).toBe('FAILED')
  })

  it('auto-renew is not offered with Razorpay', async () => {
    await A.agent.post('/api/v1/subscription/auto-renew').send({ autoRenew: true }).expect(409)
  })

  it('turns off auto-renew left over from simulated payments', async () => {
    const s = await sub()
    await prisma.subscription.update({ where: { id: s.id }, data: { autoRenew: true, gatewaySubscriptionId: 'sub_mock_leftover' } })
    await app.get(SubscriptionLifecycleService).onApplicationBootstrap()
    expect(await sub()).toMatchObject({ autoRenew: false, gatewaySubscriptionId: null })
  })

  it('Razorpay down: a clear error, and no half-open payment is left behind', async () => {
    rzp.setDown(true)
    try {
      const res = await A.agent.post('/api/v1/subscription/change').send({ planCode: 'PRO', cycle: 'MONTHLY' }).expect(502)
      expect(res.body.error.code).toBe('PAYMENT_GATEWAY_ERROR')
      expect(await prisma.payment.count({ where: { studioId: A.studioId, status: 'PENDING' } })).toBe(0)
    } finally {
      rzp.setDown(false)
    }
  })
})
