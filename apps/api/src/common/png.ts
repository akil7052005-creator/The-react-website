import { deflateSync } from 'zlib'

// Minimal PNG encoder used by the seed (placeholder gallery photos) and the
// tests (valid image uploads). Draws a soft two-tone gradient for a hue.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

export function gradientPng(width: number, height: number, hue: number, seed = 0): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  const [r1, g1, b1] = hslToRgb(hue % 360, 0.45, 0.32)
  const [r2, g2, b2] = hslToRgb((hue + 35) % 360, 0.55, 0.78)
  // A soft "sun" highlight gives each placeholder a different composition.
  const cx = width * (0.25 + ((seed * 37) % 50) / 100)
  const cy = height * (0.3 + ((seed * 53) % 40) / 100)
  const radius = Math.min(width, height) * 0.45
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x++) {
      const t = (x / width) * 0.4 + (y / height) * 0.6
      const d = Math.hypot(x - cx, y - cy) / radius
      const glow = Math.max(0, 1 - d) * 0.35
      const i = row + 1 + x * 3
      raw[i] = Math.min(255, Math.round(r1 + (r2 - r1) * t + 255 * glow))
      raw[i + 1] = Math.min(255, Math.round(g1 + (g2 - g1) * t + 220 * glow))
      raw[i + 2] = Math.min(255, Math.round(b1 + (b2 - b1) * t + 180 * glow))
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
