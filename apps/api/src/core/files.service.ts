import { Injectable } from '@nestjs/common'
import type { FileKind, StoredFile } from '@prisma/client'
import type { Response } from 'express'
import { fileInvalid, notFound } from '../common/errors'
import { sha256 } from '../common/util'
import { config } from '../config'
import { ATTACHMENT_MIMES, IMAGE_MIMES, sniff } from '../infra/file-sniff'
import { StorageService } from '../infra/storage.service'
import { PrismaService, type Tx } from '../prisma/prisma.service'
import { UsageService } from './usage.service'

export interface UploadedFile {
  buffer: Buffer
  originalname: string
  size: number
}

const MB = 1024 * 1024

// URL builders — the web app prefixes them with the API origin.
export const fileUrls = {
  studio: (fileId: string) => `/api/v1/files/${fileId}`,
  public: (fileId: string) => `/api/v1/public/files/${fileId}`,
  selectionPhoto: (token: string, photoId: string) => `/api/v1/public/selections/${token}/photos/${photoId}`,
  albumPhoto: (token: string, photoId: string) => `/api/v1/public/albums/${token}/photos/${photoId}`,
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly usage: UsageService,
  ) {}

  rules(kind: FileKind): { maxBytes: number; mimes: string[]; label: string } {
    const c = config()
    switch (kind) {
      case 'PHOTO':
        return { maxBytes: c.MAX_PHOTO_MB * MB, mimes: IMAGE_MIMES, label: `JPEG, PNG or WebP up to ${c.MAX_PHOTO_MB} MB` }
      case 'BANNER':
        return { maxBytes: c.MAX_BANNER_MB * MB, mimes: IMAGE_MIMES, label: `JPEG, PNG or WebP up to ${c.MAX_BANNER_MB} MB` }
      case 'LOGO':
        return { maxBytes: 2 * MB, mimes: IMAGE_MIMES, label: 'JPEG, PNG or WebP up to 2 MB' }
      case 'ATTACHMENT':
        return { maxBytes: 10 * MB, mimes: ATTACHMENT_MIMES, label: 'an image or PDF up to 10 MB' }
    }
  }

  /** Validates bytes (type by content, not extension), size and storage quota, then stores the file. */
  async validate(studioId: string, kind: FileKind, file: UploadedFile | undefined, field = 'file') {
    if (!file || !file.buffer?.length) throw fileInvalid('Please choose a file to upload', field)
    const rules = this.rules(kind)
    if (file.size > rules.maxBytes) {
      throw fileInvalid(`${file.originalname} is too large — upload ${rules.label}`, field)
    }
    const type = sniff(file.buffer)
    if (!type || !rules.mimes.includes(type.mime)) {
      throw fileInvalid(`${file.originalname} is not a supported file — upload ${rules.label}`, field)
    }
    await this.usage.assertStorage(studioId, file.size)
    return { type, checksum: sha256(file.buffer) }
  }

  async store(
    studioId: string,
    kind: FileKind,
    file: UploadedFile | undefined,
    field = 'file',
    db: Tx | PrismaService = this.prisma,
  ): Promise<StoredFile> {
    const { type, checksum } = await this.validate(studioId, kind, file, field)
    const key = await this.storage.save(file!.buffer, type.ext, type.mime)
    return db.storedFile.create({
      data: {
        studioId,
        kind,
        storageKey: key,
        originalName: file!.originalname.slice(0, 200),
        mimeType: type.mime,
        size: file!.size,
        checksum,
      },
    })
  }

  async softDelete(fileId: string) {
    await this.prisma.storedFile.update({ where: { id: fileId }, data: { deletedAt: new Date() } })
  }

  /** Streams a stored file. Callers must have checked access first. */
  async send(res: Response, file: StoredFile, opts: { cache?: 'private' | 'public'; download?: boolean } = {}) {
    if (file.deletedAt) throw notFound('File')
    const stream = await this.storage.open(file.storageKey)
    if (!stream) throw notFound('File')
    res.setHeader('Content-Type', file.mimeType)
    res.setHeader('Content-Length', String(file.size))
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', `${opts.cache ?? 'private'}, max-age=86400`)
    const safeName = file.originalName.replace(/[^\w.\- ]/g, '_')
    res.setHeader('Content-Disposition', `${opts.download ? 'attachment' : 'inline'}; filename="${safeName}"`)
    // Headers are already sent if the storage stream fails midway; just end the response.
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  }
}
