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
  // WebM (Matroska/EBML header).
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { mime: 'video/webm', ext: 'webm' }
  }
  // ISO media: "ftyp" at byte 4, then the brand. QuickTime (.mov) or MP4; HEIF stills are not videos.
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12)
    if (brand === 'qt  ') return { mime: 'video/quicktime', ext: 'mov' }
    if (!/^(heic|heix|hevc|hevx|mif1|msf1|avif)$/.test(brand)) return { mime: 'video/mp4', ext: 'mp4' }
  }
  return null
}

export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp']
/** Photo Selection also takes event videos. */
export const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm']
export const isVideoMime = (mime: string) => mime.startsWith('video/')
export const ATTACHMENT_MIMES = [...IMAGE_MIMES, 'application/pdf']
