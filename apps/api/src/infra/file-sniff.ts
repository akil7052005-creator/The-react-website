// Detects the real file type from its first bytes, so a renamed .exe cannot
// pass as a .jpg. Only the formats we accept are recognised.

export type SniffedType = { mime: string; ext: string }

export function sniff(buf: Buffer): SniffedType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' }
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' }
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' }
  }
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') {
    return { mime: 'application/pdf', ext: 'pdf' }
  }
  return null
}

export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp']
export const ATTACHMENT_MIMES = [...IMAGE_MIMES, 'application/pdf']
