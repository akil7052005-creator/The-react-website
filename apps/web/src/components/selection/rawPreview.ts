// RAW camera files (CR2, CR3, NEF, ARW, DNG…) can't be shown by browsers, but almost all of them
// carry a full-size JPEG preview made by the camera. These helpers find JPEG streams inside the
// file's bytes; the caller tries to decode the likeliest ones and keeps the first that works.

/**
 * Candidate JPEG streams in `bytes` as [start, end) ranges, longest first. A stream starts at an
 * SOI marker (FF D8 FF) and ends after an EOI marker (FF D9). A preview can hold a thumbnail with
 * its own EOI, so each start is paired with the first few EOIs after it.
 */
export function jpegCandidates(bytes: Uint8Array, maxEndsPerStart = 4, limit = 24): [number, number][] {
  const starts: number[] = []
  const ends: number[] = []
  // To length - 1: an EOI can be the file's last two bytes.
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] !== 0xff) continue
    const b = bytes[i + 1]
    if (b === 0xd8 && i + 2 < bytes.length && bytes[i + 2] === 0xff) starts.push(i)
    else if (b === 0xd9) ends.push(i + 2)
  }
  const out: [number, number][] = []
  let e = 0
  for (const s of starts) {
    while (e < ends.length && ends[e] <= s) e++
    for (let k = e; k < Math.min(ends.length, e + maxEndsPerStart); k++) out.push([s, ends[k]])
  }
  // Tiny ones are thumbnails; the camera's preview is the biggest stream that decodes.
  return out.filter(([s, x]) => x - s > 2048).sort((a, b) => b[1] - b[0] - (a[1] - a[0])).slice(0, limit)
}
