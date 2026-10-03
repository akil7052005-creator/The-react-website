import type { PrismaClient } from '@prisma/client'

// Reference data every environment needs. Upserts, so it is safe to re-run in production.

export const PLANS = [
  {
    code: 'STARTER' as const,
    name: 'Starter',
    tagline: 'For new photographers',
    monthlyPrice: 99_900,
    yearlyPrice: 999_000,
    popular: false,
    sortOrder: 1,
    limits: { eventsPerMonth: 10, albums: 10, storageGb: 100, teamSeats: 1, includedCredits: 0, maxPhotoMb: 25, maxFilesPerUpload: 300, uploadConcurrency: 3 },
    features: ['10 events / month', '100 GB storage', 'Photo selection', 'Digital albums', 'Basic website'],
    comingSoon: [],
  },
  {
    code: 'PRO' as const,
    name: 'Pro',
    tagline: 'For growing studios',
    monthlyPrice: 249_900,
    yearlyPrice: 2_499_000,
    popular: true,
    sortOrder: 2,
    limits: { eventsPerMonth: 30, albums: 50, storageGb: 500, teamSeats: 1, includedCredits: 0, maxPhotoMb: 50, maxFilesPerUpload: 1000, uploadConcurrency: 4 },
    features: ['30 events / month', '500 GB storage', 'Photo selection', 'Digital albums', 'Custom domain'],
    comingSoon: ['Custom domain'],
  },
  {
    code: 'STUDIO' as const,
    name: 'Studio',
    tagline: 'For teams & agencies',
    monthlyPrice: 599_900,
    yearlyPrice: 5_999_000,
    popular: false,
    sortOrder: 3,
    limits: { eventsPerMonth: null, albums: null, storageGb: 2048, teamSeats: 5, includedCredits: 1000, maxPhotoMb: 80, maxFilesPerUpload: 3000, uploadConcurrency: 5 },
    features: ['Unlimited events', '2 TB storage', 'Digital albums', '5 team seats', 'Priority support'],
    comingSoon: ['5 team seats', 'Priority support'],
  },
  {
    code: 'ALL_ACCESS' as const,
    name: 'All-Access',
    tagline: 'Every feature, zero limits',
    monthlyPrice: null,
    yearlyPrice: 4_999_900,
    popular: false,
    sortOrder: 4,
    limits: { eventsPerMonth: null, albums: null, storageGb: 5120, teamSeats: 10, includedCredits: 10000, maxPhotoMb: 100, maxFilesPerUpload: 5000, uploadConcurrency: 6 },
    features: [
      'Unlimited events',
      '5 TB storage',
      'Digital albums',
      'Custom domain',
      '10,000 WhatsApp credits every year',
      'Dedicated account manager',
    ],
    comingSoon: ['Custom domain', 'Dedicated account manager'],
  },
]

export const TEMPLATES = [
  {
    key: 'SELECTION_INVITE',
    name: 'Selection link',
    body:
      'Hi {{clientName}}! 💕\n\nYour private photo selection gallery for *{{eventTitle}}* from {{studioName}} is ready.\n' +
      'Please pick up to {{quota}} favourite photos before {{deadline}}:\n{{link}}',
  },
  {
    key: 'SELECTION_REMINDER',
    name: 'Selection reminder',
    body:
      'Hi {{clientName}}! 💕\n\nA gentle reminder from {{studioName}}: you have picked {{picked}} of {{quota}} photos for *{{eventTitle}}*.\n' +
      '⏳ Selection deadline: {{deadline}}\n\nContinue here: {{link}}',
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
    body: 'Hi {{studioName}}, your Weddyzone {{planName}} plan expired on {{date}}. Renew within {{graceDays}} days to keep adding events and uploads: {{link}}',
  },
  {
    key: 'PLAN_READ_ONLY',
    name: 'Account read-only',
    creditCost: 0,
    body: 'Hi {{studioName}}, your Weddyzone {{planName}} plan has ended and your account is now read-only. Your photos and albums are safe and your clients can still view them. Renew any time: {{link}}',
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
  ['Getting started', 'Can I add my team?', 'Team seats depend on your plan: Starter and Pro include 1 account, Studio includes 5 and All-Access includes 10.'],
  ['Selections & albums', 'How do clients select their photos?', 'Create a Photo Selection for the event, upload the photos and share the link over WhatsApp. Clients heart their favourites, and you see the selection update live.'],
  ['Selections & albums', 'What happens when a client reaches the quota?', 'The selection locks at the quota: clients must remove a photo before adding another. The page tells them exactly how many picks they have left.'],
  ['Selections & albums', 'How do I export picks to Lightroom?', 'Open the selection and use Lightroom XML Sync. It downloads the picked filenames as a text list you can paste into a Lightroom Classic filter.'],
  ['Selections & albums', 'Can clients comment on album spreads?', 'Yes. In the shared flipbook each spread has a feedback box. You see the notes in Digital Album and can mark them resolved.'],
  ['Billing & GST', 'How is GST calculated on invoices?', 'If your studio state matches the place of supply, the invoice shows CGST and SGST (half the rate each). Otherwise it shows IGST at the full rate.'],
  ['Billing & GST', 'How are invoice numbers generated?', 'Numbers run in sequence per financial year (April–March), for example INV-2026-0012. They are never reused, even if an invoice is cancelled.'],
  ['Plans & credits', 'What happens when I run out of WhatsApp credits?', 'Sending pauses until you top up. Your balance is always visible in the top bar and on the WhatsApp Credit page.'],
  ['Plans & credits', 'Can I change or cancel my plan anytime?', 'Yes. Upgrades apply immediately. Cancelling keeps your plan until the end of the current billing period.'],
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
