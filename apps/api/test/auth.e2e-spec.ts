import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'
import request from 'supertest'
import { emailFailed } from '../src/common/errors'
import type { MailService } from '../src/infra/mail.service'
import { createTestApp, expectError, pngBuffer, resetDb, signup } from './helpers'

describe('Auth & profile', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let mail: MailService

  beforeAll(async () => {
    ;({ app, prisma, mail } = await createTestApp())
    await resetDb(prisma)
  })
  afterAll(() => app.close())

  describe('signup', () => {
    it('creates a studio on a Trial (free until 31 Dec 2026) with bonus credits and logs in', async () => {
      const { agent, studioId } = await signup(app, { plan: 'trial' })
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { studioId } })
      expect(sub).toMatchObject({ isTrial: true, status: 'TRIAL' })
      expect(sub.currentPeriodEnd.toISOString()).toBe('2026-12-31T18:29:59.000Z')
      const me = await agent.get('/api/v1/auth/me').expect(200)
      expect(me.body.user.role).toBe('OWNER')
      expect(me.body.studio.plan.code).toBe('STARTER')
      expect(me.body.studio.creditBalance).toBe(50)
      expect(me.body.studio.phone).toBe('+919876543210')
      expect(me.body.features).toEqual({ faceRecognition: false })
      const ledger = await prisma.creditLedger.findMany({ where: { studioId } })
      expect(ledger).toHaveLength(1)
      expect(ledger[0]).toMatchObject({ delta: 50, balanceAfter: 50, reason: 'SIGNUP_BONUS' })
      expect(await prisma.websiteSettings.count({ where: { studioId } })).toBe(1)
    })

    it('returns field errors for invalid input', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ studioName: 'X', ownerName: '', email: 'nope', phone: '12345', password: 'short' })
        .expect(400)
      expectError(res.body, 'VALIDATION_ERROR')
      expect(Object.keys(res.body.error.fields).sort()).toEqual(['email', 'ownerName', 'password', 'phone', 'studioName'])
    })

    it('rejects a duplicate email with a field error', async () => {
      const first = await signup(app)
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ studioName: 'Another', ownerName: 'Someone', email: first.email.toUpperCase(), phone: '9876543210', password: 'Secret123' })
        .expect(409)
      expect(res.body.error.fields.email).toMatch(/already registered/)
    })

    it('rejects an unknown referral code and records a known one', async () => {
      const bad = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ studioName: 'Ref Studio', ownerName: 'Ref Owner', email: 'ref1@example.com', phone: '9876543210', password: 'Secret123', referralCode: 'NOPE1234' })
        .expect(400)
      expect(bad.body.error.fields.referralCode).toBeDefined()

      const referrer = await signup(app)
      const code = (await prisma.studio.findUniqueOrThrow({ where: { id: referrer.studioId } })).referralCode
      const referred = await signup(app, { referralCode: code.toLowerCase() })
      const referral = await prisma.referral.findUniqueOrThrow({ where: { referredStudioId: referred.studioId } })
      expect(referral).toMatchObject({ referrerStudioId: referrer.studioId, status: 'PENDING', rewardAmount: 150000 })
    })
  })

  describe('login, session and logout', () => {
    it('logs in with the right password only', async () => {
      const { email, password } = await signup(app)
      const wrong = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'Wrong1234' }).expect(401)
      expectError(wrong.body, 'INVALID_CREDENTIALS')
      const unknown = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password }).expect(401)
      expectError(unknown.body, 'INVALID_CREDENTIALS')

      const agent = request.agent(app.getHttpServer())
      const ok = await agent.post('/api/v1/auth/login').send({ email: ` ${email.toUpperCase()} `, password }).expect(200)
      expect(String(ok.headers['set-cookie'])).toMatch(/wz_at=.*HttpOnly/)
      await agent.get('/api/v1/auth/me').expect(200)
    })

    it('requires authentication on studio routes', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/studio/profile').expect(401)
      expectError(res.body, 'UNAUTHENTICATED')
    })

    it('reports an expired access token as TOKEN_EXPIRED', async () => {
      const { userId, studioId } = await signup(app)
      const jwt = new JwtService()
      const expired = jwt.sign(
        { sub: userId, sid: studioId, role: 'OWNER', exp: Math.floor(Date.now() / 1000) - 10 },
        { secret: process.env.JWT_ACCESS_SECRET },
      )
      const res = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `wz_at=${expired}`).expect(401)
      expectError(res.body, 'TOKEN_EXPIRED')
    })

    describe('refresh token rotation', () => {
      const cookie = (res: request.Response, name: string) =>
        (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${name}=`))!.split(';')[0]
      const hashOf = (rt: string) => createHash('sha256').update(rt.slice('wz_rt='.length)).digest('hex')
      const login = async () => {
        const { email, password, userId } = await signup(app)
        const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password }).expect(200)
        return { email, password, userId, rt: cookie(res, 'wz_rt') }
      }
      const refresh = (rt: string) => request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', rt)
      const me = (at: string) => request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', at)

      it('rotates the refresh token: a new pair each time, in the same login', async () => {
        const { rt } = await login()
        const rotated = await refresh(rt).expect(200)
        expect(cookie(rotated, 'wz_rt')).not.toBe(rt)
        await me(cookie(rotated, 'wz_at')).expect(200)
        const [before, after] = await Promise.all([hashOf(rt), hashOf(cookie(rotated, 'wz_rt'))].map((h) => prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: h } })))
        expect(after.familyId).toBe(before.familyId)
        expect(before).toMatchObject({ replacedById: after.id })
        expect(before.rotatedAt).not.toBeNull()
      })

      it('two parallel refreshes with the same cookie both succeed and the session stays alive', async () => {
        const { rt } = await login()
        const [a, b] = await Promise.all([refresh(rt), refresh(rt)])
        expect([a.status, b.status]).toEqual([200, 200])
        // Whichever response the browser keeps, its cookies work.
        for (const res of [a, b]) {
          await me(cookie(res, 'wz_at')).expect(200)
          await refresh(cookie(res, 'wz_rt')).expect(200)
        }
      })

      it('a token sent again within 60 s (a retry, a second tab) gets a fresh pair; no one is logged out', async () => {
        const { rt, userId } = await login()
        const first = await refresh(rt).expect(200)
        const again = await refresh(rt).expect(200)
        await me(cookie(again, 'wz_at')).expect(200)
        await refresh(cookie(first, 'wz_rt')).expect(200)
        expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBeGreaterThan(0)
      })

      it('a rotated token replayed after 60 s is treated as stolen: 401 and that login is revoked, other logins kept', async () => {
        const { rt, email, password, userId } = await login()
        const next = cookie(await refresh(rt).expect(200), 'wz_rt')
        // A second login of the same user (another device).
        const other = cookie(await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password }).expect(200), 'wz_rt')
        await prisma.refreshToken.updateMany({ where: { tokenHash: hashOf(rt) }, data: { rotatedAt: new Date(Date.now() - 61_000) } })

        expectError((await refresh(rt).expect(401)).body, 'TOKEN_EXPIRED')
        const family = (await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashOf(rt) } })).familyId
        expect(await prisma.refreshToken.count({ where: { familyId: family, revokedAt: null } })).toBe(0)
        // The newest token of that login no longer works either; the other device stays signed in.
        await refresh(next).expect(401)
        await refresh(other).expect(200)
        const otherFamily = (await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashOf(other) } })).familyId
        expect(await prisma.refreshToken.count({ where: { userId, familyId: otherFamily, revokedAt: null } })).toBe(1)
      })

      it('a logged-out login cannot be revived through the grace window', async () => {
        const { rt } = await login()
        const next = cookie(await refresh(rt).expect(200), 'wz_rt')
        await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Cookie', next).expect(200)
        await refresh(rt).expect(401)
        await refresh(next).expect(401)
      })

      it('the refresh cookie: HttpOnly, SameSite=Lax, path /api/v1/auth, 30 days; the access cookie 15 minutes', async () => {
        const { email, password } = await signup(app)
        const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password }).expect(200)
        const all = res.headers['set-cookie'] as unknown as string[]
        const rt = all.find((c) => c.startsWith('wz_rt='))!
        const at = all.find((c) => c.startsWith('wz_at='))!
        expect(rt).toMatch(/HttpOnly/)
        expect(rt).toMatch(/SameSite=Lax/)
        expect(rt).toMatch(/Path=\/api\/v1\/auth/)
        expect(rt).toMatch(new RegExp(`Max-Age=${30 * 86_400}\\b`))
        expect(at).toMatch(new RegExp(`Max-Age=${15 * 60}\\b`))
        // A refresh slides the session: the new refresh cookie gets the full 30 days again.
        expect(cookie(await refresh(rt.split(';')[0]).expect(200), 'wz_rt')).toBeTruthy()
        const again = (await refresh(rt.split(';')[0])).headers['set-cookie'] as unknown as string[]
        expect(again.find((c) => c.startsWith('wz_rt='))).toMatch(new RegExp(`Max-Age=${30 * 86_400}\\b`))
      })
    })

    it('logs out and clears the session', async () => {
      const { agent, userId } = await signup(app)
      await agent.post('/api/v1/auth/logout').expect(200)
      await agent.get('/api/v1/auth/me').expect(401)
      await agent.post('/api/v1/auth/refresh').expect(401)
      expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0)
    })
  })

  describe('passwords', () => {
    it('resets a password with the emailed link, once', async () => {
      const { email } = await signup(app)
      await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email }).expect(200)
      const token = decodeURIComponent(/token=([^\s]+)/.exec(mail.lastMessage!.text)![1])

      const mismatch = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token, password: 'NewSecret99', confirmPassword: 'Different99' })
        .expect(400)
      expect(mismatch.body.error.fields.confirmPassword).toBe('Passwords do not match')

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token, password: 'NewSecret99', confirmPassword: 'NewSecret99' })
        .expect(200)
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'Secret123' }).expect(401)
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'NewSecret99' }).expect(200)
      const reused = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token, password: 'Another999', confirmPassword: 'Another999' })
        .expect(400)
      expect(reused.body.error.fields.token).toBeDefined()
    })

    it('does not reveal whether an email exists', async () => {
      mail.lastMessage = null
      const res = await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email: 'ghost@example.com' }).expect(200)
      expect(res.body.ok).toBe(true)
      expect(mail.lastMessage).toBeNull()
    })

    it('tells the user when the reset email could not be sent', async () => {
      const { email } = await signup(app)
      const failing = jest.spyOn(mail, 'send').mockRejectedValueOnce(emailFailed())
      const res = await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email }).expect(503)
      expect(res.body).toEqual({
        error: { code: 'EMAIL_FAILED', message: "We couldn't send the email right now. Please try again in a few minutes." },
      })
      failing.mockRestore()
    })

    it('changes the password only with the current one', async () => {
      const { agent, email } = await signup(app)
      const bad = await agent
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: 'Wrong999', newPassword: 'Brandnew1', confirmPassword: 'Brandnew1' })
        .expect(400)
      expect(bad.body.error.fields.currentPassword).toBe('Current password is incorrect')
      await agent
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: 'Secret123', newPassword: 'Brandnew1', confirmPassword: 'Brandnew1' })
        .expect(200)
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'Brandnew1' }).expect(200)
    })
  })

  describe('profile', () => {
    const valid = {
      ownerName: 'Arjun Mehta',
      studioName: 'Golden Hour Studios',
      email: 'Hello@GoldenHour.Studio',
      phone: '+91 98765 43210',
      city: 'Chennai',
      stateCode: '33',
      pincode: '600006',
      bio: 'Candid storytellers',
    }

    it('updates the profile and owner name', async () => {
      const { agent } = await signup(app)
      const res = await agent.patch('/api/v1/studio/profile').send(valid).expect(200)
      expect(res.body).toMatchObject({ name: 'Golden Hour Studios', ownerName: 'Arjun Mehta', email: 'hello@goldenhour.studio', stateCode: '33' })
      const me = await agent.get('/api/v1/auth/me').expect(200)
      expect(me.body.user.name).toBe('Arjun Mehta')
    })

    it('has no GSTIN or PAN: an older app sending them is ignored', async () => {
      const { agent } = await signup(app)
      const res = await agent.patch('/api/v1/studio/profile').send({ ...valid, gstin: '33ABCDE1234F1Z5', pan: 'ABCDE1234F' }).expect(200)
      expect(res.body).not.toHaveProperty('gstin')
      expect(res.body).not.toHaveProperty('pan')
    })

    it('uploads a logo after checking the real file type', async () => {
      const { agent } = await signup(app)
      const fake = await agent.post('/api/v1/studio/logo').attach('file', Buffer.from('not really a png'), 'logo.png').expect(422)
      expectError(fake.body, 'FILE_INVALID')
      expect(fake.body.error.fields.file).toMatch(/not a supported file/)

      const ok = await agent.post('/api/v1/studio/logo').attach('file', pngBuffer(), 'logo.png').expect(201)
      expect(ok.body.logoUrl).toMatch(/^\/api\/v1\/public\/files\//)
      const file = await request(app.getHttpServer()).get(ok.body.logoUrl).expect(200)
      expect(file.headers['content-type']).toBe('image/png')
    })
  })

  describe('error format', () => {
    it('uses { error: { code, message } } for unknown routes', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health/nope').expect(404)
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
    })

    it('rejects malformed JSON', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email":')
        .expect(400)
      expectError(res.body, 'VALIDATION_ERROR')
    })
  })

  it('logs in with the mobile number instead of the email', async () => {
    const s = await signup(app, { phone: '91234 56780', email: `phone.${Date.now()}@example.com` })
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: '+91 91234-56780', password: s.password }).expect(200)
    expect(res.body.user.email).toBe(s.email)
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: '12345', password: s.password }).expect(400)
  })
})
