import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import { SubscriptionsService } from '../src/billing/subscriptions.service'
import { createTestApp, resetDb, setStudioState, signup, type SignedUp } from './helpers'

describe('Phase 3 — plans, credits, invoices', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let A: SignedUp
  let B: SignedUp
  let clientTN: string
  let clientKA: string

  const item = (rate: number, gstRate = 18, qty = 1) => ({ description: 'Wedding coverage', sac: '998386', qty, rate, gstRate })
  const invoice = (s: SignedUp, extra: Record<string, unknown> = {}) =>
    s.agent.post('/api/v1/invoices').send({
      clientId: clientTN,
      issueDate: '2026-09-01',
      dueDate: '2026-09-15',
      placeOfSupply: '33',
      items: [item(100000)],
      ...extra,
    })

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp())
    await resetDb(prisma)
    A = await signup(app)
    B = await signup(app)
    await setStudioState(prisma, A.studioId, '33')
    clientTN = (await A.agent.post('/api/v1/clients').send({ name: 'Priya Raman', phone: '9840012345', stateCode: '33' }).expect(201)).body.id
    clientKA = (await A.agent.post('/api/v1/clients').send({ name: 'Ananya Iyer', phone: '9845012345', stateCode: '29' }).expect(201)).body.id
  })
  afterAll(() => app.close())

  describe('invoices', () => {
    it('requires the studio state before invoicing', async () => {
      const C = await signup(app)
      const client = (await C.agent.post('/api/v1/clients').send({ name: 'X Client', phone: '9840012345' }).expect(201)).body.id
      const res = await C.agent
        .post('/api/v1/invoices')
        .send({ clientId: client, issueDate: '2026-09-01', dueDate: '2026-09-15', placeOfSupply: '33', items: [item(1000)] })
        .expect(400)
      expect(res.body.error.message).toMatch(/state in My Profile/)
    })

    it('uses CGST + SGST within the state and IGST across states', async () => {
      const intra = (await invoice(A).expect(201)).body
      expect(intra).toMatchObject({ supplyType: 'INTRA', subtotalPaise: 10_000_000, cgstPaise: 900_000, sgstPaise: 900_000, igstPaise: 0, totalPaise: 11_800_000 })
      const inter = (await invoice(A, { clientId: clientKA, placeOfSupply: '29', items: [item(50000), item(12500.5, 5, 2)] }).expect(201)).body
      expect(inter).toMatchObject({ supplyType: 'INTER', cgstPaise: 0, sgstPaise: 0, igstPaise: 900_000 + 125_005, totalPaise: 7_500_100 + 1_025_005 })
    })

    it('numbers invoices sequentially per financial year, without gaps or duplicates', async () => {
      const C = await signup(app)
      await setStudioState(prisma, C.studioId, '33')
      const client = (await C.agent.post('/api/v1/clients').send({ name: 'Numbering Client', phone: '9840012345' }).expect(201)).body.id
      const make = (issueDate: string) =>
        C.agent.post('/api/v1/invoices').send({ clientId: client, issueDate, dueDate: issueDate, placeOfSupply: '33', items: [item(1000)] })

      // Five at once: the counter row lock gives 1..5 exactly once each.
      const parallel = await Promise.all(Array.from({ length: 5 }, () => make('2026-06-10')))
      const numbers = parallel.map((r) => r.body.number).sort()
      expect(numbers).toEqual(['INV-2026-0001', 'INV-2026-0002', 'INV-2026-0003', 'INV-2026-0004', 'INV-2026-0005'])

      // 31 March belongs to FY 2025-26; 1 April starts FY 2026-27's series again.
      expect((await make('2026-03-31').expect(201)).body.number).toBe('INV-2025-0001')
      expect((await make('2027-04-01').expect(201)).body.number).toBe('INV-2027-0001')
      expect((await make('2027-03-31').expect(201)).body.number).toBe('INV-2026-0006')
    })

    it('validates dates, line items and milestones', async () => {
      const res = await invoice(A, { dueDate: '2026-08-01', items: [{ description: '', sac: '12', qty: 0, rate: 10.123, gstRate: 7 }] }).expect(400)
      expect(res.body.error.fields).toMatchObject({
        dueDate: 'Due date must be on or after the issue date',
        'items.0.description': 'Description is required',
        'items.0.sac': 'SAC must be 4–8 digits',
        'items.0.qty': 'Quantity must be at least 1',
        'items.0.rate': 'Use at most 2 decimal places',
        'items.0.gstRate': 'Select a GST rate',
      })
      const badMilestones = await invoice(A, { milestones: [{ label: 'Advance', amount: 50000, dueDate: '2026-09-02' }] }).expect(400)
      expect(badMilestones.body.error.fields.milestones).toMatch(/invoice total is ₹1,18,000/)
    })

    it('records payments, settles milestones in order and marks the invoice paid', async () => {
      const inv = (
        await invoice(A, {
          milestones: [
            { label: 'Advance', amount: 35400, dueDate: '2026-09-02' },
            { label: 'Final', amount: 82600, dueDate: '2026-09-15' },
          ],
        }).expect(201)
      ).body
      const tooMuch = await A.agent.post(`/api/v1/invoices/${inv.id}/payments`).send({ amount: 200000, method: 'UPI', paidOn: '2026-09-02' }).expect(400)
      expect(tooMuch.body.error.fields.amount).toMatch(/balance due is ₹1,18,000/)

      const part = await A.agent.post(`/api/v1/invoices/${inv.id}/payments`).send({ amount: 35400, method: 'UPI', paidOn: '2026-09-02', reference: 'UPI123' }).expect(201)
      expect(part.body).toMatchObject({ amountPaidPaise: 3_540_000, balancePaise: 8_260_000 })
      let detail = await A.agent.get(`/api/v1/invoices/${inv.id}`).expect(200)
      expect(detail.body.milestones.map((m: { paidAt: string | null }) => Boolean(m.paidAt))).toEqual([true, false])

      const paid = await A.agent.post(`/api/v1/invoices/${inv.id}/mark-paid`).send({ method: 'CASH' }).expect(200)
      expect(paid.body).toMatchObject({ status: 'PAID', balancePaise: 0 })
      detail = await A.agent.get(`/api/v1/invoices/${inv.id}`).expect(200)
      expect(detail.body.payments).toHaveLength(2)
      expect(detail.body.milestones.every((m: { paidAt: string | null }) => m.paidAt)).toBe(true)
      expect(await prisma.notification.count({ where: { studioId: A.studioId, type: 'INVOICE_PAID' } })).toBe(1)
      await A.agent.post(`/api/v1/invoices/${inv.id}/cancel`).expect(409)
    })

    it('derives OVERDUE and filters by tab', async () => {
      const overdue = (await invoice(A, { issueDate: '2025-01-01', dueDate: '2025-01-15' }).expect(201)).body
      expect(overdue.status).toBe('OVERDUE')
      const tab = await A.agent.get('/api/v1/invoices').query({ status: 'OVERDUE' }).expect(200)
      expect(tab.body.data.map((i: { id: string }) => i.id)).toContain(overdue.id)
      const pending = await A.agent.get('/api/v1/invoices').query({ status: 'PENDING' }).expect(200)
      expect(pending.body.data.map((i: { id: string }) => i.id)).not.toContain(overdue.id)
      const summary = await A.agent.get('/api/v1/invoices/summary').expect(200)
      expect(summary.body.counts.overdue).toBeGreaterThanOrEqual(1)
      expect(summary.body.overduePaise).toBeGreaterThanOrEqual(overdue.totalPaise)
    })

    it('cancels unpaid invoices and keeps the number', async () => {
      const inv = (await invoice(A).expect(201)).body
      const res = await A.agent.post(`/api/v1/invoices/${inv.id}/cancel`).expect(200)
      expect(res.body).toMatchObject({ status: 'CANCELLED', number: inv.number, balancePaise: 0 })
    })

    it('sends invoices on WhatsApp for one credit', async () => {
      const inv = (await invoice(A).expect(201)).body
      const res = await A.agent.post(`/api/v1/invoices/${inv.id}/send`).expect(200)
      expect(decodeURIComponent(res.body.waLink)).toContain(inv.number)
      expect(res.body.message.templateKey).toBe('INVOICE_SEND')
    })

    it("keeps invoices private to the studio", async () => {
      const inv = (await invoice(A).expect(201)).body
      await B.agent.get(`/api/v1/invoices/${inv.id}`).expect(404)
      await B.agent.post(`/api/v1/invoices/${inv.id}/payments`).send({ amount: 1, method: 'UPI', paidOn: '2026-09-02' }).expect(404)
      await B.agent.post(`/api/v1/invoices/${inv.id}/cancel`).expect(404)
      await setStudioState(prisma, B.studioId, '33')
      const foreignClient = await B.agent
        .post('/api/v1/invoices')
        .send({ clientId: clientTN, issueDate: '2026-09-01', dueDate: '2026-09-15', placeOfSupply: '33', items: [item(1000)] })
        .expect(400)
      expect(foreignClient.body.error.fields.clientId).toBeDefined()
      const list = await B.agent.get('/api/v1/invoices').expect(200)
      expect(list.body.meta.total).toBe(0)
    })
  })

  describe('WhatsApp credits', () => {
    it('buys a pack through the mock payment service and logs it in the ledger', async () => {
      const before = (await A.agent.get('/api/v1/credits').expect(200)).body.balance
      const res = await A.agent.post('/api/v1/credits/purchase').send({ packCode: 'PACK_2000' }).expect(200)
      expect(res.body).toMatchObject({ creditBalance: before + 2000, testMode: true })
      expect(res.body.payment).toMatchObject({ purpose: 'CREDIT_PACK', amountPaise: 139_900, status: 'SUCCESS', provider: 'mock' })
      const ledger = await prisma.creditLedger.findFirst({ where: { studioId: A.studioId, reason: 'PURCHASE' } })
      expect(ledger).toMatchObject({ delta: 2000, balanceAfter: before + 2000 })
      await A.agent.post('/api/v1/credits/purchase').send({ packCode: 'PACK_9' }).expect(400)
    })

    it('lists the message log with filters and pagination', async () => {
      const all = await A.agent.get('/api/v1/credits/messages').query({ limit: 1 }).expect(200)
      expect(all.body.meta.total).toBeGreaterThanOrEqual(1)
      expect(all.body.data).toHaveLength(1)
      const invoiceOnly = await A.agent.get('/api/v1/credits/messages').query({ type: 'INVOICE_SEND' }).expect(200)
      expect(invoiceOnly.body.data.every((m: { templateKey: string }) => m.templateKey === 'INVOICE_SEND')).toBe(true)
      const other = await B.agent.get('/api/v1/credits/messages').expect(200)
      expect(other.body.meta.total).toBe(0)
    })
  })

  describe('plans & subscriptions', () => {
    it('lists plans from the database', async () => {
      const res = await A.agent.get('/api/v1/plans').expect(200)
      expect(res.body.map((p: { code: string }) => p.code)).toEqual(['STARTER', 'PRO', 'STUDIO', 'ALL_ACCESS'])
    })

    it('upgrades immediately, grants included credits and records the payment', async () => {
      const before = (await A.agent.get('/api/v1/credits').expect(200)).body.balance
      const res = await A.agent.post('/api/v1/subscription/change').send({ planCode: 'STUDIO', cycle: 'YEARLY' }).expect(200)
      expect(res.body.subscription).toMatchObject({ plan: { code: 'STUDIO' }, cycle: 'YEARLY', isTrial: false, status: 'ACTIVE', pricePaise: 5_999_000 })
      expect(res.body.payment).toMatchObject({ purpose: 'SUBSCRIPTION', amountPaise: 5_999_000 })
      expect((await A.agent.get('/api/v1/credits').expect(200)).body.balance).toBe(before + 1000)
      await A.agent.post('/api/v1/subscription/change').send({ planCode: 'STUDIO', cycle: 'YEARLY' }).expect(409)
    })

    it('rejects monthly billing for All-Access', async () => {
      const res = await A.agent.post('/api/v1/subscription/change').send({ planCode: 'ALL_ACCESS', cycle: 'MONTHLY' }).expect(400)
      expect(res.body.error.fields.cycle).toMatch(/yearly/)
    })

    it('cancels at period end and resumes', async () => {
      const cancelled = await A.agent.post('/api/v1/subscription/cancel').expect(200)
      expect(cancelled.body.subscription).toMatchObject({ cancelAtPeriodEnd: true, status: 'CANCELLED', plan: { code: 'STUDIO' } })
      await A.agent.post('/api/v1/subscription/cancel').expect(409)
      const resumed = await A.agent.post('/api/v1/subscription/resume').expect(200)
      expect(resumed.body.subscription).toMatchObject({ cancelAtPeriodEnd: false, status: 'ACTIVE' })
    })

    it('falls back to Starter once a cancelled period has ended (derived on read)', async () => {
      await A.agent.post('/api/v1/subscription/cancel').expect(200)
      await prisma.subscription.update({ where: { studioId: A.studioId }, data: { currentPeriodEnd: new Date('2020-01-01') } })
      const res = await A.agent.get('/api/v1/subscription').expect(200)
      expect(res.body.subscription.plan.code).toBe('STARTER')
      const me = await A.agent.get('/api/v1/auth/me').expect(200)
      expect(me.body.studio.plan.code).toBe('STARTER')
    })

    it('reports usage from real counts', async () => {
      const res = await B.agent.get('/api/v1/subscription').expect(200)
      const keys = res.body.usage.map((u: { key: string }) => u.key)
      expect(keys).toEqual(['events', 'albums', 'storage', 'credits'])
      expect(res.body.usage[0]).toMatchObject({ used: 0, limit: 10 })
    })
  })

  describe('referral reward', () => {
    it('pays ₹1,500 to both studios on the first upgrade, exactly once', async () => {
      const referrer = await signup(app)
      const code = (await prisma.studio.findUniqueOrThrow({ where: { id: referrer.studioId } })).referralCode
      const friend = await signup(app, { referralCode: code })

      await friend.agent.post('/api/v1/subscription/change').send({ planCode: 'PRO', cycle: 'MONTHLY' }).expect(200)
      await friend.agent.post('/api/v1/subscription/change').send({ planCode: 'STUDIO', cycle: 'MONTHLY' }).expect(200)
      // Calling the reward again directly is a no-op too.
      const subs = app.get(SubscriptionsService)
      await prisma.$transaction((tx) => subs.rewardReferral(tx, friend.studioId))

      const [r, f] = await Promise.all([
        prisma.studio.findUniqueOrThrow({ where: { id: referrer.studioId } }),
        prisma.studio.findUniqueOrThrow({ where: { id: friend.studioId } }),
      ])
      expect(r.walletBalance).toBe(150_000)
      expect(f.walletBalance).toBe(150_000)
      expect(await prisma.walletTxn.count({ where: { studioId: referrer.studioId } })).toBe(1)
      const referral = await prisma.referral.findUniqueOrThrow({ where: { referredStudioId: friend.studioId } })
      expect(referral.status).toBe('REWARDED')
    })

    it('does not reward studios that were not referred', async () => {
      const C = await signup(app)
      await C.agent.post('/api/v1/subscription/change').send({ planCode: 'PRO', cycle: 'MONTHLY' }).expect(200)
      expect((await prisma.studio.findUniqueOrThrow({ where: { id: C.studioId } })).walletBalance).toBe(0)
    })
  })
})
