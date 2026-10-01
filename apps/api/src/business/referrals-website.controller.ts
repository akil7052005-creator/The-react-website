import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { WebsiteSettings } from '@prisma/client'
import {
  leadSchema,
  listQuerySchema,
  WEBSITE_SECTION_KEYS,
  WEBSITE_SECTION_LABELS,
  websiteSettingsSchema,
  type ListQuery,
  type PublicWebsiteDto,
  type ReferralOverviewDto,
  type WebsiteSectionKey,
  type WebsiteSettingsDto,
} from '@weddyzone/shared'
import type { z } from 'zod'
import { Public, StudioId } from '../auth/auth.decorators'
import { badRequest, notFound } from '../common/errors'
import { PublicThrottle } from '../common/throttle'
import { paginate, skipTake, toDate, toIso, todayDate } from '../common/util'
import { ApiListQuery, ApiZodBody, zod } from '../common/zod'
import { config } from '../config'
import { fileUrls } from '../core/files.service'
import { render } from '../core/messaging.service'
import { NotificationsService } from '../core/notifications.service'
import { bannerDto } from '../dashboard/dashboard.controller'
import { PrismaService } from '../prisma/prisma.service'

@ApiTags('referrals')
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async overview(@StudioId() studioId: string): Promise<ReferralOverviewDto> {
    const [studio, referrals, txns, earned, template] = await Promise.all([
      this.prisma.studio.findUniqueOrThrow({ where: { id: studioId } }),
      this.prisma.referral.findMany({
        where: { referrerStudioId: studioId },
        include: { referred: { select: { name: true, createdAt: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.walletTxn.findMany({ where: { studioId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.walletTxn.aggregate({
        where: { studioId, reason: { in: ['REFERRAL_REWARD', 'REFERRAL_WELCOME'] } },
        _sum: { delta: true },
      }),
      this.prisma.whatsAppTemplate.findUnique({ where: { key: 'REFERRAL_INVITE' } }),
    ])
    const link = `${config().APP_URL}/signup?ref=${studio.referralCode}`
    return {
      code: studio.referralCode,
      link,
      walletBalancePaise: studio.walletBalance,
      totalEarnedPaise: earned._sum.delta ?? 0,
      referrals: referrals.map((r) => ({
        id: r.id,
        studioName: r.referred.name,
        joinedAt: r.referred.createdAt.toISOString(),
        status: r.status,
        rewardPaise: r.rewardAmount,
        rewardedAt: r.rewardedAt?.toISOString() ?? null,
      })),
      transactions: txns.map((t) => ({
        id: t.id,
        deltaPaise: t.delta,
        reason: t.reason,
        balanceAfterPaise: t.balanceAfter,
        createdAt: t.createdAt.toISOString(),
      })),
      shareText: render(template?.body ?? 'Join me on Weddyzone Studio with code {{code}}: {{link}}', { code: studio.referralCode, link }),
    }
  }
}

export function websiteDto(w: WebsiteSettings, extra: { visits: number; leadCount: number; slug: string }): WebsiteSettingsDto {
  const saved = w.sections as { key: WebsiteSectionKey; on: boolean }[]
  // Sections added in later releases appear (off) at the end.
  const keys = [...saved.map((s) => s.key), ...WEBSITE_SECTION_KEYS.filter((k) => !saved.some((s) => s.key === k))]
  return {
    sections: keys
      .filter((k) => (WEBSITE_SECTION_KEYS as readonly string[]).includes(k))
      .map((key) => ({ key, label: WEBSITE_SECTION_LABELS[key], on: saved.find((s) => s.key === key)?.on ?? false })),
    theme: w.theme,
    primaryColor: w.primaryColor,
    font: w.font,
    tagline: w.tagline,
    customDomain: w.customDomain,
    seoTitle: w.seoTitle,
    seoDescription: w.seoDescription,
    videoUrl: w.videoUrl,
    visits: extra.visits,
    leadCount: extra.leadCount,
    publicUrl: `${config().APP_URL}/w/${extra.slug}`,
    status: 'Live',
  }
}

@ApiTags('website')
@Controller('website')
export class WebsiteController {
  constructor(private readonly prisma: PrismaService) {}

  private async load(studioId: string) {
    const [w, studio, leadCount] = await Promise.all([
      this.prisma.websiteSettings.upsert({
        where: { studioId },
        create: { studioId, sections: WEBSITE_SECTION_KEYS.map((key) => ({ key, on: key !== 'blog' })) },
        update: {},
      }),
      this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { slug: true } }),
      this.prisma.lead.count({ where: { studioId, deletedAt: null } }),
    ])
    return websiteDto(w, { visits: w.visits, leadCount, slug: studio.slug })
  }

  @Get()
  get(@StudioId() studioId: string) {
    return this.load(studioId)
  }

  @Put()
  @ApiZodBody(websiteSettingsSchema)
  async save(@StudioId() studioId: string, @Body(zod(websiteSettingsSchema)) body: z.output<typeof websiteSettingsSchema>) {
    if (body.customDomain) {
      const taken = await this.prisma.websiteSettings.findFirst({ where: { customDomain: body.customDomain, studioId: { not: studioId } } })
      if (taken) throw badRequest('That domain is used by another studio', { customDomain: 'This domain is already connected to another studio' })
    }
    await this.prisma.websiteSettings.upsert({
      where: { studioId },
      create: { studioId, sections: body.sections },
      update: {
        sections: body.sections,
        theme: body.theme,
        primaryColor: body.primaryColor,
        font: body.font,
        tagline: body.tagline ?? null,
        customDomain: body.customDomain ?? null,
        seoTitle: body.seoTitle ?? null,
        seoDescription: body.seoDescription ?? null,
        videoUrl: body.videoUrl ?? null,
      },
    })
    return this.load(studioId)
  }

  @Get('leads')
  @ApiListQuery()
  async leads(@StudioId() studioId: string, @Query(zod(listQuerySchema)) q: ListQuery) {
    const text = q.search ? { contains: q.search, mode: 'insensitive' as const } : undefined
    const where = { studioId, deletedAt: null, ...(text ? { OR: [{ name: text }, { city: text }, { email: text }] } : {}) }
    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.prisma.lead.count({ where }),
    ])
    return paginate(
      rows.map((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        email: l.email,
        eventDate: toIso(l.eventDate),
        city: l.city,
        message: l.message,
        createdAt: l.createdAt.toISOString(),
      })),
      total,
      q,
    )
  }
}

@ApiTags('public')
@Public()
@PublicThrottle()
@Controller('public/sites')
export class PublicSitesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async studioBySlug(slug: string) {
    const studio = await this.prisma.studio.findUnique({ where: { slug }, include: { websiteSettings: true } })
    if (!studio || !studio.websiteSettings) throw notFound('Website')
    return studio
  }

  @Get(':slug')
  async site(@Param('slug') slug: string): Promise<PublicWebsiteDto> {
    const studio = await this.studioBySlug(slug)
    const today = todayDate()
    const [albums, banners] = await Promise.all([
      this.prisma.album.findMany({
        where: { studioId: studio.id, deletedAt: null, status: 'PUBLISHED' },
        include: { pages: { take: 1, orderBy: { position: 'asc' } } },
        orderBy: { publishedAt: 'desc' },
        take: 6,
      }),
      this.prisma.banner.findMany({
        where: {
          studioId: studio.id,
          deletedAt: null,
          active: true,
          placement: { in: ['WEBSITE_HERO', 'WEBSITE_POPUP', 'GALLERY_HERO'] },
          AND: [{ OR: [{ startDate: null }, { startDate: { lte: today } }] }, { OR: [{ endDate: null }, { endDate: { gte: today } }] }],
        },
        include: { image: true },
        orderBy: { position: 'asc' },
      }),
    ])
    const settings = websiteDto(studio.websiteSettings!, { visits: 0, leadCount: 0, slug })
    const { visits: _v, leadCount: _l, publicUrl: _p, status: _s, ...publicSettings } = settings
    return {
      studio: {
        name: studio.name,
        slug: studio.slug,
        city: studio.city,
        phone: studio.phone,
        email: studio.email,
        bio: studio.bio,
        logoUrl: studio.logoFileId ? fileUrls.public(studio.logoFileId) : null,
      },
      settings: publicSettings,
      plans: [],
      albums: albums.map((a) => ({
        title: a.title,
        subtitle: a.subtitle,
        coverUrl: a.pages[0] ? fileUrls.albumPhoto(a.publicToken, a.pages[0].photoId) : null,
        link: `/a/${a.publicToken}`,
      })),
      banners: banners.map(bannerDto),
    }
  }

  /** Counted separately so the studio's own Live Preview doesn't inflate visits. */
  @Post(':slug/visit')
  @HttpCode(200)
  async visit(@Param('slug') slug: string) {
    const studio = await this.studioBySlug(slug)
    await this.prisma.websiteSettings.update({ where: { studioId: studio.id }, data: { visits: { increment: 1 } } })
    return { ok: true }
  }

  @Post(':slug/leads')
  @ApiZodBody(leadSchema)
  async lead(@Param('slug') slug: string, @Body(zod(leadSchema)) body: z.output<typeof leadSchema>) {
    const studio = await this.studioBySlug(slug)
    const sections = studio.websiteSettings!.sections as { key: string; on: boolean }[]
    if (!sections.find((s) => s.key === 'enquiry')?.on) throw notFound('Enquiry form')
    await this.prisma.lead.create({
      data: {
        studioId: studio.id,
        name: body.name,
        phone: body.phone,
        email: body.email ?? null,
        eventDate: body.eventDate ? toDate(body.eventDate) : null,
        city: body.city ?? null,
        message: body.message ?? null,
      },
    })
    await this.notifications.notify(studio.id, {
      type: 'LEAD_RECEIVED',
      title: body.name,
      body: `sent an enquiry from your website${body.eventDate ? ` for ${body.eventDate}` : ''}`,
      link: '/my-website?tab=leads',
      icon: 'envelope-heart',
    })
    return { ok: true, message: `Thank you! ${studio.name} will get back to you soon.` }
  }
}
