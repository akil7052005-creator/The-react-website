import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { ApiConsumes, ApiQuery, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import {
  commentSchema,
  createSelectionSchema,
  listQuerySchema,
  pickSchema,
  submitSelectionSchema,
  updateSelectionSchema,
  type ListQuery,
} from '@weddyzone/shared'
import type { Response } from 'express'
import { z } from 'zod'
import { Public, StudioId } from '../auth/auth.decorators'
import { PublicThrottle } from '../common/throttle'
import { ApiListQuery, ApiZodBody, zod } from '../common/zod'
import { config } from '../config'
import { FilesService, type UploadedFile as Upload } from '../core/files.service'
import { SelectionsService } from './selections.service'
import { cleanFolder, PlanUploadInterceptor, type UploadRequest } from './upload-limits'

const kindQuery = z.object({ type: z.enum(['invite', 'reminder']).default('reminder') })
const exportQuery = z.object({ format: z.enum(['csv', 'txt']).default('csv') })

@ApiTags('selections')
@Controller('selections')
export class SelectionsController {
  constructor(private readonly selections: SelectionsService) {}

  @Get()
  @ApiListQuery()
  list(@StudioId() studioId: string, @Query(zod(listQuerySchema)) q: ListQuery) {
    return this.selections.list(studioId, q)
  }

  @Get('summary')
  summary(@StudioId() studioId: string) {
    return this.selections.summary(studioId)
  }

  @Post()
  @ApiZodBody(createSelectionSchema)
  create(@StudioId() studioId: string, @Body(zod(createSelectionSchema)) body: z.output<typeof createSelectionSchema>) {
    return this.selections.create(studioId, body)
  }

  @Get(':id')
  get(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.selections.dto(studioId, id)
  }

  @Patch(':id')
  @ApiZodBody(updateSelectionSchema)
  update(
    @StudioId() studioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(updateSelectionSchema)) body: z.output<typeof updateSelectionSchema>,
  ) {
    return this.selections.update(studioId, id, body)
  }

  @Delete(':id')
  async remove(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.selections.remove(studioId, id)
    return { ok: true }
  }

  @Get(':id/photos')
  photos(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.selections.photos(studioId, id)
  }

  /** One photo per request. Size, storage and read-only limits come from the studio's plan. */
  @Throttle({ default: { limit: config().RATE_LIMIT_UPLOADS_PER_MIN, ttl: 60_000 } })
  @Post(':id/photos')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(PlanUploadInterceptor)
  addPhoto(
    @StudioId() studioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Upload | undefined,
    @Req() req: UploadRequest,
  ) {
    return this.selections.addPhoto(studioId, id, file, { limits: req.uploadLimits, folder: cleanFolder((req.body as Record<string, unknown> | undefined)?.folder) })
  }

  @Delete(':id/photos/:photoId')
  async removePhoto(
    @StudioId() studioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ) {
    await this.selections.removePhoto(studioId, id, photoId)
    return { ok: true }
  }

  @Get(':id/message-preview')
  @ApiQuery({ name: 'type', enum: ['invite', 'reminder'], required: false })
  preview(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Query(zod(kindQuery)) q: z.output<typeof kindQuery>) {
    return this.selections.previewMessage(studioId, id, q.type)
  }

  @Post(':id/send')
  @HttpCode(200)
  send(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.selections.send(studioId, id, 'invite')
  }

  @Post(':id/remind')
  @HttpCode(200)
  remind(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.selections.send(studioId, id, 'reminder')
  }

  @Post(':id/mark-shared')
  @HttpCode(200)
  markShared(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.selections.markShared(studioId, id)
  }

  @Get(':id/export')
  @ApiQuery({ name: 'format', enum: ['csv', 'txt'], required: false })
  async export(
    @StudioId() studioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zod(exportQuery)) q: z.output<typeof exportQuery>,
    @Res() res: Response,
  ) {
    const out = await this.selections.export(studioId, id, q.format)
    res.setHeader('Content-Type', out.contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`)
    res.send(out.body)
  }
}

@ApiTags('public')
@Public()
@PublicThrottle()
@Controller('public/selections')
export class PublicSelectionsController {
  constructor(
    private readonly selections: SelectionsService,
    private readonly files: FilesService,
  ) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.selections.publicView(token)
  }

  @Get(':token/photos/:photoId')
  async photo(@Param('token') token: string, @Param('photoId', ParseUUIDPipe) photoId: string, @Res() res: Response) {
    const file = await this.selections.publicPhotoFile(token, photoId)
    await this.files.send(res, file)
  }

  @Post(':token/picks')
  @HttpCode(200)
  @ApiZodBody(pickSchema.extend({ picked: z.boolean() }))
  pick(@Param('token') token: string, @Body(zod(pickSchema.extend({ picked: z.boolean() }))) body: z.output<typeof pickSchema> & { picked: boolean }) {
    return this.selections.setPick(token, body)
  }

  @Post(':token/comments')
  @ApiZodBody(commentSchema)
  comment(@Param('token') token: string, @Body(zod(commentSchema)) body: z.output<typeof commentSchema>) {
    return this.selections.comment(token, body)
  }

  @Post(':token/submit')
  @HttpCode(200)
  @ApiZodBody(submitSelectionSchema)
  submit(@Param('token') token: string, @Body(zod(submitSelectionSchema)) body: z.output<typeof submitSelectionSchema>) {
    return this.selections.submit(token, body.memberId)
  }
}
