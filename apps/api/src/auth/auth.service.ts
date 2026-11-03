import { HttpStatus, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { User } from '@prisma/client'
import {
  ERROR_CODES,
  WEBSITE_SECTION_KEYS,
  type MeDto,
} from '@weddyzone/shared'
import { DEFAULT_TRIAL_DAYS, quotaOf, trialEndsAt, trialOffer } from '@weddyzone/shared'
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
/** Trial length (after the "free until 31 Dec" offer) when the Trial plan doesn't set trialDays. */
export const TRIAL_DAYS = DEFAULT_TRIAL_DAYS
const BCRYPT_ROUNDS = 10
// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('never-a-real-password', BCRYPT_ROUNDS)

export interface IssuedTokens {
  access: string
  refresh: string
  /** How long the refresh cookie lives: ADMIN_SESSION_HOURS for platform admins, REFRESH_TOKEN_TTL_DAYS otherwise. */
  refreshMaxAgeMs: number
  /** The refresh token's id (its jti). */
  refreshId: string
}

/**
 * A rotated refresh token still works for this long. Two tabs, a reload or a network retry can send
 * the same refresh cookie twice at once; the later request then gets a fresh pair in the same login
 * instead of being treated as a stolen token.
 */
export const REFRESH_REUSE_GRACE_MS = 60_000

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
          // Free until 31 Dec 2026 (23:59:59 IST) for sign-ups before then; trialDays after that.
          currentPeriodEnd: trialEndsAt(now, trialDays),
          usageAnchor: now,
        },
      })
      await tx.subscriptionEvent.create({ data: { subscriptionId: sub.id, type: 'CREATED', toPlan: starter.name, note: trialOffer(trialDays, now).line } })
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

  /** A new access + refresh pair; `familyId` keeps a rotation in the same login (a new login starts one). */
  async issueTokens(user: Pick<User, 'id' | 'studioId' | 'role'>, familyId?: string, db: Tx | PrismaService = this.prisma): Promise<IssuedTokens> {
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
    await db.refreshToken.create({
      data: {
        id: jti,
        userId: user.id,
        familyId: familyId ?? jti,
        tokenHash: sha256(refresh),
        // Every rotation gets the full lifetime again: the session slides while it is used.
        expiresAt: new Date(Date.now() + ttlMs),
      },
    })
    return { access, refresh, refreshMaxAgeMs: ttlMs, refreshId: jti }
  }

  /**
   * Rotates the refresh token: exactly one request can exchange a token (a conditional update inside
   * a transaction). A token rotated less than REFRESH_REUSE_GRACE_MS ago (a parallel request, a second
   * tab, a retry) gets a fresh pair in the same login. Presented later than that, it was most likely
   * stolen: that whole login (the token family) is revoked. Other logins of the user are not touched.
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
    // Logged out, or the login was revoked.
    if (record.revokedAt && !record.rotatedAt) throw expired()
    if (record.expiresAt < new Date()) throw expired()
    const user = await this.prisma.user.findUnique({ where: { id: record.userId }, include: { studio: { select: { removedAt: true } } } })
    if (!user) throw expired()
    if (user.studio?.removedAt) throw studioRemoved()

    // The rotation. The conditional update takes the row lock, so a parallel request waits for it and
    // then finds the token already rotated.
    const rotated = await this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const won = await tx.refreshToken.updateMany({ where: { id: record.id, revokedAt: null }, data: { revokedAt: now, rotatedAt: now } })
      if (won.count === 0) return null
      const tokens = await this.issueTokens(user, record.familyId, tx)
      await tx.refreshToken.update({ where: { id: record.id }, data: { replacedById: tokens.refreshId } })
      return tokens
    })
    if (rotated) return rotated

    // Someone already exchanged this token.
    const current = await this.prisma.refreshToken.findUniqueOrThrow({ where: { id: record.id } })
    if (!current.rotatedAt) throw expired()
    if (Date.now() - current.rotatedAt.getTime() <= REFRESH_REUSE_GRACE_MS) {
      // A request that raced the rotation: a fresh pair in the same login, as long as that login is
      // still alive (not logged out or revoked meanwhile).
      const alive = await this.prisma.refreshToken.count({ where: { familyId: record.familyId, revokedAt: null, expiresAt: { gt: new Date() } } })
      if (!alive) throw expired()
      return this.issueTokens(user, record.familyId)
    }
    // Replayed long after it was exchanged: treat it as stolen and end that login.
    await this.prisma.refreshToken.updateMany({ where: { familyId: record.familyId, revokedAt: null }, data: { revokedAt: new Date() } })
    throw expired()
  }

  /** Ends this login: every token of its family (a parallel refresh can leave more than one). */
  async logout(token: string | undefined) {
    if (!token) return
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, select: { familyId: true } })
    if (!record) return
    await this.prisma.refreshToken.updateMany({
      where: { familyId: record.familyId, revokedAt: null },
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
      subject: 'Reset your Wedmanage Studio password',
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
