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
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiConsumes, ApiQuery, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import {
  clientItemPatchSchema,
  clientVerifySchema,
  commentSchema,
  createSelectionSchema,
  eventDetailsSchema,
  eventSettingsPatchSchema,
  listQuerySchema,
  markSentSchema,
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
import { ClientSelectionService, clientTokenFrom } from './client-selection.service'
import { EventSettingsService, LOGO_MAX_BYTES } from './event-settings.service'
import { keyFrom } from './gallery-access'
import { SelectionWorkflowService } from './selection-workflow.service'
import { SelectionsService } from './selections.service'
import { cleanFolder, originalMeta, PlanUploadInterceptor, type UploadRequest } from './upload-limits'

const kindQuery = z.object({ type: z.enum(['invite', 'reminder']).default('reminder') })
const exportQuery = z.object({ format: z.enum(['csv', 'txt']).default('csv') })
const zipQuery = z.object({ scope: z.enum(['picked', 'all']).default('picked'), folderId: z.string().uuid().optional() })
const resetSchema = z.object({ mode: z.enum(['shortlist', 'reject']).default('reject') })
const moveSchema =z.object({ photoIds: z.array(z.string().uuid()).min(1).max(5000), folderId: z.string().uuid() })
const uuidOrNull = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null)

@ApiTags('selections')
@Controller('selections')
export class SelectionsController {
  constructor(
    private readonly selections: SelectionsService,
    private readonly workflow: SelectionWorkflowService,
    private readonly eventSettings: EventSettingsService,
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

  /** "Add Photo Selection → Event Details": customer, event name and limit in one step. */
  @Post('details')
  @ApiZodBody(eventDetailsSchema)
  createFromDetails(@StudioId() studioId: string, @Body(zod(eventDetailsSchema)) body: z.output<typeof eventDetailsSchema>) {
    return this.selections.createFromDetails(studioId, body)
  }

  /** Manage: edit the customer, event name and limit. */
  @Put(':id/details')
  @ApiZodBody(eventDetailsSchema)
  updateDetails(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Body(zod(eventDetailsSchema)) body: z.output<typeof eventDetailsSchema>) {
    return this.selections.updateDetails(studioId, id, body)
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
    return this.selections.addPhoto(studioId, id, file, {
      limits: req.uploadLimits,
      folder: cleanFolder(body.folder),
      folderId: uuidOrNull(body.folderId),
      original: originalMeta(body),
    })
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
    return this.workflow.createFolder(studioId, id, body.name, body.type)
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

  /** Photo Selection settings for this event (the settings page). */
  @Get(':id/settings')
  settings(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.eventSettings.get(studioId, id)
  }

  @Patch(':id/settings')
  @ApiZodBody(eventSettingsPatchSchema)
  patchSettings(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Body(zod(eventSettingsPatchSchema)) body: z.output<typeof eventSettingsPatchSchema>) {
    return this.eventSettings.patch(studioId, id, body)
  }

  /** The watermark logo (PNG, JPG or SVG, up to 2 MB). */
  @Post(':id/settings/logo')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES + 1024 } }))
  uploadLogo(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Upload | undefined) {
    return this.eventSettings.uploadLogo(studioId, id, file)
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

  /** Reset Selection: { mode: 'shortlist' } keeps the picks and reopens; 'reject' (default) clears them. */
  @Post(':id/reset-picks')
  @HttpCode(200)
  @ApiZodBody(resetSchema)
  resetPicks(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Body(zod(resetSchema)) body: z.output<typeof resetSchema>) {
    return this.workflow.resetPicks(studioId, id, body.mode)
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

  /** Send Options: records which card's WhatsApp message was opened (the browser opens WhatsApp itself). */
  @Patch(':id/sent')
  @ApiZodBody(markSentSchema)
  markSent(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string, @Body(zod(markSentSchema)) body: z.output<typeof markSentSchema>) {
    return this.selections.markSent(studioId, id, body.via)
  }

  /** Gives an older selection (SEL-… code) a 6-digit code the customer app accepts. */
  @Post(':id/new-code')
  @HttpCode(200)
  renewCode(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.selections.renewCode(studioId, id)
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

  /**
   * A download, only when the studio allows downloads: the original or a 1600 px copy (Original
   * Quality), watermarked when the event's watermark is on.
   */
  @Get(':token/photos/:photoId/download')
  async download(@Param('token') token: string, @Param('photoId', ParseUUIDPipe) photoId: string, @Req() req: Request, @Res() res: Response) {
    const out = await this.selections.publicDownload(token, photoId, keyFrom(req))
    if (!out.buffer) return this.files.send(res, out.file, { download: true })
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Content-Length', String(out.buffer.length))
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Disposition', `attachment; filename="${(out.name ?? 'photo.jpg').replace(/[^\w.\- ]/g, '_')}"`)
    res.end(out.buffer)
  }

  /** "Download All Folder": the folder's photos as a ZIP. */
  @Get(':token/folders/:folderId/zip')
  folderZip(@Param('token') token: string, @Param('folderId', ParseUUIDPipe) folderId: string, @Req() req: Request, @Res() res: Response) {
    return this.selections.publicFolderZip(token, folderId, keyFrom(req), res)
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

const pageQuery = z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1) })

/** The customer portal: a 6-digit code gives a short-lived token for one selection (X-Client-Token or ?t=). */
@ApiTags('public')
@Public()
@PublicThrottle()
@Controller('public/selection')
export class ClientSelectionController {
  constructor(private readonly client: ClientSelectionService) {}

  /** Tight per-IP limit (RATE_LIMIT_CODE_PER_MIN, 5 by default): codes are only six digits. */
  @Throttle({ default: { limit: config().RATE_LIMIT_CODE_PER_MIN, ttl: 60_000 } })
  @Post('verify')
  @HttpCode(200)
  @ApiZodBody(clientVerifySchema)
  verify(@Body(zod(clientVerifySchema)) body: z.output<typeof clientVerifySchema>) {
    return this.client.verify(body.code, body.pin, body.shareToken)
  }

  /** The share link's verification screen: studio, event name and any lockout. */
  @Get('link/:token')
  link(@Param('token') token: string) {
    return this.client.linkInfo(token)
  }

  @Get(':id')
  view(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.client.view(id, clientTokenFrom(req))
  }

  @Get(':id/folders/:folderId/items')
  @ApiQuery({ name: 'page', required: false })
  items(@Param('id', ParseUUIDPipe) id: string, @Param('folderId', ParseUUIDPipe) folderId: string, @Query(zod(pageQuery)) q: z.output<typeof pageQuery>, @Req() req: Request) {
    return this.client.items(id, clientTokenFrom(req), folderId, q.page)
  }

  /** The Selection tab: the picks grouped by album. */
  @Get(':id/selected')
  selected(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.client.selected(id, clientTokenFrom(req))
  }

  @Patch(':id/items/:itemId')
  @ApiZodBody(clientItemPatchSchema)
  patchItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(zod(clientItemPatchSchema)) body: z.output<typeof clientItemPatchSchema>,
    @Req() req: Request,
  ) {
    return this.client.patchItem(id, clientTokenFrom(req), itemId, body)
  }

  @Post(':id/submit')
  @HttpCode(200)
  submit(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.client.submit(id, clientTokenFrom(req))
  }

  /** Photo preview (watermarked when on) or the video, with byte ranges. */
  @Get(':id/items/:itemId/file')
  file(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request, @Res() res: Response) {
    return this.client.sendFile(id, clientTokenFrom(req), itemId, req, res)
  }

  @Get(':id/items/:itemId/download')
  download(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request, @Res() res: Response) {
    return this.client.download(id, clientTokenFrom(req), itemId, res)
  }

  @Get(':id/folders/:folderId/zip')
  folderZip(@Param('id', ParseUUIDPipe) id: string, @Param('folderId', ParseUUIDPipe) folderId: string, @Req() req: Request, @Res() res: Response) {
    return this.client.folderZip(id, clientTokenFrom(req), folderId, res)
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
