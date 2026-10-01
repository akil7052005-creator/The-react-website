import { z } from 'zod'

export const uuidSchema = z.uuid('Invalid id')

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional().transform((v) => v || undefined),
  status: z.string().trim().max(40).optional().transform((v) => v || undefined),
  sort: z
    .string()
    .trim()
    .regex(/^-?[a-zA-Z]+$/, 'Invalid sort')
    .optional(),
})
export type ListQuery = z.output<typeof listQuerySchema>

/** multipart/form-data sends booleans as strings. */
export const booleanish = z.preprocess((v) => {
  if (v === 'true' || v === '1' || v === 'on') return true
  if (v === 'false' || v === '0' || v === '' || v === 'off') return false
  return v
}, z.boolean())

export const idListSchema = z.object({
  ids: z.array(uuidSchema).min(1, 'Nothing to reorder').max(500),
})

/** A required react-select value: empty means "not chosen yet". */
export const requiredId = (what: string) => z.uuid(`Select ${what}`)
