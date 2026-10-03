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
  Put,
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
  selectionAccessSchema,
  selectionDefaultsSchema,
  selectionFolderSchema,
  selectionPinSchema,
  submitSelectionSchema,
  unlockSelectionSchema,
  updateSelectionSchema,
  type ListQuery,
} from '@weddyzone/shared'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { Public, StudioId } from '../auth/auth.decorators'
import { PublicThrottle } from '../common/throttle'
import { ApiListQuery, ApiZodBody, zod } from '../common/zod'
import { config } from '../config'
import { FilesService, type UploadedFile as Upload } from '../core/files.service'
import { keyFrom } from './gallery-access'
import { SelectionWorkflowService } from './selection-workflow.service'
import { SelectionsService } from './selections.service'
import { cleanFolder, PlanUploadInterceptor, type UploadRequest } from './upload-limits'

const kindQuery = z.object({ type: z.enum(['invite', 'reminder']).default('reminder') })
const exportQuery = z.object({ format: z.enum(['csv', 'txt']).default('csv') })
const zipQuery = z.object({ scope: z.enum(['picked', 'all']).default('picked'), folderId: z.string().uuid().optional() })
const moveSchema = z.object({ photoIds: z.array(z.string().uuid()).min(1).max(5000), folderId: z.string().uuid() })
const uuidOrNull = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null)

@ApiTags('selections')
@Controller('selections')
export class SelectionsController {
  constructor(
    private readonly selections: SelectionsService,
    private readonly workflow: SelectionWorkflowService,
    private readonly files: FilesService,
  ) {}

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
    const body = (req.body ?? {}) as Record<string, unknown>
    return this.selections.addPhoto(studioId, id, file, { limits: req.uploadLimits, folder: cleanFolder(body.folder), folderId: uuidOrNull(body.folderId) })
  }

  /** Everything the event page shows: the selection, folders with counts, notes, log and albums. */
  @Get(':id/overview')
  overview(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflow.overview(studioId, id)
  }

  @Get(':id/folders')
  folders(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflow.folders(studioId, id)
  }

  @Post(':id/folders')
  @ApiZodBody(selectionFolderSchema)
  createFolder(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Body(zod(selectionFolderSchema)) body: z.output<typeof selectionFolderSchema>) {
    return this.workflow.createFolder(studioId, id, body.name)
  }

  @Patch(':id/folders/:folderId')
  @ApiZodBody(selectionFolderSchema)
  renameFolder(
    @StudioId() studioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Body(zod(selectionFolderSchema)) body: z.output<typeof selectionFolderSchema>,
  ) {
    return this.workflow.renameFolder(studioId, id, folderId, body.name)
  }

  @Delete(':id/folders/:folderId')
  deleteFolder(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Param('folderId', ParseUUIDPipe) folderId: string) {
    return this.workflow.deleteFolder(studioId, id, folderId)
  }

  @Post(':id/photos/move')
  @HttpCode(200)
  @ApiZodBody(moveSchema)
  movePhotos(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Body(zod(moveSchema)) body: z.output<typeof moveSchema>) {
    return this.workflow.movePhotos(studioId, id, body.photoIds, body.folderId)
  }

  /** PIN, client downloads, watermark and notes. */
  @Patch(':id/access')
  @ApiZodBody(selectionAccessSchema)
  access(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Body(zod(selectionAccessSchema)) body: z.output<typeof selectionAccessSchema>) {
    return this.workflow.updateAccess(studioId, id, body)
  }

  @Post(':id/unlock')
  @HttpCode(200)
  @ApiZodBody(unlockSelectionSchema)
  unlock(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Body(zod(unlockSelectionSchema)) body: z.output<typeof unlockSelectionSchema>) {
    return this.workflow.unlock(studioId, id, body.reason)
  }

  @Post(':id/reset-picks')
  @HttpCode(200)
  resetPicks(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflow.resetPicks(studioId, id)
  }

  @Post(':id/deliver')
  @HttpCode(200)
  deliver(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflow.markDelivered(studioId, id)
  }

  /** Original photos as a ZIP (picked only by default), optionally one folder. */
  @Get(':id/zip')
  @ApiQuery({ name: 'scope', enum: ['picked', 'all'], required: false })
  @ApiQuery({ name: 'folderId', required: false })
  zip(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Query(zod(zipQuery)) q: z.output<typeof zipQuery>, @Res() res: Response) {
    return this.workflow.streamZip(studioId, id, q.scope, q.folderId, res)
  }

  @Get(':id/photos/:photoId/preview')
  async photoPreview(
    @StudioId() studioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Res() res: Response,
  ) {
    await this.files.send(res, await this.selections.studioPreview(studioId, id, photoId))
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
  view(@Param('token') token: string, @Req() req: Request) {
    return this.selections.publicView(token, keyFrom(req))
  }

  /** Checks the gallery PIN and returns the access key. Tight per-IP limit on top of the lockout. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':token/pin')
  @HttpCode(200)
  @ApiZodBody(selectionPinSchema)
  pin(@Param('token') token: string, @Body(zod(selectionPinSchema)) body: z.output<typeof selectionPinSchema>) {
    return this.selections.enterPin(token, body.pin)
  }

  /** The client preview (resized, watermarked when set). Never the original. */
  @Get(':token/photos/:photoId')
  async photo(@Param('token') token: string, @Param('photoId', ParseUUIDPipe) photoId: string, @Req() req: Request, @Res() res: Response) {
    const file = await this.selections.publicPhotoFile(token, photoId, keyFrom(req))
    await this.files.send(res, file)
  }

  /** The original file, only when the studio allows downloads. */
  @Get(':token/photos/:photoId/download')
  async download(@Param('token') token: string, @Param('photoId', ParseUUIDPipe) photoId: string, @Req() req: Request, @Res() res: Response) {
    const file = await this.selections.publicPhotoFile(token, photoId, keyFrom(req), { download: true })
    await this.files.send(res, file, { download: true })
  }

  @Post(':token/picks')
  @HttpCode(200)
  @ApiZodBody(pickSchema.extend({ picked: z.boolean() }))
  pick(
    @Param('token') token: string,
    @Body(zod(pickSchema.extend({ picked: z.boolean() }))) body: z.output<typeof pickSchema> & { picked: boolean },
    @Req() req: Request,
  ) {
    return this.selections.setPick(token, body, keyFrom(req))
  }

  @Post(':token/comments')
  @ApiZodBody(commentSchema)
  comment(@Param('token') token: string, @Body(zod(commentSchema)) body: z.output<typeof commentSchema>, @Req() req: Request) {
    return this.selections.comment(token, body, keyFrom(req))
  }

  @Post(':token/submit')
  @HttpCode(200)
  @ApiZodBody(submitSelectionSchema)
  submit(@Param('token') token: string, @Body(zod(submitSelectionSchema)) body: z.output<typeof submitSelectionSchema>, @Req() req: Request) {
    return this.selections.submit(token, body.memberId, keyFrom(req))
  }
}

/** Studio-wide defaults for new selections. */
@ApiTags('selections')
@Controller('studio/selection-defaults')
export class SelectionDefaultsController {
  constructor(private readonly workflow: SelectionWorkflowService) {}

  @Get()
  get(@StudioId() studioId: string) {
    return this.workflow.defaults(studioId)
  }

  @Put()
  @ApiZodBody(selectionDefaultsSchema)
  save(@StudioId() studioId: string, @Body(zod(selectionDefaultsSchema)) body: z.output<typeof selectionDefaultsSchema>) {
    return this.workflow.saveDefaults(studioId, body)
  }
}
