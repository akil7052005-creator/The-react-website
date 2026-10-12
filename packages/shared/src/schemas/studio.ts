import { z } from 'zod'
import { STATE_CODES } from '../states'
import { emailSchema, emptyToUndefined, optionalText, phoneSchema, pincodeSchema, requiredText } from '../validators'

export const stateCodeSchema = z.enum(STATE_CODES, { error: 'Select a state' })

export const profileSchema = z.object({
    ownerName: requiredText('Your name', 80, 2),
    studioName: requiredText('Studio name', 80, 2),
    email: emailSchema,
    phone: phoneSchema,
    city: requiredText('City', 60),
    stateCode: stateCodeSchema,
    addressLine1: optionalText(120),
    addressLine2: optionalText(120),
    pincode: emptyToUndefined(pincodeSchema),
    website: optionalText(120),
    /** Instagram handle; a leading @ or a profile URL is trimmed to the handle. */
    instagramHandle: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?].*$/, '') : v),
      z.union([z.literal(''), z.string().regex(/^[A-Za-z0-9._]{1,30}$/, 'Enter an Instagram handle like goldenhour.studio')]).optional(),
    ),
    bio: optionalText(500),
  })
export type ProfileInput = z.input<typeof profileSchema>
export type ProfileOutput = z.output<typeof profileSchema>

export const clientSchema = z.object({
  name: requiredText('Client name', 80, 2),
  phone: phoneSchema,
  email: emptyToUndefined(emailSchema),
  city: optionalText(60),
  stateCode: emptyToUndefined(stateCodeSchema),
  notes: optionalText(500),
})
export type ClientInput = z.input<typeof clientSchema>
