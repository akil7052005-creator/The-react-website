import { describe, expect, it } from 'vitest'
import { eventSettingsPatchSchema, selectionFolderSchema } from './schemas/events'
import { profileSchema } from './schemas/studio'
import { cleanFolderName, DEFAULT_SELECTION_DEFAULTS, resolveStoredSettings, videoFolderName, watermarkBox } from './selection'

describe('watermarkBox (server and live preview share it)', () => {
  const photo = { width: 1000, height: 500 }
  const mark = { width: 200, height: 100 }
  it('sizes the mark as % of the photo width, keeping its shape', () => {
    expect(watermarkBox(photo, mark, { position: 'center', sizePct: 20, spacingPct: 0 })).toEqual({ left: 400, top: 200, width: 200, height: 100 })
  })
  it('keeps the spacing from the nearest edges', () => {
    expect(watermarkBox(photo, mark, { position: 'bottom-right', sizePct: 20, spacingPct: 2 })).toEqual({ left: 780, top: 390, width: 200, height: 100 })
    expect(watermarkBox(photo, mark, { position: 'top-left', sizePct: 20, spacingPct: 2 })).toMatchObject({ left: 20, top: 10 })
    expect(watermarkBox(photo, mark, { position: 'top-center', sizePct: 20, spacingPct: 2 })).toMatchObject({ left: 400, top: 10 })
  })
  it('never leaves the photo', () => {
    const b = watermarkBox({ width: 100, height: 40 }, { width: 10, height: 30 }, { position: 'bottom-left', sizePct: 50, spacingPct: 20 })
    expect(b.top).toBeGreaterThanOrEqual(0)
    expect(b.height).toBeLessThanOrEqual(40)
  })
})

describe('event settings', () => {
  it('fills in defaults and clamps bad values', () => {
    expect(resolveStoredSettings(null)).toMatchObject({
      allowClientView: true,
      downloadAllFolder: false,
      instagramFollow: false,
      favoriteOption: true,
      watermark: { logoFileId: null, position: 'bottom-right', sizePct: 20, spacingPct: 2, opacityPct: 80 },
    })
    expect(resolveStoredSettings({ watermark: { sizePct: 99, position: 'nowhere', opacityPct: 1 } }).watermark).toMatchObject({ sizePct: 50, position: 'bottom-right', opacityPct: 10 })
  })
  it('validates a settings change', () => {
    expect(eventSettingsPatchSchema.safeParse({ galleryExpiry: 12 }).success).toBe(false)
    expect(eventSettingsPatchSchema.parse({ galleryExpiry: null, watermark: { sizePct: '30' } })).toEqual({ galleryExpiry: null, watermark: { sizePct: 30 } })
    expect(eventSettingsPatchSchema.safeParse({ watermark: { position: 'middle' } }).success).toBe(false)
  })
  it('notes start off for new events', () => {
    expect(DEFAULT_SELECTION_DEFAULTS.notesAllowed).toBe(false)
  })
})

describe('folders and the Instagram handle', () => {
  it('folders are photo by default, at most 255 characters, the exact name kept', () => {
    expect(selectionFolderSchema.parse({ name: 'Haldi' })).toEqual({ name: 'Haldi', type: 'photo' })
    expect(selectionFolderSchema.parse({ name: 'Clips', type: 'video' }).type).toBe('video')
    const exact = 'Haldi Ceremony – Bride Side (Cam 1) – 25 Nov 2026 Morning Session'
    expect(selectionFolderSchema.parse({ name: `  ${exact} ` }).name).toBe(exact)
    expect(selectionFolderSchema.safeParse({ name: 'x'.repeat(255) }).success).toBe(true)
    expect(selectionFolderSchema.safeParse({ name: 'x'.repeat(256) }).success).toBe(false)
  })
  it('cleans a picked folder name: ends trimmed, the first 255 characters, no split characters', () => {
    expect(cleanFolderName('  திருமணம் [Day 2] v1.0  ')).toBe('திருமணம் [Day 2] v1.0')
    expect(cleanFolderName('a'.repeat(300))).toBe('a'.repeat(255))
    // An emoji is two code units: never cut in half.
    expect(cleanFolderName(`${'a'.repeat(254)}📸 more`)).toBe('a'.repeat(254))
    expect(videoFolderName('Sangeet')).toBe('Sangeet Videos')
    expect(videoFolderName('z'.repeat(255))).toBe(`${'z'.repeat(248)} Videos`)
  })
  it('trims an Instagram URL or @ to the handle', () => {
    const base = { studioName: 'Studio', ownerName: 'Owner', email: 'a@b.co', phone: '9840012345', city: 'Chennai', stateCode: '33' }
    const parse = (instagramHandle: string) => profileSchema.safeParse({ ...base, instagramHandle })
    expect(parse('https://www.instagram.com/golden.hour/?hl=en')).toMatchObject({ success: true, data: { instagramHandle: 'golden.hour' } })
    expect(parse('@golden_hour')).toMatchObject({ success: true, data: { instagramHandle: 'golden_hour' } })
    expect(parse('not a handle!').success).toBe(false)
  })
})
