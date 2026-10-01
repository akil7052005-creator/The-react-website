import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiConsumes, ApiTags } from '@nestjs/swagger'
import type { Prisma } from '@prisma/client'
import { bannerSchema, faqFeedbackSchema, idListSchema, type FaqDto } from '@weddyzone/shared'
import { z } from 'zod'
import { AuthUser, CurrentUser, StudioId } from '../auth/auth.decorators'
import { badRequest, notFound } from '../common/errors'
import { toDate } from '../common/util'
import { ApiZodBody, zod } from '../common/zod'
import { config } from '../config'
import { FilesService, type UploadedFile as Upload } from '../core/files.service'
import { bannerDto } from '../dashboard/dashboard.controller'
import { PrismaService } from '../prisma/prisma.service'
import { uploadOptions } from '../studio/upload-options'

@ApiTags('banners')
@Controller('banners')
export class BannersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  private async find(studioId: string, id: string) {
    const b = await this.prisma.banner.findFirst({ where: { id, studioId, deletedAt: null }, include: { image: true } })
    if (!b) throw notFound('Banner')
    return b
  }

  @Get()
  async list(@StudioId() studioId: string) {
    const rows = await this.prisma.banner.findMany({
      where: { studioId, deletedAt: null },
      include: { image: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    })
    return rows.map(bannerDto)
  }

  /** multipart/form-data: `file` (JPEG/PNG/WebP ≤ 5 MB) + the banner fields. */
  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', uploadOptions(config().MAX_BANNER_MB)))
  async create(@StudioId() studioId: string, @UploadedFile() file: Upload | undefined, @Body() raw: unknown) {
    const body = bannerSchema.parse(raw ?? {})
    const image = await this.files.store(studioId, 'BANNER', file)
    const last = await this.prisma.banner.findFirst({ where: { studioId, deletedAt: null }, orderBy: { position: 'desc' } })
    const b = await this.prisma.banner.create({
      data: {
        studioId,
        imageFileId: image.id,
        title: body.title,
        placement: body.placement,
        ctaText: body.ctaText ?? null,
        ctaUrl: body.ctaUrl ?? null,
        startDate: body.startDate ? toDate(body.startDate) : null,
        endDate: body.endDate ? toDate(body.endDate) : null,
        active: body.active,
        position: (last?.position ?? -1) + 1,
      },
      include: { image: true },
    })
    return bannerDto(b)
  }

  /** Same fields as create; `file` is optional (keeps the current image). */
  @Patch(':id')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', uploadOptions(config().MAX_BANNER_MB)))
  async update(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Upload | undefined, @Body() raw: unknown) {
    const existing = await this.find(studioId, id)
    const body = bannerSchema.parse(raw ?? {})
    const image = file ? await this.files.store(studioId, 'BANNER', file) : null
    const b = await this.prisma.banner.update({
      where: { id },
      data: {
        title: body.title,
        placement: body.placement,
        ctaText: body.ctaText ?? null,
        ctaUrl: body.ctaUrl ?? null,
        startDate: body.startDate ? toDate(body.startDate) : null,
        endDate: body.endDate ? toDate(body.endDate) : null,
        active: body.active,
        ...(image ? { imageFileId: image.id } : {}),
      },
      include: { image: true },
    })
    if (image) await this.files.softDelete(existing.imageFileId)
    return bannerDto(b)
  }

  @Patch(':id/active')
  @ApiZodBody(z.object({ active: z.boolean() }))
  async setActive(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ active: z.boolean() }))) body: { active: boolean }) {
    await this.find(studioId, id)
    return bannerDto(await this.prisma.banner.update({ where: { id }, data: { active: body.active }, include: { image: true } }))
  }

  @Put('order')
  @ApiZodBody(idListSchema)
  async reorder(@StudioId() studioId: string, @Body(zod(idListSchema)) body: z.output<typeof idListSchema>) {
    const owned = await this.prisma.banner.findMany({ where: { studioId, deletedAt: null }, select: { id: true } })
    const ids = new Set(owned.map((b) => b.id))
    if (body.ids.length !== ids.size || body.ids.some((id) => !ids.has(id))) {
      throw badRequest('Send every banner exactly once to reorder', { ids: 'The list must contain all your banners' })
    }
    await this.prisma.$transaction(body.ids.map((id, position) => this.prisma.banner.update({ where: { id }, data: { position } })))
    return this.list(studioId)
  }

  @Delete(':id')
  async remove(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    const b = await this.find(studioId, id)
    await this.prisma.banner.update({ where: { id }, data: { deletedAt: new Date() } })
    await this.files.softDelete(b.imageFileId)
    return { ok: true }
  }
}

const faqQuery = z.object({
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
})

@ApiTags('help')
@Controller('faqs')
export class HelpController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query(zod(faqQuery)) q: z.output<typeof faqQuery>): Promise<FaqDto[]> {
    const text = q.search ? { contains: q.search, mode: 'insensitive' as const } : undefined
    const where: Prisma.FaqWhereInput = {
      isPublished: true,
      ...(q.category ? { category: q.category } : {}),
      ...(text ? { OR: [{ question: text }, { answer: text }, { category: text }] } : {}),
    }
    const rows = await this.prisma.faq.findMany({
      where,
      include: { votes: { where: { userId: user.userId } } },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    })
    return rows.map((f) => ({ id: f.id, category: f.category, question: f.question, answer: f.answer, myVote: f.votes[0]?.helpful ?? null }))
  }

  /** One vote per user per FAQ; changing the vote moves the counters. */
  @Post(':id/feedback')
  @HttpCode(200)
  @ApiZodBody(faqFeedbackSchema)
  async feedback(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zod(faqFeedbackSchema)) body: z.output<typeof faqFeedbackSchema>) {
    const faq = await this.prisma.faq.findFirst({ where: { id, isPublished: true } })
    if (!faq) throw notFound('FAQ')
    await this.prisma.$transaction(async (tx) => {
      const prev = await tx.faqFeedback.findUnique({ where: { faqId_userId: { faqId: id, userId: user.userId } } })
      if (prev?.helpful === body.helpful) return
      await tx.faqFeedback.upsert({
        where: { faqId_userId: { faqId: id, userId: user.userId } },
        create: { faqId: id, userId: user.userId, helpful: body.helpful },
        update: { helpful: body.helpful },
      })
      await tx.faq.update({
        where: { id },
        data: {
          helpfulYes: { increment: (body.helpful ? 1 : 0) - (prev?.helpful === true ? 1 : 0) },
          helpfulNo: { increment: (body.helpful ? 0 : 1) - (prev?.helpful === false ? 1 : 0) },
        },
      })
    })
    return { ok: true, myVote: body.helpful }
  }
}
