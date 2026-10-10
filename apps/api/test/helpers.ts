import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaClient, type PlanCode } from '@prisma/client'
import request from 'supertest'
import type TestAgent from 'supertest/lib/agent'
import { seedReference } from '../prisma/seed/reference'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { gradientPng } from '../src/common/png'
import { MailService } from '../src/infra/mail.service'
import { PrismaService } from '../src/prisma/prisma.service'

export type Agent = TestAgent

let counter = 0

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  const app = moduleRef.createNestApplication({ logger: ['error'], rawBody: true })
  configureApp(app)
  await app.init()
  return {
    app,
    prisma: app.get(PrismaService) as PrismaClient,
    mail: app.get(MailService),
    agent: () => request.agent(app.getHttpServer()),
  }
}

/** Empties every table and reloads plans/templates/FAQs. */
export async function resetDb(prisma: PrismaClient) {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  // The previous test file's app may still be finishing background work (preview renders): retry
  // the truncate if the two deadlock.
  for (let attempt = 0; ; attempt++) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`)
      break
    } catch (e) {
      if (attempt >= 5 || !/40P01|deadlock/i.test(String((e as Error).message))) throw e
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }
  await seedReference(prisma)
}

export interface SignedUp {
  agent: Agent
  email: string
  password: string
  studioId: string
  userId: string
}

/**
 * Signs up a fresh studio and returns a logged-in agent (cookies kept between requests). New studios
 * start on the Trial (2 events, 100 photos per event); tests about something else run on VIP so the
 * plan never gets in the way. Pass `plan: 'trial'` (or a plan code) to choose.
 */
export async function signup(app: INestApplication, overrides: Record<string, unknown> & { plan?: 'trial' | PlanCode } = {}): Promise<SignedUp> {
  const { plan = 'ALL_ACCESS', ...fields } = overrides
  const signed = await signupRaw(app, fields)
  if (plan !== 'trial') await putOnPlan(app.get(PrismaService) as unknown as PrismaClient, signed.studioId, plan)
  return signed
}

/** Moves a studio onto a paid plan for a year (active, not a trial). */
export async function putOnPlan(prisma: PrismaClient, studioId: string, code: PlanCode, cycle: 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY' = 'YEARLY') {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code } })
  const now = new Date()
  await prisma.subscription.update({
    where: { studioId },
    data: { planId: plan.id, cycle, status: 'ACTIVE', isTrial: false, currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 365 * 86_400_000), usageAnchor: now },
  })
}

async function signupRaw(app: INestApplication, overrides: Record<string, unknown> = {}): Promise<SignedUp> {
  counter++
  const agent = request.agent(app.getHttpServer())
  const email = `owner${counter}.${Date.now()}@example.com`
  const password = 'Secret123'
  const res = await agent
    .post('/api/v1/auth/signup')
    .send({
      studioName: `Test Studio ${counter}`,
      ownerName: 'Test Owner',
      email,
      phone: '9876543210',
      password,
      ...overrides,
    })
    .expect(201)
  return { agent, email: (overrides.email as string) ?? email, password, studioId: res.body.studio.id, userId: res.body.user.id }
}

export async function setStudioState(prisma: PrismaClient, studioId: string, stateCode: string) {
  await prisma.studio.update({ where: { id: studioId }, data: { stateCode } })
}

export function pngBuffer(hue = 10, size = 32) {
  return gradientPng(size, size, hue, hue)
}

export const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00])

export function isoDaysFromToday(days: number) {
  const d = new Date(Date.now() + days * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d)
}

export function expectError(body: { error?: { code?: string } }, code: string) {
  expect(body.error?.code).toBe(code)
}
