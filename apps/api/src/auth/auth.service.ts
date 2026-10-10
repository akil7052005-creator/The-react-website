import { HttpStatus, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { User } from '@prisma/client'
import {
  ERROR_CODES,
  WEBSITE_SECTION_KEYS,
  type MeDto,
} from '@weddyzone/shared'
import { quotaOf } from '@weddyzone/shared'
import type { z } from 'zod'
import type {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from '@weddyzone/shared'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { AppError, badRequest, conflict, unauthenticated } from '../common/errors'
import { randomToken, sha256, slugify } from '../common/util'
import { config } from '../config'
import { LedgerService } from '../core/ledger.service'
import { NotificationsService } from '../core/notifications.service'
import { PlansService } from '../core/plans.service'
import { StudioMapper } from '../core/studio.mapper'
import { MailService } from '../infra/mail.service'
import { PrismaService, type Tx } from '../prisma/prisma.service'
import { decryptSecret, verifyTotp } from './totp'

export const SIGNUP_BONUS_CREDITS = 50
/** Trial length when the Trial plan doesn't set trialDays. */
export const TRIAL_DAYS = 14
const BCRYPT_ROUNDS = 10
// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('never-a-real-password', BCRYPT_ROUNDS)

export interface IssuedTokens {
  access: string
  refresh: string
  /** How long the refresh cookie lives: ADMIN_SESSION_HOURS for platform admins, REFRESH_TOKEN_TTL_DAYS otherwise. */
  refreshMaxAgeMs: number
}

/** Platform admins get much shorter sessions than studio users. */
export function refreshTtlMs(role: User['role']): number {
  const c = config()
  return role === 'SUPER_ADMIN' ? c.ADMIN_SESSION_HOURS * 3_600_000 : c.REFRESH_TOKEN_TTL_DAYS * 86_400_000
}

/** A studio removed by the platform admin can't sign in. */
const studioRemoved = () => new AppError(HttpStatus.FORBIDDEN, 'STUDIO_REMOVED', 'This studio account has been removed. Please contact support.')

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly plans: PlansService,
    private readonly studios: StudioMapper,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  hashPassword(password: string) {
    return bcrypt.hash(password, BCRYPT_ROUNDS)
  }

  async me(userId: string): Promise<MeDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { studio: { select: { removedAt: true } } } })
    if (!user) throw unauthenticated()
    if (user.studio?.removedAt) throw studioRemoved()
    return {
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role },
      studio: user.studioId ? await this.studios.dto(user.studioId) : null,
      features: { faceRecognition: config().FEATURE_FACE_RECOGNITION },
    }
  }

  async signup(input: z.output<typeof signupSchema>): Promise<{ user: User; tokens: IssuedTokens }> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } })
    if (existing) throw conflict('An account with this email already exists', { email: 'This email is already registered — try logging in' })

    let referrerId: string | null = null
    if (input.referralCode) {
      const referrer = await this.prisma.studio.findUnique({ where: { referralCode: input.referralCode } })
      if (!referrer) throw badRequest('Referral code not found', { referralCode: 'This referral code does not exist' })
      referrerId = referrer.id
    }

    const passwordHash = await this.hashPassword(input.password)
    const user = await this.prisma.$transaction(async (tx) => {
      const studio = await tx.studio.create({
        data: {
          name: input.studioName,
          slug: await this.uniqueSlug(tx, input.studioName),
          referralCode: await this.uniqueReferralCode(tx, input.studioName),
          email: input.email,
          phone: input.phone,
        },
      })
      const owner = await tx.user.create({
        data: {
          studioId: studio.id,
          name: input.ownerName,
          email: input.email,
          phone: input.phone,
          passwordHash,
          role: 'OWNER',
        },
      })
      const starter = await this.plans.byCode('STARTER', tx)
      const trialDays = quotaOf(starter.limits).trialDays ?? TRIAL_DAYS
      const now = new Date()
      const sub = await tx.subscription.create({
        data: {
          studioId: studio.id,
          planId: starter.id,
          cycle: 'MONTHLY',
          status: 'TRIAL',
          isTrial: true,
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + trialDays * 86_400_000),
          usageAnchor: now,
        },
      })
      await tx.subscriptionEvent.create({ data: { subscriptionId: sub.id, type: 'CREATED', toPlan: `${starter.name} (trial)`, note: `${trialDays}-day free trial` } })
      await tx.websiteSettings.create({
        data: {
          studioId: studio.id,
          sections: WEBSITE_SECTION_KEYS.map((key) => ({ key, on: key !== 'blog' })),
        },
      })
      await this.ledger.applyCredits(tx, studio.id, SIGNUP_BONUS_CREDITS, 'SIGNUP_BONUS')
      if (referrerId) {
        await tx.referral.create({
          data: { referrerStudioId: referrerId, referredStudioId: studio.id, rewardAmount: 150_000 },
        })
        await this.notifications.notify(
          referrerId,
          {
            type: 'REFERRAL_REWARD',
            title: 'New referral signed up',
            body: `${studio.name} joined with your referral code. You both get ₹1,500 when they upgrade.`,
            link: '/refer-and-earn',
            icon: 'gift',
          },
          tx,
        )
      }
      return owner
    })
    return { user, tokens: await this.issueTokens(user) }
  }

  async login(input: z.output<typeof loginSchema>): Promise<{ user: User; tokens: IssuedTokens }> {
    // The login id is an email, or a mobile number already normalised to +91XXXXXXXXXX.
    const user = input.email.startsWith('+91')
      ? await this.prisma.user.findFirst({ where: { phone: input.email }, orderBy: { createdAt: 'asc' } })
      : await this.prisma.user.findUnique({ where: { email: input.email } })
    const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH)
    if (!user || !ok) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Incorrect email or password', {
        password: 'Incorrect email or password',
      })
    }
    if (user.studioId && (await this.prisma.studio.findUnique({ where: { id: user.studioId }, select: { removedAt: true } }))?.removedAt) throw studioRemoved()
    // Two-factor sign-in (platform admins who turned it on): the password alone is not enough.
    if (user.totpEnabledAt && user.totpSecret) {
      if (!input.otp) {
        throw new AppError(HttpStatus.UNAUTHORIZED, ERROR_CODES.OTP_REQUIRED, 'Enter the 6-digit code from your authenticator app', {
          otp: 'Enter the 6-digit code from your authenticator app',
        })
      }
      if (!verifyTotp(decryptSecret(user.totpSecret), input.otp)) {
        throw new AppError(HttpStatus.UNAUTHORIZED, ERROR_CODES.OTP_REQUIRED, 'That code is not right — check your authenticator app', {
          otp: 'That code is not right or has expired',
        })
      }
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    return { user, tokens: await this.issueTokens(user) }
  }

  async issueTokens(user: Pick<User, 'id' | 'studioId' | 'role'>): Promise<IssuedTokens> {
    const c = config()
    const access = await this.jwt.signAsync(
      { sub: user.id, sid: user.studioId, role: user.role },
      { secret: c.JWT_ACCESS_SECRET, expiresIn: `${c.ACCESS_TOKEN_TTL_MINUTES}m` },
    )
    const jti = randomUUID()
    const ttlMs = refreshTtlMs(user.role)
    const refresh = await this.jwt.signAsync(
      { sub: user.id, jti },
      { secret: c.JWT_REFRESH_SECRET, expiresIn: `${Math.round(ttlMs / 1000)}s` },
    )
    await this.prisma.refreshToken.create({
      data: {
        id: jti,
        userId: user.id,
        tokenHash: sha256(refresh),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    })
    return { access, refresh, refreshMaxAgeMs: ttlMs }
  }

  /**
   * Rotates the refresh token. Presenting an already-rotated token means it
   * was stolen or replayed, so every session of that user is revoked.
   */
  async refresh(token: string | undefined): Promise<IssuedTokens> {
    const expired = () => unauthenticated('Session expired, please log in again', ERROR_CODES.TOKEN_EXPIRED)
    if (!token) throw expired()
    let payload: { sub: string; jti: string }
    try {
      payload = await this.jwt.verifyAsync(token, { secret: config().JWT_REFRESH_SECRET })
    } catch {
      throw expired()
    }
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } })
    if (!record || record.userId !== payload.sub) throw expired()
    if (record.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      throw expired()
    }
    if (record.expiresAt < new Date()) throw expired()
    const user = await this.prisma.user.findUnique({ where: { id: record.userId }, include: { studio: { select: { removedAt: true } } } })
    if (!user) throw expired()
    if (user.studio?.removedAt) throw studioRemoved()
    // Only one concurrent refresh wins; the loser gets a normal "expired" and the client retries with the new cookie.
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    if (revoked.count === 0) throw expired()
    return this.issueTokens(user)
  }

  async logout(token: string | undefined) {
    if (!token) return
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  async forgotPassword(input: z.output<typeof forgotPasswordSchema>) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } })
    // Same response either way so the endpoint cannot be used to discover accounts.
    if (!user) return
    const token = randomToken(32)
    await this.prisma.passwordReset.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60_000) },
    })
    const link = `${config().APP_URL}/reset-password?token=${encodeURIComponent(token)}`
    // If delivery fails this throws a 503 so the user is told to retry. That can only happen for an
    // existing account, an accepted trade-off: silently "sending" nothing is worse for real users.
    await this.mail.send({
      to: user.email,
      subject: 'Reset your Weddyzone Studio password',
      text: `Hi ${user.name},\n\nUse this link to set a new password (valid for 1 hour):\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
    })
  }

  async resetPassword(input: z.output<typeof resetPasswordSchema>) {
    const record = await this.prisma.passwordReset.findUnique({ where: { tokenHash: sha256(input.token) } })
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw badRequest('This reset link is invalid or has expired. Please request a new one.', {
        token: 'This reset link is invalid or has expired',
      })
    }
    const passwordHash = await this.hashPassword(input.password)
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.passwordReset.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ])
  }

  async changePassword(userId: string, input: z.output<typeof changePasswordSchema>) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
      throw badRequest('Current password is incorrect', { currentPassword: 'Current password is incorrect' })
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.hashPassword(input.newPassword) },
    })
  }

  private async uniqueSlug(tx: Tx, name: string) {
    const base = slugify(name)
    for (let i = 0; i < 20; i++) {
      const slug = i === 0 ? base : `${base}-${Math.floor(Math.random() * 9000 + 1000)}`
      if (!(await tx.studio.findUnique({ where: { slug } }))) return slug
    }
    return `${base}-${randomToken(4).toLowerCase()}`
  }

  private async uniqueReferralCode(tx: Tx, name: string) {
    const letters = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6).padEnd(4, 'W')
    for (let i = 0; i < 20; i++) {
      const code = `${letters}${Math.floor(Math.random() * 90 + 10)}`
      if (!(await tx.studio.findUnique({ where: { referralCode: code } }))) return code
    }
    return `${letters}${Date.now().toString().slice(-4)}`
  }
}
