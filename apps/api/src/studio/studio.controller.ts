import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiConsumes, ApiTags } from '@nestjs/swagger'
import { profileSchema } from '@weddyzone/shared'
import type { Response } from 'express'
import type { z } from 'zod'
import { notFound } from '../common/errors'
import { PublicThrottle } from '../common/throttle'
import { ApiZodBody, zod } from '../common/zod'
import { FilesService, type UploadedFile as Upload } from '../core/files.service'
import { StudioMapper } from '../core/studio.mapper'
import { AuthUser, CurrentUser, Public, StudioId } from '../auth/auth.decorators'
import { PrismaService } from '../prisma/prisma.service'
import { uploadOptions } from './upload-options'

@ApiTags('studio')
@Controller('studio')
export class StudioController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studios: StudioMapper,
    private readonly files: FilesService,
  ) {}

  @Get('profile')
  profile(@StudioId() studioId: string) {
    return this.studios.dto(studioId)
  }

  @Patch('profile')
  @ApiZodBody(profileSchema)
  async update(
    @StudioId() studioId: string,
    @CurrentUser() user: AuthUser,
    @Body(zod(profileSchema)) body: z.output<typeof profileSchema>,
  ) {
    const nullable = (v: string | undefined) => v ?? null
    await this.prisma.$transaction([
      this.prisma.studio.update({
        where: { id: studioId },
        data: {
          name: body.studioName,
          email: body.email,
          phone: body.phone,
          city: body.city,
          stateCode: body.stateCode,
          addressLine1: nullable(body.addressLine1),
          addressLine2: nullable(body.addressLine2),
          pincode: nullable(body.pincode),
          gstin: nullable(body.gstin),
          pan: nullable(body.pan),
          website: nullable(body.website),
          bio: nullable(body.bio),
        },
      }),
      this.prisma.user.update({ where: { id: user.userId }, data: { name: body.ownerName } }),
    ])
    return this.studios.dto(studioId)
  }

  @Post('logo')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', uploadOptions(2)))
  async uploadLogo(@StudioId() studioId: string, @UploadedFile() file: Upload | undefined) {
    const stored = await this.files.store(studioId, 'LOGO', file)
    const old = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { logoFileId: true } })
    await this.prisma.studio.update({ where: { id: studioId }, data: { logoFileId: stored.id } })
    if (old.logoFileId) await this.files.softDelete(old.logoFileId)
    return this.studios.dto(studioId)
  }

  @Delete('logo')
  async removeLogo(@StudioId() studioId: string) {
    const old = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { logoFileId: true } })
    if (old.logoFileId) {
      await this.prisma.studio.update({ where: { id: studioId }, data: { logoFileId: null } })
      await this.files.softDelete(old.logoFileId)
    }
    return this.studios.dto(studioId)
  }
}

@ApiTags('files')
@Controller()
export class FilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  /** Any file owned by the logged-in studio. */
  @Get('files/:id')
  async studioFile(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.prisma.storedFile.findFirst({ where: { id, studioId, deletedAt: null } })
    if (!file) throw notFound('File')
    this.files.send(res, file)
  }

  /** Logos and banners are public by nature (shown on galleries and the studio website). */
  @Public()
  @PublicThrottle()
  @Get('public/files/:id')
  async publicFile(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.prisma.storedFile.findFirst({
      where: { id, deletedAt: null, kind: { in: ['LOGO', 'BANNER'] } },
    })
    if (!file) throw notFound('File')
    this.files.send(res, file, { cache: 'public' })
  }
}
