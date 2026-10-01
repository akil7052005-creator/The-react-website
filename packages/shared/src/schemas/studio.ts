import { z } from 'zod'
import { STATE_CODES } from '../states'
import {
  emailSchema,
  emptyToUndefined,
  gstinFormatSchema,
  gstinMatchesState,
  optionalText,
  panSchema,
  phoneSchema,
  pincodeSchema,
  requiredText,
} from '../validators'

export const stateCodeSchema = z.enum(STATE_CODES, { error: 'Select a state' })

export const profileSchema = z
  .object({
    ownerName: requiredText('Your name', 80, 2),
    studioName: requiredText('Studio name', 80, 2),
    email: emailSchema,
    phone: phoneSchema,
    city: requiredText('City', 60),
    stateCode: stateCodeSchema,
    addressLine1: optionalText(120),
    addressLine2: optionalText(120),
    pincode: emptyToUndefined(pincodeSchema),
    gstin: emptyToUndefined(gstinFormatSchema),
    pan: emptyToUndefined(panSchema),
    website: optionalText(120),
    bio: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.gstin && !gstinMatchesState(v.gstin, v.stateCode)) {
      ctx.addIssue({
        code: 'custom',
        path: ['gstin'],
        message: `GSTIN must start with ${v.stateCode}, the code for the selected state`,
      })
    }
    if (v.gstin && v.pan && v.gstin.slice(2, 12) !== v.pan) {
      ctx.addIssue({ code: 'custom', path: ['pan'], message: 'PAN does not match the PAN inside your GSTIN' })
    }
  })
export type ProfileInput = z.input<typeof profileSchema>
export type ProfileOutput = z.output<typeof profileSchema>

export const clientSchema = z
  .object({
    name: requiredText('Client name', 80, 2),
    phone: phoneSchema,
    email: emptyToUndefined(emailSchema),
    city: optionalText(60),
    stateCode: emptyToUndefined(stateCodeSchema),
    gstin: emptyToUndefined(gstinFormatSchema),
    notes: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.gstin && !v.stateCode) {
      ctx.addIssue({ code: 'custom', path: ['stateCode'], message: 'Select the state for this GSTIN' })
    } else if (v.gstin && v.stateCode && !gstinMatchesState(v.gstin, v.stateCode)) {
      ctx.addIssue({
        code: 'custom',
        path: ['gstin'],
        message: `GSTIN must start with ${v.stateCode}, the code for the selected state`,
      })
    }
  })
export type ClientInput = z.input<typeof clientSchema>
