import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface'
import { memoryStorage } from 'multer'

/**
 * Multer keeps the upload in memory (one file per request) so we can sniff the
 * real type before anything touches the disk. The hard limit here is a safety
 * net; FilesService applies the precise per-kind limit with a friendly message.
 */
export function uploadOptions(maxMb: number): MulterOptions {
  return {
    storage: memoryStorage(),
    limits: { fileSize: Math.ceil(maxMb * 1024 * 1024) + 1, files: 1, fields: 30 },
  }
}
