import { z } from 'zod'
import { BILLING_CYCLES, CREDIT_PACKS, GST_RATES, PAYMENT_METHODS, PLAN_CODES } from '../enums'
import { computeInvoiceTotals } from '../gst'
import { toPaise } from '../money'
import { amountSchema, dateSchema, optionalText, requiredText, todayIST } from '../validators'
import { requiredId, uuidSchema } from './common'
import { stateCodeSchema } from './studio'

export const invoiceItemSchema = z.object({
  description: requiredText('Description', 200, 2),
  sac: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'SAC must be 4–8 digits'),
  qty: z.coerce
    .number({ error: 'Enter a quantity' })
    .int('Quantity must be a whole number')
    .min(1, 'Quantity must be at least 1')
    .max(10_000, 'Quantity is too large'),
  rate: amountSchema,
  gstRate: z.coerce
    .number()
    .refine((n) => (GST_RATES as readonly number[]).includes(n), 'Select a GST rate'),
})
export type InvoiceItemInput = z.input<typeof invoiceItemSchema>

export const milestoneSchema = z.object({
  label: requiredText('Milestone', 80),
  amount: amountSchema,
  dueDate: dateSchema,
})

const invoiceBase = z.object({
  clientId: requiredId('a client'),
  eventId: z.preprocess((v) => (v === '' || v === null ? undefined : v), uuidSchema.optional()),
  issueDate: dateSchema,
  dueDate: dateSchema,
  placeOfSupply: stateCodeSchema,
  items: z.array(invoiceItemSchema).min(1, 'Add at least one line item').max(50, 'At most 50 line items'),
  milestones: z.array(milestoneSchema).max(10, 'At most 10 milestones').default([]),
  notes: optionalText(1000),
})

/**
 * The milestone check needs the invoice total, which depends on whether the
 * studio's state equals the place of supply — so the schema is built per studio.
 */
export function makeInvoiceSchema(studioStateCode: string | null | undefined) {
  return invoiceBase.superRefine((v, ctx) => {
    if (v.dueDate && v.issueDate && v.dueDate < v.issueDate) {
      ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'Due date must be on or after the issue date' })
    }
    if (v.milestones.length > 0 && v.items.length > 0) {
      const totals = computeInvoiceTotals(
        v.items.map((i) => ({ qty: i.qty, ratePaise: toPaise(i.rate), gstRate: i.gstRate })),
        studioStateCode,
        v.placeOfSupply,
      )
      const sum = v.milestones.reduce((s, m) => s + toPaise(m.amount), 0)
      if (sum !== totals.totalPaise) {
        ctx.addIssue({
          code: 'custom',
          path: ['milestones'],
          message: `Milestones add up to ₹${(sum / 100).toLocaleString('en-IN')} but the invoice total is ₹${(
            totals.totalPaise / 100
          ).toLocaleString('en-IN')}`,
        })
      }
    }
  })
}
export type InvoiceInput = z.input<typeof invoiceBase>
export type InvoiceOutput = z.output<typeof invoiceBase>

export const recordPaymentSchema = z.object({
  amount: amountSchema,
  method: z.enum(PAYMENT_METHODS, { error: 'Select a payment method' }),
  paidOn: dateSchema.refine((v) => v <= todayIST(), 'Payment date cannot be in the future'),
  reference: optionalText(80),
})
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>

export const changePlanSchema = z.object({
  planCode: z.enum(PLAN_CODES, { error: 'Select a plan' }),
  cycle: z.enum(BILLING_CYCLES),
  couponCode: z
    .string()
    .trim()
    .toUpperCase()
    .max(40)
    .optional()
    .transform((v) => v || undefined),
})
export type ChangePlanInput = z.input<typeof changePlanSchema>

export const buyCreditsSchema = z.object({
  packCode: z.enum(CREDIT_PACKS.map((p) => p.code) as [string, ...string[]], { error: 'Select a pack' }),
})
export type BuyCreditsInput = z.input<typeof buyCreditsSchema>

// SUPER_ADMIN plan editing
export const planLimitsSchema = z.object({
  eventsPerMonth: z.number().int().min(0).nullable(),
  albums: z.number().int().min(0).nullable(),
  storageGb: z.number().int().min(1).nullable(),
  teamSeats: z.number().int().min(1),
  includedCredits: z.number().int().min(0),
  // Photo upload limits (optional: a plan without them uses the Starter values).
  maxPhotoMb: z.number().int().min(1, 'At least 1 MB').max(100, 'At most 100 MB').optional(),
  maxFilesPerUpload: z.number().int().min(1).max(10_000, 'At most 10,000').optional(),
  uploadConcurrency: z.number().int().min(1).max(8, 'At most 8').optional(),
  // Trial / Pro / VIP quota (see plans.ts). null = no limit.
  eventsTotal: z.number().int().min(0).nullable().optional(),
  fairUseEventsPerMonth: z.number().int().min(0).nullable().optional(),
  photosPerEvent: z.number().int().min(1).nullable().optional(),
  uploadGbPerMonth: z.number().min(0).nullable().optional(),
  uploadGbTotal: z.number().min(0).nullable().optional(),
  trialDays: z.number().int().min(1).max(365).nullable().optional(),
  galleryDays: z.number().int().min(1).max(365).nullable().optional(),
  addonEvents: z.number().int().min(1).nullable().optional(),
  addonEventsPricePaise: z.number().int().min(0).nullable().optional(),
  favourites: z.boolean().optional(),
})
export type PlanLimits = z.output<typeof planLimitsSchema>

export const updatePlanSchema = z.object({
  name: requiredText('Plan name', 40),
  tagline: requiredText('Tagline', 80),
  monthlyPrice: amountSchema.nullable(),
  /** null for a free plan (Trial). */
  yearlyPrice: amountSchema.nullable(),
  /** Price of each billing period (rupees → paise like the others); null = not offered. */
  prices: z.object({ MONTHLY: amountSchema.nullable(), QUARTERLY: amountSchema.nullable(), HALF_YEARLY: amountSchema.nullable(), YEARLY: amountSchema.nullable() }).partial().optional(),
  limits: planLimitsSchema,
  features: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  // Must be features of this plan; shown with a "Coming soon" tag instead of a check mark.
  comingSoon: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  popular: z.boolean(),
  isActive: z.boolean(),
}).superRefine((v, ctx) => {
  const unknown = v.comingSoon.filter((f) => !v.features.includes(f))
  if (unknown.length) {
    ctx.addIssue({ code: 'custom', path: ['comingSoon'], message: `Not a feature of this plan: ${unknown.join(', ')}` })
  }
})
