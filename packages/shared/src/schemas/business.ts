import { z } from 'zod'
import {
  BANNER_PLACEMENTS,
  FAQ_CATEGORIES,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  WEBSITE_FONTS,
  WEBSITE_SECTION_KEYS,
  WEBSITE_THEMES,
} from '../enums'
import {
  DOMAIN_REGEX,
  dateSchema,
  emailSchema,
  emptyToUndefined,
  isVideoUrl,
  optionalText,
  phoneSchema,
  requiredText,
  todayIST,
  urlSchema,
} from '../validators'
import { booleanish } from './common'

export const websiteSettingsSchema = z.object({
  sections: z
    .array(z.object({ key: z.enum(WEBSITE_SECTION_KEYS), on: z.boolean() }))
    .length(WEBSITE_SECTION_KEYS.length, 'Every section must be listed')
    .refine((s) => new Set(s.map((x) => x.key)).size === s.length, 'Duplicate section'),
  theme: z.enum(WEBSITE_THEMES, { error: 'Select a theme' }),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour like #8B1E3F'),
  font: z.enum(WEBSITE_FONTS, { error: 'Select a font' }),
  tagline: optionalText(120),
  customDomain: emptyToUndefined(
    z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => DOMAIN_REGEX.test(v), 'Enter a domain like gallery.yourstudio.com (no https://)'),
  ),
  seoTitle: optionalText(60),
  seoDescription: optionalText(160),
  videoUrl: emptyToUndefined(
    z.string().trim().refine(isVideoUrl, 'Enter a YouTube or Vimeo link (https://…)'),
  ),
})
export type WebsiteSettingsInput = z.input<typeof websiteSettingsSchema>

export const leadSchema = z.object({
  name: requiredText('Your name', 80, 2),
  phone: phoneSchema,
  email: emptyToUndefined(emailSchema),
  eventDate: emptyToUndefined(dateSchema.refine((v) => v >= todayIST(), 'Event date cannot be in the past')),
  city: optionalText(60),
  message: optionalText(1000),
  // Honeypot: real people never see or fill this field.
  company: z.string().max(0, 'Spam detected').optional(),
})
export type LeadInput = z.input<typeof leadSchema>

export const bannerSchema = z
  .object({
    title: requiredText('Title', 80, 2),
    placement: z.enum(BANNER_PLACEMENTS, { error: 'Select a placement' }),
    ctaText: optionalText(30),
    ctaUrl: emptyToUndefined(urlSchema),
    startDate: emptyToUndefined(dateSchema),
    endDate: emptyToUndefined(dateSchema),
    active: booleanish.default(true),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be on or after the start date' })
    }
    if (v.ctaText && !v.ctaUrl) {
      ctx.addIssue({ code: 'custom', path: ['ctaUrl'], message: 'Add a link for the button' })
    }
  })
export type BannerInput = z.input<typeof bannerSchema>

export const ticketSchema = z.object({
  subject: requiredText('Subject', 120, 5),
  category: z.enum(TICKET_CATEGORIES, { error: 'Select a category' }),
  priority: z.enum(TICKET_PRIORITIES, { error: 'Select a priority' }),
  description: requiredText('Description', 5000, 10),
})
export type TicketInput = z.input<typeof ticketSchema>

export const ticketReplySchema = z.object({
  body: requiredText('Reply', 5000),
})
export type TicketReplyInput = z.input<typeof ticketReplySchema>

export const ticketStatusSchema = z.object({ status: z.enum(TICKET_STATUSES) })

export const faqFeedbackSchema = z.object({ helpful: z.boolean() })

export const faqSchema = z.object({
  category: z.enum(FAQ_CATEGORIES),
  question: requiredText('Question', 200, 5),
  answer: requiredText('Answer', 3000, 5),
  position: z.coerce.number().int().min(0).default(0),
  isPublished: z.boolean().default(true),
})
export type FaqInput = z.input<typeof faqSchema>
