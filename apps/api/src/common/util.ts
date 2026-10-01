import { randomBytes, createHash } from 'crypto'
import type { Paginated, ListQuery } from '@weddyzone/shared'
import type { Tx } from '../prisma/prisma.service'

/** "2026-10-12" → Date at UTC midnight, matching Postgres DATE columns. */
export function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

/** Date from a DATE column → "2026-10-12". */
export function toIso(d: Date): string
export function toIso(d: Date | null | undefined): string | null
export function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export function paginate<T>(data: T[], total: number, q: Pick<ListQuery, 'page' | 'limit'>): Paginated<T> {
  return { data, meta: { page: q.page, limit: q.limit, total } }
}

export function skipTake(q: Pick<ListQuery, 'page' | 'limit'>) {
  return { skip: (q.page - 1) * q.limit, take: q.limit }
}

/**
 * Maps ?sort=-date to a Prisma orderBy, allowing only whitelisted fields.
 * Falls back to `fallback` for unknown fields.
 */
export function orderBy<T extends string>(
  sort: string | undefined,
  allowed: readonly T[],
  fallback: Partial<Record<T, 'asc' | 'desc'>>,
): Partial<Record<T, 'asc' | 'desc'>> {
  if (!sort) return fallback
  const desc = sort.startsWith('-')
  const field = (desc ? sort.slice(1) : sort) as T
  if (!allowed.includes(field)) return fallback
  return { [field]: desc ? 'desc' : 'asc' } as Partial<Record<T, 'asc' | 'desc'>>
}

/**
 * Next number in a per-studio sequence, atomically (row lock on the counter).
 * `start` is the value returned for the very first call.
 */
export async function nextSequence(tx: Tx, studioId: string, key: string, start = 1): Promise<number> {
  const row = await tx.counter.upsert({
    where: { studioId_key: { studioId, key } },
    create: { studioId, key, value: start },
    update: { value: { increment: 1 } },
  })
  return row.value
}

export function daysBetween(fromIso: string, toIsoDate: string): number {
  return Math.round((toDate(toIsoDate).getTime() - toDate(fromIso).getTime()) / 86_400_000)
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'studio'
  )
}

export function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/** Today (IST) as a DATE-column value. */
export function todayDate(): Date {
  return toDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()))
}
