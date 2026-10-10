import type { PrismaClient } from '@prisma/client'

// Reference data every environment needs. Upserts, so it is safe to re-run in production.

// Trial / Pro / VIP (Update 2). The codes stay STARTER / PRO / ALL_ACCESS in the database; STUDIO is
// kept hidden for history. Prices are in paise, GST extra.
export const PLANS = [
  {
    code: 'STARTER' as const,
    name: 'Trial',
    tagline: 'Try everything free for 14 days',
    monthlyPrice: null,
    yearlyPrice: 0,
    prices: {},
    popular: false,
    sortOrder: 1,
    limits: {
      eventsPerMonth: null,
      eventsTotal: 2,
      photosPerEvent: 100,
      uploadGbPerMonth: null,
      uploadGbTotal: 2,
      trialDays: 14,
      galleryDays: 7,
      favourites: false,
      albums: 2,
      storageGb: null,
      teamSeats: 1,
      includedCredits: 0,
      maxPhotoMb: 100,
      maxFilesPerUpload: 100,
      uploadConcurrency: 4,
    },
    features: ['2 customer events', '100 photos per event', 'About 2 GB of uploads', 'Customer gallery open 7 days', '14-day trial'],
    comingSoon: [],
  },
  {
    code: 'PRO' as const,
    name: 'Pro',
    tagline: 'For busy wedding studios',
    monthlyPrice: 199_900,
    yearlyPrice: 1_999_900,
    prices: { MONTHLY: 199_900, QUARTERLY: 539_900, HALF_YEARLY: 1_019_900, YEARLY: 1_999_900 },
    popular: true,
    sortOrder: 2,
    limits: {
      eventsPerMonth: 10,
      eventsTotal: null,
      photosPerEvent: 2000,
      uploadGbPerMonth: 500,
      uploadGbTotal: null,
      addonEvents: 5,
      addonEventsPricePaise: 49_900,
      favourites: false,
      albums: 50,
      storageGb: null,
      teamSeats: 1,
      includedCredits: 0,
      maxPhotoMb: 100,
      maxFilesPerUpload: 2000,
      uploadConcurrency: 4,
    },
    features: ['10 new customer events a month', '2,000 photos per event', '500 GB of uploads a month', '+5 events add-on any month', 'Pick with a heart'],
    comingSoon: [],
  },
  {
    code: 'STUDIO' as const,
    name: 'Studio',
    tagline: 'Retired plan',
    monthlyPrice: 599_900,
    yearlyPrice: 5_999_900,
    prices: {},
    popular: false,
    sortOrder: 9,
    isActive: false,
    limits: { eventsPerMonth: null, albums: null, storageGb: null, teamSeats: 5, includedCredits: 0, maxPhotoMb: 100, maxFilesPerUpload: 3000, uploadConcurrency: 5, photosPerEvent: 3000, uploadGbPerMonth: 1024 },
    features: ['Retired'],
    comingSoon: [],
  },
  {
    code: 'ALL_ACCESS' as const,
    name: 'VIP',
    tagline: 'Unlimited events, favourites included',
    monthlyPrice: 499_900,
    yearlyPrice: 4_999_900,
    prices: { MONTHLY: 499_900, QUARTERLY: 1_349_900, HALF_YEARLY: 2_549_900, YEARLY: 4_999_900 },
    popular: false,
    sortOrder: 3,
    limits: {
      eventsPerMonth: null,
      eventsTotal: null,
      fairUseEventsPerMonth: 300,
      photosPerEvent: 5000,
      uploadGbPerMonth: 1024,
      uploadGbTotal: null,
      favourites: true,
      albums: null,
      storageGb: null,
      teamSeats: 10,
      includedCredits: 0,
      maxPhotoMb: 100,
      maxFilesPerUpload: 5000,
      uploadConcurrency: 6,
    },
    features: ['Unlimited customer events (fair use)', '5,000 photos per event', '1 TB of uploads a month', 'Customer favourites', 'Priority support'],
    comingSoon: [],
  },
]

export const TEMPLATES = [
  {
    key: 'SELECTION_INVITE',
    name: 'Selection link',
    body:
      'Hi {{clientName}}! 💕\n\nYour private photo selection gallery for *{{eventTitle}}* from {{studioName}} is ready.\n' +
      'Please pick up to {{quota}} favourite photos before {{deadline}}:\n{{link}}\n\nYour selection code: {{code}}',
  },
  {
    key: 'SELECTION_REMINDER',
    name: 'Selection reminder',
    body:
      'Hi {{clientName}}! 💕\n\nA gentle reminder from {{studioName}}: you have picked {{picked}} of {{quota}} photos for *{{eventTitle}}*.\n' +
      '⏳ Selection deadline: {{deadline}}\n\nContinue here: {{link}}\n\nYour selection code: {{code}}',
  },
  {
    key: 'ALBUM_SHARE',
    name: 'Album share',
    body: 'Hi {{clientName}}! ✨\n\nYour digital album *{{albumTitle}}* from {{studioName}} is ready to view:\n{{link}}',
  },
  {
    key: 'INVOICE_SEND',
    name: 'Invoice',
    body:
      'Hi {{clientName}},\n\nInvoice *{{invoiceNumber}}* from {{studioName}} for {{amount}} is due on {{dueDate}}.\n' +
      'Balance due: {{balance}}. Thank you!',
  },
  {
    key: 'EVENT_CONFIRMATION',
    name: 'Event confirmation',
    body: 'Hi {{clientName}}! Your booking with {{studioName}} for *{{eventTitle}}* on {{eventDate}} at {{venue}} is confirmed. 📸',
  },
  {
    key: 'REFERRAL_INVITE',
    name: 'Referral invite',
    body:
      'I run my studio on Weddyzone Studio — selections, flipbook albums and GST invoices in one place. ' +
      'Sign up with my code {{code}} and we both get ₹1,500: {{link}}',
  },
  // Weddyzone's own messages to studios (plan alerts). Sent from the platform's number: they cost the
  // studio no credits. With the WhatsApp Cloud API, each must exist as an approved template named
  // after its key in lower case, with its variables in the order of PLATFORM_TEMPLATE_PARAMS.
  {
    key: 'PLAN_EXPIRY_REMINDER',
    name: 'Plan expiry reminder',
    creditCost: 0,
    body: 'Hi {{studioName}}, your Weddyzone {{planName}} plan expires on {{date}}. Renew in one click to keep working without a break: {{link}}',
  },
  {
    key: 'PLAN_EXPIRED_GRACE',
    name: 'Plan expired (grace)',
    creditCost: 0,
    body: 'Hi {{studioName}}, your Weddyzone {{planName}} plan expired on {{date}}. Galleries are view-only and uploads are paused. Renew within {{graceDays}} days or your galleries close for customers: {{link}}',
  },
  {
    key: 'PLAN_READ_ONLY',
    name: 'Account read-only',
    creditCost: 0,
    body: 'Hi {{studioName}}, your Weddyzone {{planName}} plan has ended, so your account is read-only and your galleries are closed for customers. Renew within 30 days to keep your photo previews: {{link}}',
  },
  {
    key: 'PLAN_PAYMENT_FAILED',
    name: 'Plan payment failed',
    creditCost: 0,
    body: "Hi {{studioName}}, your payment for the Weddyzone {{planName}} plan didn't go through. Please retry here: {{link}}",
  },
  {
    key: 'PLAN_RENEWED',
    name: 'Plan renewed',
    creditCost: 0,
    body: 'Hi {{studioName}}, your Weddyzone {{planName}} plan renewed successfully. Next renewal: {{date}}. Thank you!',
  },
  {
    key: 'PLAN_PURCHASED',
    name: 'Plan purchased',
    creditCost: 0,
    body: 'Hi {{studioName}}, your Weddyzone {{planName}} plan is active until {{date}}. Invoice {{invoiceNumber}} is in My Subscription.',
  },
  {
    key: 'PLAN_WINBACK',
    name: 'Win-back offer',
    creditCost: 0,
    body: 'Hi {{studioName}}, we miss you at Weddyzone! Come back with {{percent}}% off using code {{code}}, valid until {{date}}: {{link}}',
  },
]

export const FAQS = [
  ['Getting started', 'How do I set up my studio?', 'Fill in My Profile (studio name, GSTIN, state and logo), then create your first client and event from the dashboard with New Event. Your plan, credits and website are ready from day one.'],
  ['Getting started', 'Can I add my team?', 'Team seats depend on your plan: Trial and Pro include 1 account and VIP includes 10.'],
  ['Selections & albums', 'How do clients select their photos?', 'Create a Photo Selection for the event, upload the photos and share the link over WhatsApp. Clients heart their favourites, and you see the selection update live.'],
  ['Selections & albums', 'What happens when a client reaches the quota?', 'The selection locks at the quota: clients must remove a photo before adding another. The page tells them exactly how many picks they have left.'],
  ['Selections & albums', 'How do I export picks to Lightroom?', 'Open the selection and use Lightroom XML Sync. It downloads the picked filenames as a text list you can paste into a Lightroom Classic filter.'],
  ['Selections & albums', 'Can clients comment on album spreads?', 'Yes. In the shared flipbook each spread has a feedback box. You see the notes in Digital Album and can mark them resolved.'],
  ['Billing & GST', 'How is GST calculated on invoices?', 'If your studio state matches the place of supply, the invoice shows CGST and SGST (half the rate each). Otherwise it shows IGST at the full rate.'],
  ['Billing & GST', 'How are invoice numbers generated?', 'Numbers run in sequence per financial year (April–March), for example INV-2026-0012. They are never reused, even if an invoice is cancelled.'],
  ['Plans & credits', 'What happens when I run out of WhatsApp credits?', 'Sending pauses until you top up. Your balance is always visible in the top bar and on the WhatsApp Credit page.'],
  ['Plans & credits', 'Can I change or cancel my plan anytime?', 'Yes. Upgrades apply immediately, with credit for the unused days of your current plan. Cancelling keeps your plan until the end of the current billing period.'],
  ['Website', 'Can I use my own domain for my website?', 'Yes — on Pro and higher plans, add your domain in My Website and point a CNAME record to your studio site.'],
  ['Website', 'Where do website enquiries go?', 'Every enquiry from your website creates a lead and a notification in the bell menu, so you can reply quickly.'],
] as const

export async function seedReference(prisma: PrismaClient) {
  for (const p of PLANS) {
    // Plans are edited by platform admins (/admin/plans) once they exist, so the seed only adds missing ones.
    await prisma.plan.upsert({ where: { code: p.code }, create: p, update: {} })
  }
  for (const t of TEMPLATES) {
    await prisma.whatsAppTemplate.upsert({ where: { key: t.key }, create: t, update: { name: t.name, body: t.body } })
  }
  if ((await prisma.faq.count()) === 0) {
    await prisma.faq.createMany({
      data: FAQS.map(([category, question, answer], i) => ({ category, question, answer, position: i })),
    })
  }
}
