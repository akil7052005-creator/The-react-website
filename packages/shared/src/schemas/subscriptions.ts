import { z } from 'zod'
import { BILLING_CYCLES } from '../enums'
import { CANCEL_REASONS, SUBSCRIPTION_STATUSES } from '../subscriptions'
import { dateSchema, optionalText, requiredText } from '../validators'
import { listQuerySchema, uuidSchema } from './common'

const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v)

// ------------------------------------------------------------------ studio

export const cancelSubscriptionSchema = z.object({
  reason: z.enum(CANCEL_REASONS, { error: 'Tell us why you are cancelling' }),
  details: optionalText(500),
})
export type CancelSubscriptionInput = z.input<typeof cancelSubscriptionSchema>

export const autoRenewSchema = z.object({ autoRenew: z.boolean() })

// ------------------------------------------------------------------ admin

/** `attention` = in grace, payment failed, or the deadline is within 7 days. */
export const ADMIN_SUBSCRIPTION_TABS = ['all', 'attention', 'expiring', 'grace', 'expired', 'cancelled', 'failed'] as const
export type AdminSubscriptionTab = (typeof ADMIN_SUBSCRIPTION_TABS)[number]

export const adminSubscriptionQuerySchema = listQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  tab: z.preprocess(emptyToUndefined, z.enum(ADMIN_SUBSCRIPTION_TABS).default('all')),
  planId: z.preprocess(emptyToUndefined, uuidSchema.optional()),
  status: z.preprocess(emptyToUndefined, z.enum(SUBSCRIPTION_STATUSES).optional()),
  cycle: z.preprocess(emptyToUndefined, z.enum(BILLING_CYCLES).optional()),
  expiresFrom: z.preprocess(emptyToUndefined, dateSchema.optional()),
  expiresTo: z.preprocess(emptyToUndefined, dateSchema.optional()),
  // Deadline soonest first by default.
  sort: z.preprocess(emptyToUndefined, z.enum(['endDate', '-endDate', 'createdAt', '-createdAt', 'amount', '-amount', 'studio', '-studio']).default('endDate')),
})
export type AdminSubscriptionQuery = z.output<typeof adminSubscriptionQuerySchema>

const adminNote = requiredText('A note', 500, 3)

export const extendSubscriptionSchema = z.object({
  days: z.coerce
    .number({ error: 'Enter the number of days' })
    .int('Use whole days')
    .min(1, 'At least 1 day')
    .max(366, 'At most 366 days at a time'),
  note: adminNote,
})
export type ExtendSubscriptionInput = z.input<typeof extendSubscriptionSchema>

export const adminChangePlanSchema = z.object({
  planId: uuidSchema,
  billingCycle: z.enum(BILLING_CYCLES),
  note: adminNote,
})
export type AdminChangePlanInput = z.input<typeof adminChangePlanSchema>

export const adminCancelSchema = z.object({ note: adminNote })

export const REMINDER_CHANNELS = ['IN_APP', 'EMAIL', 'WHATSAPP'] as const
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number]
export const remindSchema = z.object({
  channels: z.array(z.enum(REMINDER_CHANNELS)).min(1, 'Pick at least one channel').max(3),
})

export const alertSettingsSchema = z.object({
  reminderDays: z
    .array(z.coerce.number().int().min(1, 'At least 1 day').max(60, 'At most 60 days'))
    .min(1, 'Add at least one reminder day')
    .max(6, 'At most 6 reminders')
    .transform((d) => [...new Set(d)].sort((a, b) => b - a)),
  graceDays: z.coerce.number().int().min(0, 'Cannot be negative').max(30, 'At most 30 days'),
  digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM, e.g. 09:00'),
  winbackAfterDays: z.coerce.number().int().min(1).max(90).nullable(),
  winbackPercentOff: z.coerce.number().int().min(5, 'At least 5%').max(90, 'At most 90%'),
})
export type AlertSettingsInput = z.input<typeof alertSettingsSchema>

export const adminNotificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unread: z.preprocess((v) => v === 'true' || v === '1' || v === true, z.boolean()).default(false),
})

// ------------------------------------------------------------------ two-factor sign-in (admins)

export const totpCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
})


// ---------------------------------------------------------------- admin: studios table

export const ADMIN_STUDIO_PLAN_FILTERS = ['all', 'TRIAL', 'PRO', 'VIP', 'NONE', 'REMOVED'] as const
export type AdminStudioPlanFilter = (typeof ADMIN_STUDIO_PLAN_FILTERS)[number]

export const adminStudioQuerySchema = listQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  plan: z.preprocess(emptyToUndefined, z.enum(ADMIN_STUDIO_PLAN_FILTERS).default('all')),
})
export type AdminStudioQuery = z.output<typeof adminStudioQuerySchema>

/** Remove a studio: the admin types the studio's name to confirm. */
export const removeStudioSchema = z.object({ confirmName: z.string().trim().min(1, 'Type the studio name to confirm').max(200) })
