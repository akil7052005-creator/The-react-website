import { z } from 'zod'
import { emailSchema, passwordSchema, phoneSchema, requiredText } from '../validators'

export const referralCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,20}$/, 'Referral code should be 4–20 letters or digits')

export const signupSchema = z.object({
  studioName: requiredText('Studio name', 80, 2),
  ownerName: requiredText('Your name', 80, 2),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  referralCode: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    referralCodeSchema.optional(),
  ),
})
export type SignupInput = z.input<typeof signupSchema>

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required').max(128),
  // Only for platform admins who turned on two-factor sign-in.
  otp: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app').optional()),
})
export type LoginInput = z.input<typeof loginSchema>

export const forgotPasswordSchema = z.object({ email: emailSchema })
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20, 'This reset link is invalid').max(200),
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(128),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'New password must be different from the current one',
    path: ['newPassword'],
  })
export type ChangePasswordInput = z.input<typeof changePasswordSchema>
