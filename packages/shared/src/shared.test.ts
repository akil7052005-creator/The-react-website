import { describe, expect, it } from 'vitest'
import {
  amountSchema,
  clientSchema,
  computeInvoiceTotals,
  createEventSchema,
  emailSchema,
  financialYearStart,
  formatInvoiceNumber,
  makeInvoiceSchema,
  passwordSchema,
  phoneSchema,
  profileSchema,
  todayIST,
  websiteSettingsSchema,
  WEBSITE_SECTION_KEYS,
} from './index'

const errorsOf = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((r.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]))

describe('phone', () => {
  it.each(['9876543210', '+91 98765 43210', '098765-43210', '919876543210'])('accepts %s', (v) => {
    expect(phoneSchema.parse(v)).toBe('+919876543210')
  })
  it.each(['5876543210', '98765', 'abcdefghij', ''])('rejects %s', (v) => {
    expect(phoneSchema.safeParse(v).success).toBe(false)
  })
})

describe('email and password', () => {
  it('lowercases and trims email', () => {
    expect(emailSchema.parse('  Hello@GoldenHour.Studio ')).toBe('hello@goldenhour.studio')
  })
  it('rejects bad email', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false)
  })
  it('requires a letter and a number', () => {
    expect(passwordSchema.safeParse('abcdefgh').success).toBe(false)
    expect(passwordSchema.safeParse('12345678').success).toBe(false)
    expect(passwordSchema.safeParse('abc123').success).toBe(false)
    expect(passwordSchema.safeParse('abcd1234').success).toBe(true)
  })
})

describe('amounts', () => {
  it('accepts up to two decimals', () => {
    expect(amountSchema.parse('1500.50')).toBe(1500.5)
    expect(amountSchema.parse(0.01)).toBe(0.01)
  })
  it('rejects zero, negatives and three decimals', () => {
    expect(amountSchema.safeParse(0).success).toBe(false)
    expect(amountSchema.safeParse(-5).success).toBe(false)
    expect(amountSchema.safeParse(10.123).success).toBe(false)
  })
})

describe('PIN on the profile; no GSTIN or PAN', () => {
  const base = {
    ownerName: 'Arjun Mehta',
    studioName: 'Golden Hour Studios',
    email: 'hello@goldenhour.studio',
    phone: '9876543210',
    city: 'Chennai',
    stateCode: '33',
  }
  it('rejects a malformed PIN', () => {
    expect(errorsOf(profileSchema.safeParse({ ...base, pincode: '012345' })).pincode).toBeDefined()
  })
  it('treats an empty PIN as absent', () => {
    expect(profileSchema.parse({ ...base, pincode: '' }).pincode).toBeUndefined()
  })
  it('drops GSTIN and PAN sent by an older app', () => {
    const r = profileSchema.parse({ ...base, gstin: '33ABCDE1234F1Z5', pan: 'ABCDE1234F' })
    expect(r).not.toHaveProperty('gstin')
    expect(r).not.toHaveProperty('pan')
    expect(clientSchema.parse({ name: 'Priya Raman', phone: '9876543210', gstin: '33ABCDE1234F1Z5' })).not.toHaveProperty('gstin')
  })
})

describe('event date', () => {
  it('rejects a past date on create', () => {
    const r = createEventSchema.safeParse({
      clientId: '7b0c2b4e-1d7a-4f5e-9d33-0b2d7d1f6a11',
      title: 'Test Wedding',
      type: 'WEDDING',
      date: '2020-01-01',
      venue: 'Hall',
      city: 'Chennai',
    })
    expect(errorsOf(r).date).toBe('Event date cannot be in the past')
  })
  it('accepts today', () => {
    const r = createEventSchema.safeParse({
      clientId: '7b0c2b4e-1d7a-4f5e-9d33-0b2d7d1f6a11',
      title: 'Test Wedding',
      type: 'WEDDING',
      date: todayIST(),
      venue: 'Hall',
      city: 'Chennai',
    })
    expect(r.success).toBe(true)
  })
})

describe('GST maths', () => {
  const lines = [
    { qty: 1, ratePaise: 10_000_000, gstRate: 18 }, // ₹1,00,000
    { qty: 2, ratePaise: 1_250_050, gstRate: 5 }, // 2 × ₹12,500.50
  ]

  it('splits CGST + SGST when studio state equals place of supply', () => {
    const t = computeInvoiceTotals(lines, '33', '33')
    expect(t.supplyType).toBe('INTRA')
    expect(t.subtotalPaise).toBe(12_500_100)
    // 18% of 1,00,000 = 18,000 → 9,000 + 9,000; 5% of 25,001 = 1,250.05 → 625.03 + 625.03 (per-component rounding)
    expect(t.cgstPaise).toBe(900_000 + 62_503)
    expect(t.sgstPaise).toBe(900_000 + 62_503)
    expect(t.igstPaise).toBe(0)
    expect(t.totalPaise).toBe(12_500_100 + 2 * 962_503)
  })

  it('uses IGST for inter-state supply', () => {
    const t = computeInvoiceTotals(lines, '33', '29')
    expect(t.supplyType).toBe('INTER')
    expect(t.cgstPaise + t.sgstPaise).toBe(0)
    expect(t.igstPaise).toBe(1_800_000 + 125_005)
    expect(t.totalPaise).toBe(12_500_100 + 1_925_005)
  })

  it('treats a studio without a state as inter-state', () => {
    expect(computeInvoiceTotals(lines, null, '33').supplyType).toBe('INTER')
  })

  it('handles 0% GST', () => {
    const t = computeInvoiceTotals([{ qty: 3, ratePaise: 5000, gstRate: 0 }], '33', '33')
    expect(t.totalPaise).toBe(15000)
    expect(t.taxPaise).toBe(0)
  })
})

describe('invoice schema', () => {
  const schema = makeInvoiceSchema('33')
  const base = {
    clientId: '7b0c2b4e-1d7a-4f5e-9d33-0b2d7d1f6a11',
    issueDate: '2026-09-01',
    dueDate: '2026-09-15',
    placeOfSupply: '33',
    items: [{ description: 'Wedding coverage', sac: '998386', qty: 1, rate: 100000, gstRate: 18 }],
  }
  it('requires due date on or after issue date', () => {
    const r = schema.safeParse({ ...base, dueDate: '2026-08-31' })
    expect(errorsOf(r).dueDate).toBeDefined()
  })
  it('requires milestones to add up to the total', () => {
    const bad = schema.safeParse({
      ...base,
      milestones: [{ label: 'Advance', amount: 50000, dueDate: '2026-09-02' }],
    })
    expect(errorsOf(bad).milestones).toMatch(/total is ₹1,18,000/)
    const good = schema.safeParse({
      ...base,
      milestones: [
        { label: 'Advance', amount: 35400, dueDate: '2026-09-02' },
        { label: 'Final', amount: 82600, dueDate: '2026-09-15' },
      ],
    })
    expect(good.success).toBe(true)
  })
})

describe('invoice numbering helpers', () => {
  it('uses April–March financial years', () => {
    expect(financialYearStart('2026-04-01')).toBe(2026)
    expect(financialYearStart('2026-03-31')).toBe(2025)
    expect(financialYearStart('2027-01-15')).toBe(2026)
    expect(formatInvoiceNumber(2026, 12)).toBe('INV-2026-0012')
  })
})

describe('website settings', () => {
  const sections = WEBSITE_SECTION_KEYS.map((key) => ({ key, on: true }))
  const base = { sections, theme: 'Ivory Classic', primaryColor: '#8B1E3F', font: 'Manrope' }
  it('validates video URLs and domains', () => {
    expect(websiteSettingsSchema.safeParse({ ...base, videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }).success).toBe(true)
    expect(websiteSettingsSchema.safeParse({ ...base, videoUrl: 'https://vimeo.com/123456' }).success).toBe(true)
    expect(websiteSettingsSchema.safeParse({ ...base, videoUrl: 'https://example.com/v' }).success).toBe(false)
    expect(websiteSettingsSchema.safeParse({ ...base, customDomain: 'https://x.com' }).success).toBe(false)
    expect(websiteSettingsSchema.parse({ ...base, customDomain: 'Gallery.GoldenHour.Studio' }).customDomain).toBe(
      'gallery.goldenhour.studio',
    )
  })
})

describe('amount in words', () => {
  it('uses lakhs and crores', async () => {
    const { amountInWords } = await import('./money')
    expect(amountInWords(11_800_000)).toBe('Rupees One Lakh Eighteen Thousand Only')
    expect(amountInWords(123_456_789_00)).toBe('Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only')
    expect(amountInWords(100_050)).toBe('Rupees One Thousand and Fifty Paise Only')
    expect(amountInWords(0)).toBe('Rupees Zero Only')
  })
})

describe('billing periods on sale', () => {
  it('sells 1, 6 and 12 months, and shows the saving against paying monthly', async () => {
    const { PRICING_CYCLES, cycleSavingPct } = await import('./plans')
    expect(PRICING_CYCLES).toEqual(['MONTHLY', 'HALF_YEARLY', 'YEARLY'])
    const pro = { MONTHLY: 60_000, HALF_YEARLY: 300_000, YEARLY: 500_000 }
    expect(cycleSavingPct(pro, 'MONTHLY')).toBeNull()
    expect(cycleSavingPct(pro, 'HALF_YEARLY')).toBe(17)
    expect(cycleSavingPct(pro, 'YEARLY')).toBe(31)
    expect(cycleSavingPct({ MONTHLY: 120_000, HALF_YEARLY: 600_000, YEARLY: 1_000_000 }, 'YEARLY')).toBe(31)
  })
})
