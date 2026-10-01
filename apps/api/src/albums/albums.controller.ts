import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import {
  albumApprovalSchema,
  albumFeedbackSchema,
  albumPagesSchema,
  albumStatusSchema,
  createAlbumSchema,
  listQuerySchema,
  updateAlbumSchema,
  type ListQuery,
} from '@weddyzone/shared'
import type { Response } from 'express'
import { z } from 'zod'
import { Public, StudioId } from '../auth/auth.decorators'
import { PublicThrottle } from '../common/throttle'
import { ApiListQuery, ApiZodBody, zod } from '../common/zod'
import { FilesService } from '../core/files.service'
import { AlbumsService } from './albums.service'

const resolveSchema = z.object({ resolved: z.boolean() })

@ApiTags('albums')
@Controller()
export class AlbumsController {
  constructor(private readonly albums: AlbumsService) {}

  @Get('albums')
  @ApiListQuery()
  list(@StudioId() studioId: string, @Query(zod(listQuerySchema)) q: ListQuery) {
    return this.albums.list(studioId, q)
  }

  @Get('albums/summary')
  summary(@StudioId() studioId: string) {
    return this.albums.summary(studioId)
  }

  @Post('albums')
  @ApiZodBody(createAlbumSchema)
  create(@StudioId() studioId: string, @Body(zod(createAlbumSchema)) body: z.output<typeof createAlbumSchema>) {
    return this.albums.create(studioId, body)
  }

  @Get('albums/:id')
  get(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.albums.detail(studioId, id)
  }

  @Patch('albums/:id')
  @ApiZodBody(updateAlbumSchema)
  update(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Body(zod(updateAlbumSchema)) body: z.output<typeof updateAlbumSchema>) {
    return this.albums.update(studioId, id, body)
  }

  @Put('albums/:id/pages')
  @ApiZodBody(albumPagesSchema)
  pages(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Body(zod(albumPagesSchema)) body: z.output<typeof albumPagesSchema>) {
    return this.albums.setPages(studioId, id, body.photoIds)
  }

  @Patch('albums/:id/status')
  @ApiZodBody(albumStatusSchema)
  status(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Body(zod(albumStatusSchema)) body: z.output<typeof albumStatusSchema>) {
    return this.albums.setStatus(studioId, id, body.status)
  }

  @Delete('albums/:id')
  async remove(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.albums.remove(studioId, id)
    return { ok: true }
  }

  @Post('albums/:id/share')
  @HttpCode(200)
  share(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.albums.share(studioId, id)
  }

  @Post('albums/:id/mark-shared')
  @HttpCode(200)
  markShared(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.albums.markShared(studioId, id)
  }

  @Patch('albums/:id/feedback/:feedbackId')
  @ApiZodBody(resolveSchema)
  resolve(
    @StudioId() studioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('feedbackId', ParseUUIDPipe) feedbackId: string,
    @Body(zod(resolveSchema)) body: z.output<typeof resolveSchema>,
  ) {
    return this.albums.resolveFeedback(studioId, id, feedbackId, body.resolved)
  }

  @Get('events/:id/photos')
  eventPhotos(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.albums.eventPhotos(studioId, id)
  }
}

@ApiTags('public')
@Public()
@PublicThrottle()
@Controller('public/albums')
export class PublicAlbumsController {
  constructor(
    private readonly albums: AlbumsService,
    private readonly files: FilesService,
  ) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.albums.publicView(token)
  }

  @Get(':token/photos/:photoId')
  async photo(@Param('token') token: string, @Param('photoId', ParseUUIDPipe) photoId: string, @Res() res: Response) {
    await this.files.send(res, await this.albums.publicPhotoFile(token, photoId))
  }

  @Post(':token/feedback')
  @ApiZodBody(albumFeedbackSchema)
  feedback(@Param('token') token: string, @Body(zod(albumFeedbackSchema)) body: z.output<typeof albumFeedbackSchema>) {
    return this.albums.addFeedback(token, body)
  }

  @Post(':token/approvals')
  @HttpCode(200)
  @ApiZodBody(albumApprovalSchema)
  approve(@Param('token') token: string, @Body(zod(albumApprovalSchema)) body: z.output<typeof albumApprovalSchema>) {
    return this.albums.setApproval(token, body)
  }
}
