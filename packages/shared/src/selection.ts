// Photo Selection helpers shared by the API and the web app.

import type { SelectionDefaultsDto } from './types'

/** Used until the studio saves its own defaults. */
export const DEFAULT_SELECTION_DEFAULTS: SelectionDefaultsDto = {
  watermark: false,
  allowDownload: false,
  galleryDays: 30,
  notesAllowed: true,
}

/** The studio's saved defaults (stored as JSON), with anything missing or invalid filled in. */
export function resolveSelectionDefaults(raw: unknown): SelectionDefaultsDto {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const bool = (k: keyof SelectionDefaultsDto) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (DEFAULT_SELECTION_DEFAULTS[k] as boolean))
  const days = Number(r.galleryDays)
  return {
    watermark: bool('watermark'),
    allowDownload: bool('allowDownload'),
    notesAllowed: bool('notesAllowed'),
    galleryDays: Number.isInteger(days) && days >= 1 && days <= 365 ? days : DEFAULT_SELECTION_DEFAULTS.galleryDays,
  }
}

/** The usual wedding folders, offered when creating a folder. */
export const SUGGESTED_FOLDERS = ['Haldi', 'Mehendi', 'Wedding', 'Reception'] as const

/** "124 / 150 picked". */
export const pickedLabel = (picked: number, quota: number) => `${picked} / ${quota} picked`
