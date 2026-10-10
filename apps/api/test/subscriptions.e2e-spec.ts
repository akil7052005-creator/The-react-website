import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import { addDays, fromIst, istParts } from '@weddyzone/shared'
import { readFileSync } from 'fs'
import { join } from 'path'
import request from 'supertest'
import { createAdmin } from '../prisma/create-admin'
import { totpAt } from '../src/auth/totp'
import { MailService, type MailMessage } from '../src/infra/mail.service'
import { PlatformWhatsAppService } from '../src/infra/platform-whatsapp.service'
import { SubscriptionJobsService } from '../src/subscriptions/jobs.service'
import { signWebhook } from '../src/subscriptions/webhooks.controller'
import { createTestApp, isoDaysFromToday, resetDb, signup, type SignedUp } from './helpers'

type Agent = ReturnType<typeof request.agent>
const DAY = 86_400_000
const SECRET = 'test-webhook-secret'

describe('Subscriptions: webhooks, deadline alerts, admin panel', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let jobs: SubscriptionJobsService
  let admin: Agent
  let adminEmail: string
  let adminPassword: string
  let A: SignedUp
  let mails: MailMessage[]
  /** Pretend a WhatsApp provider is configured (the real Cloud API is never called in tests). */
  let whatsappOn = true
  const waSent: string[] = []

  const hook = (body: object, opts: { eventId?: string; secret?: string; signature?: string } = {}) => {
    const raw = JSON.stringify(body)
    const req = request(app.getHttpServer())
      .post('/api/v1/webhooks/payments')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', opts.signature ?? signWebhook(raw, opts.secret ?? SECRET))
    if (opts.eventId) req.set('X-Razorpay-Event-Id', opts.eventId)
    return req.send(raw)
  }

  /** A pending plan order, as a live gateway checkout would leave it before payment. */
  async function pendingOrder(studioId: string, code: 'PRO' | 'ALL_ACCESS', cycle: 'MONTHLY' | 'YEARLY') {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code } })
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { studioId } })
    const base = cycle === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice!
    const gst = Math.round(base * 0.18)
    return prisma.payment.create({
      data: {
        studioId,
        purpose: 'SUBSCRIPTION',
        description: `${plan.name} plan`,
        amount: base + gst,
        gst,
        status: 'PENDING',
        provider: 'razorpay',
        subscriptionId: sub.id,
        planId: plan.id,
        cycle,
        gatewayOrderId: `order_${Math.random().toString(36).slice(2)}`,
      },
    })
  }

  const captured = (orderId: string, amount: number, paymentId = `pay_${Math.random().toString(36).slice(2)}`) => ({
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, status: 'captured' } } },
  })

  const alertsFor = (subscriptionId: string) => prisma.notification.findMany({ where: { subscriptionId }, orderBy: { createdAt: 'asc' } })

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp())
    jobs = app.get(SubscriptionJobsService)
    const mail = app.get(MailService)
    mails = []
    jest.spyOn(mail, 'send').mockImplementation(async (m) => {
      mails.push(m)
    })
    const wa = app.get(PlatformWhatsAppService)
    jest.spyOn(wa, 'isConfigured').mockImplementation(() => whatsappOn)
    jest.spyOn(wa, 'send').mockImplementation(async (phone, msg) => {
      waSent.push(`${phone}:${msg.template}`)
      return { body: await wa.renderMessage(msg), link: `https://wa.me/${phone.replace(/\D/g, '')}`, delivered: true }
    })
    await resetDb(prisma)
    const created = await createAdmin(prisma, { email: 'ops@weddyzone.test', name: 'Priya Ops' })
    adminEmail = created.email
    adminPassword = created.password
    admin = request.agent(app.getHttpServer())
    await admin.post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword }).expect(200)
    A = await signup(app, { plan: 'trial', studioName: 'StudioRed' })
  })
  afterAll(() => app.close())

  describe('access', () => {
    it('gives non-admins 403 on every admin subscription endpoint', async () => {
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { studioId: A.studioId } })
      const id = sub.id
      const calls: [string, string, object?][] = [
        ['get', '/api/v1/admin/stats'],
        ['get', '/api/v1/admin/subscriptions'],
        ['get', '/api/v1/admin/subscriptions/export.csv'],
        ['get', `/api/v1/admin/subscriptions/${id}`],
        ['post', `/api/v1/admin/subscriptions/${id}/extend`, { days: 5, note: 'please' }],
        ['post', `/api/v1/admin/subscriptions/${id}/change-plan`, { planId: sub.planId, billingCycle: 'YEARLY', note: 'please' }],
        ['post', `/api/v1/admin/subscriptions/${id}/cancel`, { note: 'please' }],
        ['post', `/api/v1/admin/subscriptions/${id}/remind`, { channels: ['IN_APP'] }],
        ['get', '/api/v1/admin/notifications'],
        ['patch', `/api/v1/admin/notifications/${id}/read`],
        ['get', '/api/v1/admin/settings/alerts'],
        ['put', '/api/v1/admin/settings/alerts', { reminderDays: [1], graceDays: 0, digestTime: '01:00', winbackAfterDays: null, winbackPercentOff: 10 }],
        ['post', '/api/v1/admin/jobs/subscription-alerts/run'],
      ]
      for (const [method, path, body] of calls) {
        const res = await (A.agent as unknown as Record<string, (p: string) => request.Test>)[method](path).send(body ?? {})
        expect([path, res.status]).toEqual([path, 403])
      }
      // And nothing changed.
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id } })).currentPeriodEnd).toEqual(sub.currentPeriodEnd)
    })

    it('starts every new studio on a trial with a CREATED event', async () => {
      const res = await A.agent.get('/api/v1/me/subscription').expect(200)
      expect(res.body).toMatchObject({ planCode: 'STARTER', planName: 'Trial', status: 'TRIAL', readOnly: false, daysLeft: 14 })
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { studioId: A.studioId }, include: { events: true } })
      expect(sub.events.map((e) => e.type)).toEqual(['CREATED'])
    })
  })

  describe('payment webhook', () => {
    it('refuses unsigned or wrongly signed calls', async () => {
      const order = await pendingOrder(A.studioId, 'PRO', 'YEARLY')
      await hook(captured(order.gatewayOrderId!, order.amount), { signature: 'deadbeef' }).expect(401)
      await hook(captured(order.gatewayOrderId!, order.amount), { secret: 'wrong-secret' }).expect(401)
      await request(app.getHttpServer()).post('/api/v1/webhooks/payments').send(captured(order.gatewayOrderId!, order.amount)).expect(401)
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING')
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { studioId: A.studioId }, include: { plan: true } })
      expect(sub.plan.code).toBe('STARTER')
      await prisma.payment.delete({ where: { id: order.id } })
    })

    it('activates the plan, issues a GST invoice and alerts studio and admin — once', async () => {
      const order = await pendingOrder(A.studioId, 'PRO', 'YEARLY')
      expect(order.amount).toBe(2_359_882) // ₹19,999 + 18% GST
      mails.length = 0
      const body = captured(order.gatewayOrderId!, order.amount, 'pay_studiored_1')
      const first = await hook(body, { eventId: 'evt_1' }).expect(200)
      expect(first.body).toEqual({ duplicate: false, handled: 'activated' })

      // Gateway retries the same delivery, then sends order.paid for the same payment.
      expect((await hook(body, { eventId: 'evt_1' }).expect(200)).body).toEqual({ duplicate: true, handled: 'duplicate' })
      expect((await hook(body, { eventId: 'evt_2' }).expect(200)).body.handled).toBe('already_paid')

      const sub = await prisma.subscription.findUniqueOrThrow({ where: { studioId: A.studioId }, include: { plan: true } })
      expect(sub).toMatchObject({ status: 'ACTIVE', isTrial: false, cycle: 'YEARLY', amountPaid: 2_359_882, gstAmount: 359_982 })
      expect(sub.plan.code).toBe('PRO')
      // Deadline = +1 year in IST.
      const s = istParts(sub.currentPeriodStart)
      const e = istParts(sub.currentPeriodEnd)
      expect([e.year, e.month, e.day]).toEqual([s.year + 1, s.month, s.day])

      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: order.id } })
      expect(payment).toMatchObject({ status: 'SUCCESS', gatewayPaymentId: 'pay_studiored_1' })
      expect(payment.invoiceNumber).toMatch(/^WZ\/\d{4}-\d{2}\/00001$/)

      const events = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: sub.id }, orderBy: { createdAt: 'asc' } })
      expect(events.map((x) => x.type)).toEqual(['CREATED', 'CREATED'])
      expect(events[1]).toMatchObject({ fromPlan: 'Trial (trial)', toPlan: 'Pro', amount: 2_359_882 })

      const adminAlerts = await prisma.notification.findMany({ where: { recipientType: 'ADMIN', type: 'SUBSCRIPTION_PURCHASED' } })
      expect(adminAlerts.map((n) => n.channel).sort()).toEqual(['EMAIL', 'IN_APP'])
      expect(adminAlerts[0].title).toBe('StudioRed chose Pro (Yearly)')
      // Admin amounts exclude GST.
      expect(adminAlerts[0].body).toMatch(/^₹19,999 \+ GST · created · expires \d{2} \w{3} \d{4}$/)
      // Instant admin email + studio confirmation with the invoice, each sent once despite the retries.
      expect(mails.filter((m) => m.to === adminEmail && /StudioRed chose Pro \(Yearly\)/.test(m.subject))).toHaveLength(1)
      const confirmation = mails.filter((m) => m.to === A.email)
      expect(confirmation).toHaveLength(1)
      expect(confirmation[0].text).toContain(payment.invoiceNumber!)
      expect(confirmation[0].text).toContain('GST @ 18%: ₹3,599.82')

      const invoice = await A.agent.get(`/api/v1/subscription/payments/${payment.id}/invoice`).expect(200)
      expect(invoice.body).toMatchObject({ number: payment.invoiceNumber, taxablePaise: 1_999_900, totalPaise: 2_359_882, igstPaise: 359_982 })
    })

    it('shows the new purchase in the admin table and bell straight away', async () => {
      const list = await admin.get('/api/v1/admin/subscriptions').query({ search: 'studiored' }).expect(200)
      expect(list.body.meta.total).toBe(1)
      // Admin amounts exclude GST: ₹19,999, not the ₹23,598.82 charged.
      expect(list.body.data[0]).toMatchObject({ studio: { name: 'StudioRed' }, plan: { code: 'PRO' }, cycle: 'YEARLY', amountPaise: 1_999_900, status: 'ACTIVE', tone: 'green' })
      expect(list.body.data[0].owner).toMatchObject({ email: A.email, phone: '+919876543210' })
      const bell = await admin.get('/api/v1/admin/notifications').expect(200)
      expect(bell.body.unreadCount).toBeGreaterThanOrEqual(1)
      const alert = bell.body.data.find((n: { title: string }) => n.title === 'StudioRed chose Pro (Yearly)')
      expect(alert).toBeTruthy()
      await admin.patch(`/api/v1/admin/notifications/${alert.id}/read`).expect(200)
      const after = await admin.get('/api/v1/admin/notifications').query({ unread: 'true' }).expect(200)
      expect(after.body.data.find((n: { id: string }) => n.id === alert.id)).toBeUndefined()
    })

    it('never takes a plan from the browser: test-mode checkout goes through the same webhook handler', async () => {
      const B = await signup(app, { plan: 'trial' })
      const res = await B.agent.post('/api/v1/subscription/change').send({ planCode: 'ALL_ACCESS', cycle: 'MONTHLY' }).expect(200)
      expect(res.body.subscription.plan.code).toBe('ALL_ACCESS')
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: res.body.payment.id } })
      expect(payment.gatewayOrderId).toMatch(/^order_mock_/)
      expect(payment.gatewayPaymentId).toMatch(/^pay_mock_/)
      expect(await prisma.webhookEvent.count({ where: { type: 'payment.captured' } })).toBeGreaterThanOrEqual(1)
    })

    it('marks a failed payment, alerts the studio with a retry link and the admin', async () => {
      const order = await pendingOrder(A.studioId, 'ALL_ACCESS', 'YEARLY')
      await hook({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_fail_1', order_id: order.gatewayOrderId, amount: order.amount, error_description: 'Card declined' } } } }, { eventId: 'evt_fail_1' }).expect(200)
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('FAILED')
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { studioId: A.studioId } })
      expect(sub.status).toBe('PAYMENT_FAILED')
      const studioAlert = await prisma.notification.findFirstOrThrow({ where: { studioId: A.studioId, type: 'PAYMENT_FAILED', channel: 'IN_APP' } })
      expect(studioAlert.link).toBe('/subscriptions?renew=ALL_ACCESS&cycle=YEARLY')
      expect(await prisma.notification.count({ where: { recipientType: 'ADMIN', type: 'PAYMENT_FAILED' } })).toBe(2)
      const failedTab = await admin.get('/api/v1/admin/subscriptions').query({ tab: 'failed' }).expect(200)
      expect(failedTab.body.data.map((r: { studio: { name: string } }) => r.studio.name)).toContain('StudioRed')
      // A later successful payment clears it.
      await prisma.subscription.update({ where: { id: sub.id }, data: { lastPaymentFailedAt: null, status: 'ACTIVE' } })
    })
  })

  describe('deadline job', () => {
    let S: SignedUp
    let subId: string
    let end: Date

    beforeAll(async () => {
      S = await signup(app, { plan: 'trial', studioName: 'Deadline Studio' })
      const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } })
      // Deadline 8 days ago at 10:00 IST, so "now" (real time) is past the 7 grace days.
      const p = istParts(addDays(new Date(), -8))
      end = fromIst({ year: p.year, month: p.month, day: p.day, hour: 10 })
      const sub = await prisma.subscription.update({
        where: { studioId: S.studioId },
        data: { planId: plan.id, isTrial: false, status: 'ACTIVE', currentPeriodStart: addDays(end, -30), currentPeriodEnd: end, amountPaid: 294_882, gstAmount: 44_982 },
      })
      subId = sub.id
    })

    const at = (offsetMs: number) => new Date(end.getTime() + offsetMs)
    const keys = async () => (await alertsFor(subId)).map((n) => `${n.dedupeKey?.split(':').slice(-3).join(':')}`)
    // Rows written together share a timestamp, so compare each stage's alerts as a set.
    const stageKeys = async (...stages: string[]) => (await keys()).filter((k) => stages.includes(k.split(':')[0])).sort()
    const set = (...k: string[]) => [...k].sort()

    it('sends nothing more than 7 days out', async () => {
      await jobs.run(at(-8 * DAY))
      expect(await alertsFor(subId)).toHaveLength(0)
    })

    it('sends T-7 by in-app, email and WhatsApp with a renew link, exactly once', async () => {
      await jobs.run(at(-7 * DAY))
      await jobs.run(at(-7 * DAY + 3_600_000)) // the next hourly run
      await jobs.run(at(-6 * DAY)) // still the T-7 window
      expect(await stageKeys('T-7')).toEqual(set('T-7:STUDIO:IN_APP', 'T-7:STUDIO:EMAIL', 'T-7:STUDIO:WHATSAPP'))
      expect(await keys()).toHaveLength(3)
      const inApp = (await alertsFor(subId)).find((n) => n.channel === 'IN_APP')!
      expect(inApp.link).toBe('/subscriptions?renew=PRO&cycle=MONTHLY')
      expect(inApp.body).toMatch(/expires on \d{2} \w{3} \d{4}/)
      const wa = (await alertsFor(subId)).find((n) => n.channel === 'WHATSAPP')!
      // Sent from the platform's number with the approved template text; no studio credits spent.
      expect(wa.body).toContain('Deadline Studio')
      expect(wa.sentAt).not.toBeNull()
      expect(waSent.filter((x) => x.endsWith(':PLAN_EXPIRY_REMINDER'))).toHaveLength(1)
      expect(await prisma.whatsAppMessage.count({ where: { studioId: S.studioId } })).toBe(0)
      const credits = await prisma.studio.findUniqueOrThrow({ where: { id: S.studioId } })
      expect(credits.creditBalance).toBe(50)
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: subId } })).status).toBe('EXPIRING_SOON')
    })

    it('sends T-3 by in-app + WhatsApp, and T-1 to studio and admin', async () => {
      await jobs.run(at(-3 * DAY))
      await jobs.run(at(-3 * DAY + 60_000))
      await jobs.run(at(-1 * DAY))
      await jobs.run(at(-1 * DAY + 60_000))
      expect(await stageKeys('T-3')).toEqual(set('T-3:STUDIO:IN_APP', 'T-3:STUDIO:WHATSAPP'))
      expect(await stageKeys('T-1')).toEqual(set('T-1:STUDIO:IN_APP', 'T-1:STUDIO:EMAIL', 'T-1:STUDIO:WHATSAPP', 'T-1:ADMIN:IN_APP', 'T-1:ADMIN:EMAIL'))
      expect(await keys()).toHaveLength(10)
    })

    it('moves ACTIVE → GRACE at the deadline (full access) and alerts admin instantly', async () => {
      await jobs.run(at(-60_000))
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: subId } })).status).toBe('EXPIRING_SOON')
      await jobs.run(at(60_000))
      await jobs.run(at(3_600_000))
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } })
      expect(sub.status).toBe('GRACE')
      expect(sub.graceEndsAt).toEqual(new Date(end.getTime() + 7 * DAY))
      expect(await stageKeys('T')).toEqual(set('T:STUDIO:IN_APP', 'T:STUDIO:EMAIL', 'T:STUDIO:WHATSAPP', 'T:ADMIN:IN_APP', 'T:ADMIN:EMAIL'))
      expect(await keys()).toHaveLength(15)
      const grace = (await alertsFor(subId)).find((n) => n.dedupeKey?.endsWith('T:STUDIO:IN_APP'))!
      expect(grace.body).toMatch(/renew within 7 days/i)
      const types = (await prisma.subscriptionEvent.findMany({ where: { subscriptionId: subId } })).map((e) => e.type)
      expect(types.filter((t) => t === 'GRACE_STARTED')).toHaveLength(1)
    })

    it('moves GRACE → EXPIRED when grace ends: read-only, data kept', async () => {
      await jobs.run(at(7 * DAY + 60_000))
      await jobs.run(at(7 * DAY + 2 * 3_600_000))
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } })
      expect(sub.status).toBe('EXPIRED')
      expect(await stageKeys('GRACE_END')).toEqual(set('GRACE_END:STUDIO:IN_APP', 'GRACE_END:STUDIO:EMAIL', 'GRACE_END:STUDIO:WHATSAPP', 'GRACE_END:ADMIN:IN_APP', 'GRACE_END:ADMIN:EMAIL'))
      expect(await keys()).toHaveLength(20)

      // Real "now" is past grace too, so the API enforces read-only.
      const banner = await S.agent.get('/api/v1/me/subscription').expect(200)
      expect(banner.body).toMatchObject({ status: 'EXPIRED', readOnly: true, renewLink: '/subscriptions?renew=PRO&cycle=MONTHLY' })
      const client = await S.agent.post('/api/v1/clients').send({ name: 'Old Client', phone: '98400 12345' }).expect(201)
      const blocked = await S.agent
        .post('/api/v1/events')
        .send({ clientId: client.body.id, title: 'New wedding', type: 'WEDDING', date: isoDaysFromToday(10), venue: 'Hall', city: 'Chennai' })
        .expect(402)
      expect(blocked.body.error.code).toBe('SUBSCRIPTION_READ_ONLY')
      // Reading still works.
      await S.agent.get('/api/v1/events').expect(200)
      await S.agent.get('/api/v1/subscription').expect(200)
    })

    it('never sends any alert twice across all those runs', async () => {
      const rows = await alertsFor(subId)
      expect(new Set(rows.map((r) => r.dedupeKey)).size).toBe(rows.length)
      expect(rows).toHaveLength(20)
      await jobs.run(at(7 * DAY + 5 * 3_600_000))
      expect(await alertsFor(subId)).toHaveLength(20)
    })

    it('lets an admin extend the deadline (note required), logged in the timeline and audit log', async () => {
      await admin.post(`/api/v1/admin/subscriptions/${subId}/extend`).send({ days: 10 }).expect(400)
      const res = await admin.post(`/api/v1/admin/subscriptions/${subId}/extend`).send({ days: 10, note: 'Paid by bank transfer' }).expect(200)
      expect(res.body.status).toBe('ACTIVE')
      expect(res.body.daysLeft).toBe(10)
      expect(res.body.events[0]).toMatchObject({ type: 'EXTENDED_BY_ADMIN', actorName: 'Priya Ops' })
      expect(res.body.events[0].note).toMatch(/^\+10 days .*: Paid by bank transfer$/)
      const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'subscription.extend', targetId: subId } })
      expect(audit.summary).toMatch(/Extended Pro by 10 day\(s\)/)
      // Writable again.
      expect((await S.agent.get('/api/v1/me/subscription').expect(200)).body.readOnly).toBe(false)
    })

    it('lets an admin change the plan, logged', async () => {
      const studioPlan = await prisma.plan.findUniqueOrThrow({ where: { code: 'STUDIO' } })
      await admin.post(`/api/v1/admin/subscriptions/${subId}/change-plan`).send({ planId: studioPlan.id, billingCycle: 'YEARLY', note: 'Goodwill upgrade' }).expect(200)
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subId }, include: { plan: true } })
      expect(sub).toMatchObject({ cycle: 'YEARLY', plan: { code: 'STUDIO' } })
      const ev = await prisma.subscriptionEvent.findFirstOrThrow({ where: { subscriptionId: subId, type: 'PLAN_CHANGED_BY_ADMIN' } })
      expect(ev).toMatchObject({ fromPlan: 'Pro (Monthly)', toPlan: 'Studio (Yearly)', note: 'Goodwill upgrade' })
      expect(await prisma.adminAuditLog.count({ where: { action: 'subscription.change_plan', targetId: subId } })).toBe(1)
    })

    it('sends a manual reminder on chosen channels and lists it on the detail page', async () => {
      const res = await admin.post(`/api/v1/admin/subscriptions/${subId}/remind`).send({ channels: ['IN_APP', 'EMAIL'] }).expect(200)
      expect(res.body.results).toEqual([
        { channel: 'IN_APP', delivered: true, skipped: false, error: null },
        { channel: 'EMAIL', delivered: true, skipped: false, error: null },
      ])
      const detail = await admin.get(`/api/v1/admin/subscriptions/${subId}`).expect(200)
      expect(detail.body.notifications[0]).toMatchObject({ type: 'SUBSCRIPTION_REMINDER' })
      expect(detail.body.usage.map((u: { key: string }) => u.key)).toEqual(['events', 'storage', 'albums', 'credits'])
      // WhatsApp credits are a prepaid balance, not a plan limit.
      const balance = (await prisma.studio.findUniqueOrThrow({ where: { id: S.studioId } })).creditBalance
      expect(detail.body.usage[3]).toMatchObject({ key: 'credits', label: 'WhatsApp credits used this month', used: 0, limit: null, remaining: balance })
    })

    it('lets an admin cancel: read-only at once, logged', async () => {
      await admin.post(`/api/v1/admin/subscriptions/${subId}/cancel`).send({ note: 'Chargeback' }).expect(200)
      expect((await S.agent.get('/api/v1/me/subscription').expect(200)).body).toMatchObject({ status: 'CANCELLED', readOnly: true })
      await admin.post(`/api/v1/admin/subscriptions/${subId}/cancel`).send({ note: 'again' }).expect(409)
      const cancelledTab = await admin.get('/api/v1/admin/subscriptions').query({ tab: 'cancelled' }).expect(200)
      expect(cancelledTab.body.data.map((r: { id: string }) => r.id)).toContain(subId)
    })
  })

  describe('no WhatsApp provider configured', () => {
    beforeAll(() => {
      whatsappOn = false
    })
    afterAll(() => {
      whatsappOn = true
    })

    it('does not attempt WhatsApp alerts, and says so in settings', async () => {
      const N = await signup(app, { plan: 'trial', studioName: 'No WhatsApp Studio' })
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { studioId: N.studioId } })
      const before = waSent.length
      await jobs.run(new Date(sub.currentPeriodEnd.getTime() - 7 * DAY))
      const rows = await alertsFor(sub.id)
      expect(rows.map((r) => r.channel)).toEqual(['IN_APP', 'EMAIL'])
      expect(waSent.length).toBe(before)
      expect((await admin.get('/api/v1/admin/settings/alerts').expect(200)).body.whatsappConfigured).toBe(false)
    })

    it('reports WhatsApp as skipped (not failed) on "Send reminder now"', async () => {
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { studioId: A.studioId } })
      const res = await admin.post(`/api/v1/admin/subscriptions/${sub.id}/remind`).send({ channels: ['IN_APP', 'WHATSAPP'] }).expect(200)
      expect(res.body.results).toEqual([
        { channel: 'IN_APP', delivered: true, skipped: false, error: null },
        { channel: 'WHATSAPP', delivered: false, skipped: true, error: 'Skipped – not configured' },
      ])
      expect(await prisma.notification.count({ where: { subscriptionId: sub.id, channel: 'WHATSAPP', type: 'SUBSCRIPTION_REMINDER' } })).toBe(0)
      const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'subscription.remind', targetId: sub.id }, orderBy: { createdAt: 'desc' } })
      expect(audit.summary).toBe('Sent a plan reminder: IN_APP, WHATSAPP (skipped)')
    })
  })

  describe('grace rows', () => {
    it('list "Grace ends" for plans in grace even before the job has saved it', async () => {
      const G = await signup(app, { plan: 'trial', studioName: 'Grace Row Studio' })
      const end = new Date(Date.now() - 26 * 3_600_000)
      await prisma.subscription.update({
        where: { studioId: G.studioId },
        data: { isTrial: false, status: 'ACTIVE', currentPeriodEnd: end, currentPeriodStart: addDays(end, -30), graceEndsAt: null },
      })
      await jobs.refreshStatuses(new Date(), true)
      const list = await admin.get('/api/v1/admin/subscriptions').query({ tab: 'grace', search: 'Grace Row' }).expect(200)
      expect(list.body.data).toHaveLength(1)
      expect(list.body.data[0]).toMatchObject({ status: 'GRACE', graceEndsAt: new Date(end.getTime() + 7 * DAY).toISOString(), tone: 'red' })
      expect(list.body.data[0].daysLeft).toBeLessThan(0)
      const csv = await admin.get('/api/v1/admin/subscriptions/export.csv').query({ tab: 'grace', search: 'Grace Row' }).expect(200)
      expect(csv.text).toMatch(/Grace ends \(IST\)/)
      expect(csv.text).toMatch(/,GRACE,\d{4}-\d{2}-\d{2} \d{2}:\d{2},/)
    })
  })

  describe('GST invoices for every paid plan payment', () => {
    /** Runs the backfill migration's SQL exactly as `prisma migrate deploy` would. */
    async function runBackfill() {
      const file = join(__dirname, '../prisma/migrations/20261003090000_backfill_platform_invoices/migration.sql')
      const sql = readFileSync(file, 'utf8').replace(/^--.*$/gm, '')
      for (const stmt of sql.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(stmt)
    }

    it('backfills old payments per financial year (IST), continues the series, and is safe to re-run', async () => {
      const I = await signup(app, { plan: 'trial', studioName: 'Invoice Backfill Studio' })
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { studioId: I.studioId } })
      const pay = (paidAt: string, invoiceNumber: string | null = null, status: 'SUCCESS' | 'FAILED' = 'SUCCESS') =>
        prisma.payment.create({
          data: {
            studioId: I.studioId,
            purpose: 'SUBSCRIPTION',
            description: 'Pro plan · Monthly',
            amount: 294_882,
            gst: 44_982,
            status,
            provider: 'mock',
            subscriptionId: sub.id,
            cycle: 'MONTHLY',
            paidAt: new Date(paidAt),
            createdAt: new Date(paidAt),
            invoiceNumber,
          },
        })
      await pay('2025-05-10T06:00:00Z', 'WZ/2025-26/00007') // already numbered in FY 2025-26
      const a = await pay('2025-06-15T06:00:00Z')
      const b = await pay('2026-03-31T14:30:00Z') // 31 Mar 20:00 IST: still FY 2025-26
      const c = await pay('2026-03-31T19:00:00Z') // 1 Apr 00:30 IST: FY 2026-27
      const failed = await pay('2025-07-01T06:00:00Z', null, 'FAILED')
      const fy26 = await prisma.payment.findMany({ where: { invoiceNumber: { startsWith: 'WZ/2026-27/' } } })
      const lastFy26 = Math.max(0, ...fy26.map((p) => Number(p.invoiceNumber!.slice(-5))))

      await runBackfill()
      const num = async (id: string) => (await prisma.payment.findUniqueOrThrow({ where: { id } })).invoiceNumber
      expect(await num(a.id)).toBe('WZ/2025-26/00008')
      expect(await num(b.id)).toBe('WZ/2025-26/00009')
      expect(await num(c.id)).toBe(`WZ/2026-27/${String(lastFy26 + 1).padStart(5, '0')}`)
      expect(await num(failed.id)).toBeNull()
      expect((await prisma.platformCounter.findUniqueOrThrow({ where: { key: 'invoice:2025' } })).value).toBe(9)
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: a.id } })).periodEnd).not.toBeNull()

      await runBackfill()
      expect(await num(a.id)).toBe('WZ/2025-26/00008')
      expect((await prisma.platformCounter.findUniqueOrThrow({ where: { key: 'invoice:2025' } })).value).toBe(9)
      // No paid plan payment is left without a number.
      expect(await prisma.payment.count({ where: { purpose: 'SUBSCRIPTION', status: 'SUCCESS', invoiceNumber: null } })).toBe(0)

      // The next real purchase in FY 2026-27 continues the series after the backfilled one.
      const order = await pendingOrder(I.studioId, 'PRO', 'MONTHLY')
      await hook(captured(order.gatewayOrderId!, order.amount)).expect(200)
      expect(await num(order.id)).toBe(`WZ/2026-27/${String(lastFy26 + 2).padStart(5, '0')}`)
    })

    it('serves the printable invoice to admins (any studio) and to the paying studio only', async () => {
      const p = await prisma.payment.findFirstOrThrow({ where: { studioId: A.studioId, purpose: 'SUBSCRIPTION', status: 'SUCCESS' } })
      const res = await admin.get(`/api/v1/admin/payments/${p.id}/invoice`).expect(200)
      expect(res.body).toMatchObject({ number: p.invoiceNumber, totalPaise: p.amount, taxablePaise: p.amount - p.gst, sac: '998314' })
      await A.agent.get(`/api/v1/subscription/payments/${p.id}/invoice`).expect(200)
      await A.agent.get(`/api/v1/admin/payments/${p.id}/invoice`).expect(403)
      const other = await signup(app, { plan: 'trial' })
      await other.agent.get(`/api/v1/subscription/payments/${p.id}/invoice`).expect(404)
      const detail = await admin.get(`/api/v1/admin/subscriptions/${p.subscriptionId}`).expect(200)
      const unnumbered = detail.body.payments.filter((x: { status: string; invoiceNumber: string | null }) => x.status === 'SUCCESS' && !x.invoiceNumber)
      expect(unnumbered).toHaveLength(0)
    })
  })

  describe('auto-renew (test-mode gateway)', () => {
    it('skips expiry reminders and renews at the deadline with "Renewed successfully"', async () => {
      const R = await signup(app, { plan: 'trial', studioName: 'AutoRenew Studio' })
      await R.agent.post('/api/v1/subscription/change').send({ planCode: 'PRO', cycle: 'MONTHLY' }).expect(200)
      await R.agent.post('/api/v1/subscription/auto-renew').send({ autoRenew: true }).expect(200)
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { studioId: R.studioId } })
      expect(sub.gatewaySubscriptionId).toMatch(/^sub_mock_/)
      const end = sub.currentPeriodEnd

      await jobs.run(new Date(end.getTime() - 7 * DAY))
      await jobs.run(new Date(end.getTime() - 1 * DAY))
      expect(await prisma.notification.count({ where: { subscriptionId: sub.id, type: 'SUBSCRIPTION_REMINDER' } })).toBe(0)

      await jobs.run(new Date(end.getTime() + 60_000))
      await jobs.run(new Date(end.getTime() + 120_000)) // a second run renews nothing more
      const renewed = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })
      const e = istParts(renewed.currentPeriodEnd)
      const before = istParts(end)
      expect((e.year * 12 + e.month) - (before.year * 12 + before.month)).toBe(1)
      expect(await prisma.payment.count({ where: { subscriptionId: sub.id, status: 'SUCCESS' } })).toBe(2)
      const msg = await prisma.notification.findFirstOrThrow({ where: { studioId: R.studioId, type: 'SUBSCRIPTION_RENEWED', channel: 'IN_APP' } })
      expect(msg.title).toBe('Renewed successfully')
      expect(await prisma.notification.count({ where: { subscriptionId: sub.id, type: 'SUBSCRIPTION_GRACE' } })).toBe(0)
    })
  })

  describe('win-back coupon', () => {
    it('is sent once a week after expiry and gives the discount at checkout', async () => {
      const W = await signup(app, { plan: 'trial', studioName: 'Winback Studio' })
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { studioId: W.studioId } })
      const end = addDays(new Date(), -20)
      await prisma.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: end, currentPeriodStart: addDays(end, -30), status: 'EXPIRED', graceEndsAt: addDays(end, 3) } })
      await jobs.run()
      await jobs.run()
      const coupons = await prisma.coupon.findMany({ where: { subscriptionId: sub.id } })
      expect(coupons).toHaveLength(1)
      expect(coupons[0].percentOff).toBe(20)
      const res = await W.agent.post('/api/v1/subscription/change').send({ planCode: 'PRO', cycle: 'MONTHLY', couponCode: coupons[0].code.toLowerCase() }).expect(200)
      // ₹1,999 − 20% = ₹1,599.20, + 18% GST
      expect(res.body.payment.amountPaise).toBe(159_920 + Math.round(159_920 * 0.18))
      await W.agent.post('/api/v1/subscription/change').send({ planCode: 'ALL_ACCESS', cycle: 'MONTHLY', couponCode: coupons[0].code }).expect(400)
    })
  })

  describe('daily digest, usage alerts, stats, CSV', () => {
    it('emails the admin digest once a day after the digest time (IST)', async () => {
      mails.length = 0
      // A day no other test has run the job on.
      const p = istParts(addDays(new Date(), 400))
      const before = fromIst({ year: p.year, month: p.month, day: p.day, hour: 8, minute: 59 })
      const after = fromIst({ year: p.year, month: p.month, day: p.day, hour: 9, minute: 1 })
      expect((await jobs.run(before)).digest).toBe(false)
      expect((await jobs.run(after)).digest).toBe(true)
      expect((await jobs.run(new Date(after.getTime() + 3_600_000))).digest).toBe(false)
      const digest = mails.filter((m) => m.subject.startsWith('Weddyzone digest'))
      expect(digest).toHaveLength(1)
      expect(digest[0].to).toBe(adminEmail)
      expect(digest[0].text).toContain('Expiring in the next 7 days')
      expect(digest[0].text).toContain('Failed payments yesterday')
    })

    it('alerts the admin once when a studio passes 80% of its monthly events', async () => {
      const U = await signup(app, { plan: 'PRO', studioName: 'Busy Studio' })
      for (let i = 0; i < 8; i++) {
        await U.agent.post('/api/v1/selections/details').send({ customerName: `Client ${i}`, customerPhone: '98400 12345', eventName: `Event ${i}`, quota: 5 }).expect(201)
      }
      await jobs.run()
      await jobs.run()
      const alerts = await prisma.notification.findMany({ where: { recipientType: 'ADMIN', type: 'USAGE_HIGH', title: { startsWith: 'Busy Studio' } } })
      expect(alerts).toHaveLength(1)
      expect(alerts[0].title).toBe('Busy Studio used 80% of events this month')
      expect(alerts[0].body).toBe('8 of 10 on Pro · upsell opportunity')
    })

    it('returns dashboard stats', async () => {
      const res = await admin.get('/api/v1/admin/stats').expect(200)
      expect(res.body.mrrPaise).toBeGreaterThan(0)
      expect(res.body.arrPaise).toBe(res.body.mrrPaise * 12)
      expect(res.body.mrrTrend).toHaveLength(12)
      expect(res.body.newVsChurned).toHaveLength(12)
      expect(res.body.activeByPlan.map((p: { code: string }) => p.code)).toEqual(['STARTER', 'PRO', 'ALL_ACCESS', 'STUDIO'])
      expect(res.body.newThisMonth).toBeGreaterThanOrEqual(2)
      // The MRR card and the trend's current month are the same calculation.
      expect(res.body.mrrTrend.at(-1).mrrPaise).toBe(res.body.mrrPaise)
    })

    it('counts "needs attention" once per subscription and lists exactly those', async () => {
      const stats = (await admin.get('/api/v1/admin/stats').expect(200)).body
      const tab = await admin.get('/api/v1/admin/subscriptions').query({ tab: 'attention', limit: 100 }).expect(200)
      expect(tab.body.meta.total).toBe(stats.needsAttention)
      expect(stats.needsAttention).toBeGreaterThan(0)
      for (const r of tab.body.data as { status: string; daysLeft: number; cancelAtPeriodEnd: boolean }[]) {
        expect(r.status === 'GRACE' || r.status === 'PAYMENT_FAILED' || (r.daysLeft >= 0 && r.daysLeft <= 7 && !r.cancelAtPeriodEnd)).toBe(true)
      }
      // A plan that is in grace and also failed to charge appears once.
      const ids = tab.body.data.map((r: { id: string }) => r.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('exports CSV (formula-safe), sorted by soonest deadline', async () => {
      await prisma.studio.update({ where: { id: A.studioId }, data: { name: '=HYPERLINK("x")' } })
      const res = await admin.get('/api/v1/admin/subscriptions/export.csv').expect(200)
      expect(res.headers['content-type']).toMatch(/text\/csv/)
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="subscriptions-/)
      const lines = res.text.replace(/^﻿/, '').trim().split('\r\n')
      expect(lines[0]).toMatch(/^Studio,Owner,Email,Phone,Plan,Cycle/)
      expect(res.text).toContain(`"'=HYPERLINK(""x"")"`)
      const deadlines = lines.slice(1).map((l) => l.match(/,(\d{4}-\d{2}-\d{2}),(-?\d+),/)?.[1] ?? '')
      expect([...deadlines].sort()).toEqual(deadlines)
      await prisma.studio.update({ where: { id: A.studioId }, data: { name: 'StudioRed' } })
    })

    it('validates and saves alert settings', async () => {
      const bad = await admin.put('/api/v1/admin/settings/alerts').send({ reminderDays: [], graceDays: -1, digestTime: '9am', winbackAfterDays: null, winbackPercentOff: 20 }).expect(400)
      expect(Object.keys(bad.body.error.fields).sort()).toEqual(['digestTime', 'graceDays', 'reminderDays'])
      const ok = await admin.put('/api/v1/admin/settings/alerts').send({ reminderDays: [3, 14, 3], graceDays: 5, digestTime: '08:30', winbackAfterDays: null, winbackPercentOff: 15 }).expect(200)
      expect(ok.body).toMatchObject({ reminderDays: [14, 3], graceDays: 5, digestTime: '08:30', winbackAfterDays: null })
      expect((await admin.get('/api/v1/admin/settings/alerts').expect(200)).body.graceDays).toBe(5)
      await admin.put('/api/v1/admin/settings/alerts').send({ reminderDays: [7, 3, 1], graceDays: 3, digestTime: '09:00', winbackAfterDays: 7, winbackPercentOff: 20 }).expect(200)
    })
  })

  describe('two-factor sign-in for admins', () => {
    it('is optional, and once on the password alone no longer signs in', async () => {
      const setup = await admin.post('/api/v1/admin/2fa/setup').expect(200)
      expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//)
      await admin.post('/api/v1/admin/2fa/enable').send({ code: '000000' }).expect(400)
      await admin.post('/api/v1/admin/2fa/enable').send({ code: totpAt(setup.body.secret) }).expect(200)
      const stored = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })
      expect(stored.totpSecret).not.toContain(setup.body.secret) // encrypted at rest

      const fresh = request.agent(app.getHttpServer())
      const noCode = await fresh.post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword }).expect(401)
      expect(noCode.body.error.code).toBe('OTP_REQUIRED')
      await fresh.post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword, otp: '123456' }).expect(401)
      await fresh.post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword, otp: totpAt(setup.body.secret) }).expect(200)
      await fresh.get('/api/v1/admin/stats').expect(200)

      await admin.post('/api/v1/admin/2fa/disable').send({ code: totpAt(setup.body.secret) }).expect(200)
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword }).expect(200)
    })
  })
})
