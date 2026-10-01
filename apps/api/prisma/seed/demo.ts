import type { EventStatus, EventType, FileKind, PrismaClient } from '@prisma/client'
import {
  computeInvoiceTotals,
  financialYearStart,
  formatInvoiceNumber,
  todayIST,
  WEBSITE_SECTION_KEYS,
} from '@weddyzone/shared'
import bcrypt from 'bcryptjs'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { gradientPng } from '../../src/common/png'

// Demo studio mirroring the original mock content of the approved UI.
// Dates are relative to "today" so upcoming/overdue states stay meaningful.

export const DEMO_EMAIL = 'hello@goldenhour.studio'
export const DEMO_PASSWORD = 'Golden@2026'
export const ADMIN_EMAIL = 'admin@weddyzone.app'
export const ADMIN_PASSWORD = 'Admin@2026'

const DAY = 86_400_000
const today = todayIST()
const dateOnly = (offsetDays: number) => new Date(new Date(`${today}T00:00:00.000Z`).getTime() + offsetDays * DAY)
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000)
const token = () => randomBytes(18).toString('base64url')

interface Ctx {
  prisma: PrismaClient
  studioId: string
  uploadDir: string
}

function saveFile(ctx: Ctx, kind: FileKind, data: Buffer, ext: string, mime: string, name: string) {
  const now = new Date()
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`
  const full = join(ctx.uploadDir, key)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, data)
  return ctx.prisma.storedFile.create({
    data: {
      studioId: ctx.studioId,
      kind,
      storageKey: key,
      originalName: name,
      mimeType: mime,
      size: data.length,
      checksum: createHash('sha256').update(data).digest('hex'),
    },
  })
}

async function addPhotos(ctx: Ctx, eventId: string, selectionId: string | null, count: number, hue: number, prefix: string) {
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const png = gradientPng(720, 480, hue + (i % 6) * 14, i + hue)
    const file = await saveFile(ctx, 'PHOTO', png, 'png', 'image/png', `${prefix}_${String(4100 + i * 7).padStart(4, '0')}.png`)
    const photo = await ctx.prisma.photo.create({
      data: { studioId: ctx.studioId, eventId, selectionId, fileId: file.id, position: i },
    })
    ids.push(photo.id)
  }
  return ids
}

const FIRST = ['Aarav', 'Aditi', 'Arjun', 'Bhavna', 'Chetan', 'Deepa', 'Gautam', 'Harini', 'Ishaan', 'Janani', 'Karan', 'Lavanya', 'Manish', 'Nandini', 'Pooja', 'Rohit', 'Sanjana', 'Tarun', 'Uma', 'Varun', 'Yamini', 'Zoya', 'Siddharth', 'Keerthi', 'Pranav', 'Shreya', 'Naveen', 'Anjali']
const LAST = ['Sharma', 'Krishnan', 'Pillai', 'Iyer', 'Rao', 'Menon', 'Nair', 'Reddy', 'Kapoor', 'Joshi', 'Bhat', 'Das', 'Gupta', 'Varma']
const CITIES: [string, string][] = [['Chennai', '33'], ['Bengaluru', '29'], ['Kochi', '32'], ['Hyderabad', '36'], ['Madurai', '33'], ['Coimbatore', '33'], ['Mumbai', '27'], ['Pondicherry', '34']]
const CAPTIONS = [
  'Traditional dhol & dancing entrance', 'Groom arrival with floral garlands', 'The exchange of rose garlands',
  'Mandap sacred fire ceremony', 'Seven sacred steps around agni', 'Candid laughter during vows',
  'Detailed heirloom jewelry close-up', 'Golden hour silhouette at poolside', 'Family blessings',
  'First look', 'Mehendi details', 'Evening reception lights',
]

export async function seedDemo(prisma: PrismaClient, uploadDirRaw: string, webAssetsDir: string) {
  const uploadDir = resolve(uploadDirRaw)
  if (await prisma.user.findUnique({ where: { email: DEMO_EMAIL } })) {
    console.log('Demo studio already exists — skipping demo data.')
    return
  }
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)

  // --- Platform admin -------------------------------------------------------
  if (!(await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } }))) {
    await prisma.user.create({
      data: { name: 'Weddyzone Support', email: ADMIN_EMAIL, role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10) },
    })
  }
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } })
  const plans = Object.fromEntries((await prisma.plan.findMany()).map((p) => [p.code, p]))

  // --- Studio ----------------------------------------------------------------
  const studio = await prisma.studio.create({
    data: {
      name: 'Golden Hour Studios',
      slug: 'golden-hour',
      email: DEMO_EMAIL,
      phone: '+919876543210',
      city: 'Chennai',
      stateCode: '33',
      addressLine1: '12, Khader Nawaz Khan Road',
      addressLine2: 'Nungambakkam',
      pincode: '600006',
      gstin: '33ABCDE1234F1Z5',
      pan: 'ABCDE1234F',
      website: 'goldenhour.weddingz.com',
      bio: 'Candid wedding storytellers capturing South Indian weddings since 2016.',
      referralCode: 'GOLDEN25',
    },
  })
  const ctx: Ctx = { prisma, studioId: studio.id, uploadDir }
  const owner = await prisma.user.create({
    data: { studioId: studio.id, name: 'Arjun Mehta', email: DEMO_EMAIL, phone: '+919876543210', passwordHash, role: 'OWNER', lastLoginAt: new Date() },
  })

  const periodStart = ago(28)
  const periodEnd = new Date(periodStart)
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1)
  await prisma.subscription.create({
    data: { studioId: studio.id, planId: plans.PRO.id, cycle: 'MONTHLY', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
  })
  for (let m = 3; m >= 1; m--) {
    await prisma.payment.create({
      data: {
        studioId: studio.id,
        purpose: 'SUBSCRIPTION',
        description: 'Pro plan · Monthly',
        amount: plans.PRO.monthlyPrice!,
        status: 'SUCCESS',
        provider: 'mock',
        providerRef: `mock_${token()}`,
        createdAt: ago(28 + (m - 1) * 30),
      },
    })
  }

  // --- Clients & events --------------------------------------------------------
  const clientSeed: [string, string, string, string][] = [
    ['Priya Raman', '9840012345', 'Chennai', '33'],
    ['Ananya Iyer', '9845012345', 'Bengaluru', '29'],
    ['Vikram Nair', '9847012345', 'Kochi', '32'],
    ['Divya Suresh', '9842012345', 'Madurai', '33'],
    ['Rahul Menon', '9843012345', 'Pondicherry', '34'],
    ['Kavya Reddy', '9848012345', 'Hyderabad', '36'],
    ['Nisha Kumar', '9841012345', 'Chennai', '33'],
    ['Lakshmi Prasad', '9844012345', 'Coimbatore', '33'],
    ['Riya Shah', '9820012345', 'Mumbai', '27'],
  ]
  const clients: Record<string, { id: string; name: string; phone: string }> = {}
  for (const [name, phone, city, stateCode] of clientSeed) {
    const c = await prisma.client.create({
      data: {
        studioId: studio.id,
        name,
        phone: `+91${phone}`,
        email: `${name.split(' ')[0].toLowerCase()}@example.com`,
        city,
        stateCode,
        createdAt: ago(120),
      },
    })
    clients[name.split(' ')[0]] = c
  }

  type EvSeed = [code: number, title: string, type: EventType, offset: number, venue: string, city: string, guests: number, status: EventStatus, client: string, notes?: string]
  const eventSeed: EvSeed[] = [
    [1048, 'Priya & Karthik Wedding', 'WEDDING', 12, 'Kalyana Mandapam, T. Nagar', 'Chennai', 600, 'UPCOMING', 'Priya'],
    [1047, 'Ananya & Rohan Reception', 'RECEPTION', 4, 'Palace Grounds', 'Bengaluru', 450, 'UPCOMING', 'Ananya', 'Pre-reception golden hour portraits + indoor ballroom lighting.'],
    [1046, 'Meera & Vikram Engagement', 'ENGAGEMENT', -9, 'Bolgatty Palace', 'Kochi', 180, 'IN_PROGRESS', 'Vikram'],
    [1045, 'Divya & Arvind Wedding', 'WEDDING', -16, 'Meenakshi Kalyana Mahal', 'Madurai', 350, 'AWAITING_SELECTION', 'Divya'],
    [1044, 'Sneha & Rahul Pre-wedding', 'PRE_WEDDING', -24, 'Promenade Beach', 'Pondicherry', 20, 'DELIVERED', 'Rahul'],
    [1043, 'Kavya & Aditya Wedding', 'WEDDING', -32, 'Taj Falaknuma Palace', 'Hyderabad', 400, 'DELIVERED', 'Kavya'],
    [1042, 'Nisha & Pranav Haldi', 'OTHER', -6, 'Family residence, Adyar', 'Chennai', 80, 'AWAITING_SELECTION', 'Nisha'],
    [1041, 'Lakshmi & Suraj Wedding', 'WEDDING', -45, 'Codissia Trade Fair Hall', 'Coimbatore', 500, 'DELIVERED', 'Lakshmi'],
    [1040, 'Riya & Harsh Sangeet', 'OTHER', -50, 'Taj Lands End', 'Mumbai', 250, 'DELIVERED', 'Riya'],
  ]
  const events: Record<number, { id: string; title: string }> = {}
  for (const [code, title, type, offset, venue, city, guests, status, client, notes] of eventSeed) {
    const e = await prisma.event.create({
      data: {
        studioId: studio.id,
        code: `EVT-${code}`,
        clientId: clients[client].id,
        title,
        type,
        date: dateOnly(offset),
        venue,
        city,
        guests,
        status,
        notes,
        createdAt: code >= 1046 ? ago(3 + (1048 - code) * 4) : ago(40 + (1046 - code) * 5),
      },
    })
    events[code] = e
  }

  // Fill the booking chart: past months delivered, future months upcoming.
  const target = [3, 5, 4, 2, 6, 7, 9, 11] // months -5 … +2, as in the original mock
  const monthKey = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth()
  const nowKey = monthKey(dateOnly(0))
  const primaryByMonth = new Map<number, number>()
  for (const [, , , offset] of eventSeed) {
    const k = monthKey(dateOnly(offset)) - nowKey
    primaryByMonth.set(k, (primaryByMonth.get(k) ?? 0) + 1)
  }
  let code = 1001
  const genericClients: { id: string; name: string; phone: string }[] = []
  for (let i = 0; i < 24; i++) {
    const [city, stateCode] = CITIES[i % CITIES.length]
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 5) % LAST.length]}`
    genericClients.push(
      await prisma.client.create({
        data: { studioId: studio.id, name, phone: `+9199${String(40000000 + i * 1379).slice(0, 8)}`, city, stateCode, createdAt: ago(200 - i * 5) },
      }),
    )
  }
  let createdThisMonth = 0
  for (let rel = -5; rel <= 2; rel++) {
    const need = Math.max(0, target[rel + 5] - (primaryByMonth.get(rel) ?? 0))
    for (let j = 0; j < need; j++) {
      const monthStart = new Date(Date.UTC(Math.floor((nowKey + rel) / 12), (nowKey + rel) % 12, 1))
      const date = new Date(monthStart.getTime() + ((j * 7 + 3) % 27) * DAY)
      const isFuture = date.getTime() >= dateOnly(0).getTime()
      const bride = FIRST[(code * 3) % FIRST.length]
      const groom = FIRST[(code * 7 + 1) % FIRST.length]
      const [city] = CITIES[code % CITIES.length]
      const types: EventType[] = ['WEDDING', 'RECEPTION', 'ENGAGEMENT', 'PRE_WEDDING']
      const type = types[code % types.length]
      const label = { WEDDING: 'Wedding', RECEPTION: 'Reception', ENGAGEMENT: 'Engagement', PRE_WEDDING: 'Pre-wedding', OTHER: 'Event' }[type]
      // A few bookings were made this month (feeds "events this month" usage and the trend).
      const createdAt = isFuture && createdThisMonth < 5 ? ago(2 + createdThisMonth++ * 3) : new Date(date.getTime() - 75 * DAY)
      await prisma.event.create({
        data: {
          studioId: studio.id,
          code: `EVT-${code}`,
          clientId: genericClients[code % genericClients.length].id,
          title: `${bride} & ${groom} ${label}`,
          type,
          date,
          venue: `${['Grand', 'Royal', 'Heritage', 'Lotus'][code % 4]} ${['Hall', 'Palace', 'Gardens', 'Convention Centre'][(code >> 1) % 4]}`,
          city,
          guests: 150 + ((code * 37) % 400),
          status: isFuture ? 'UPCOMING' : 'DELIVERED',
          createdAt: createdAt > new Date() ? ago(1) : createdAt,
        },
      })
      code++
    }
  }
  await prisma.counter.create({ data: { studioId: studio.id, key: 'EVT', value: 1048 } })

  // --- Photo selections -----------------------------------------------------------
  type SelSeed = [code: number, event: number, photos: number, quota: number, picks: number, deadline: number, status: 'SENT' | 'IN_PROGRESS' | 'SUBMITTED', hue: number, prefix: string]
  const selSeed: SelSeed[] = [
    [311, 1045, 30, 20, 7, 2, 'IN_PROGRESS', 300, 'DIVYA'],
    [310, 1046, 24, 12, 12, 0, 'SUBMITTED', 160, 'MEERA'],
    [309, 1044, 24, 16, 6, 5, 'IN_PROGRESS', 25, 'SNEHA'],
    [308, 1043, 36, 20, 20, -20, 'SUBMITTED', 345, 'KAVYA'],
    [307, 1042, 20, 10, 0, 8, 'SENT', 45, 'NISHA'],
  ]
  const eventPhotos: Record<number, string[]> = {}
  for (const [scode, ev, count, quota, picks, deadline, status, hue, prefix] of selSeed) {
    const sel = await prisma.selection.create({
      data: {
        studioId: studio.id,
        code: `SEL-${scode}`,
        eventId: events[ev].id,
        quota,
        deadline: dateOnly(deadline),
        status,
        publicToken: token(),
        submittedAt: status === 'SUBMITTED' ? ago(scode === 310 ? 1 : 22) : null,
        lastRemindedAt: scode === 311 ? ago(0, 3) : null,
        createdAt: ago(14),
      },
    })
    const couple = await prisma.selectionMember.create({ data: { selectionId: sel.id, name: events[ev].title.split(' ').slice(0, 3).join(' ') } })
    const parent = await prisma.selectionMember.create({ data: { selectionId: sel.id, name: 'Mom' } })
    const ids = await addPhotos(ctx, events[ev].id, sel.id, count, hue, prefix)
    eventPhotos[ev] = ids
    for (let i = 0; i < picks; i++) {
      await prisma.photoPick.create({ data: { selectionId: sel.id, photoId: ids[i], memberId: couple.id } })
      if (i % 3 === 0) await prisma.photoPick.create({ data: { selectionId: sel.id, photoId: ids[i], memberId: parent.id } })
    }
    if (picks > 2) {
      await prisma.photoComment.create({
        data: { selectionId: sel.id, photoId: ids[1], memberId: couple.id, text: 'Can we get this one slightly brighter? Love it!' },
      })
    }
  }
  await prisma.counter.create({ data: { studioId: studio.id, key: 'SEL', value: 311 } })
  eventPhotos[1041] = await addPhotos(ctx, events[1041].id, null, 14, 210, 'LAKSHMI')
  eventPhotos[1040] = await addPhotos(ctx, events[1040].id, null, 10, 45, 'RIYA')

  // --- Digital albums ---------------------------------------------------------------
  type AlbSeed = [code: number, event: number, title: string, subtitle: string, location: string, status: 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED', hue: number, pages: number, updated: number]
  const albSeed: AlbSeed[] = [
    [88, 1043, 'Kavya & Aditya', 'Wedding · Hyderabad', 'Hyderabad', 'PUBLISHED', 345, 16, 10],
    [87, 1044, 'Sneha & Rahul', 'Pre-wedding · Pondicherry', 'Pondicherry', 'PUBLISHED', 25, 12, 14],
    [86, 1045, 'Divya & Arvind', 'Wedding · Madurai', 'Madurai', 'IN_REVIEW', 300, 12, 5],
    [85, 1046, 'Meera & Vikram', 'Engagement · Kochi', 'Kochi', 'DRAFT', 160, 8, 6],
    [84, 1041, 'Lakshmi & Suraj', 'Wedding · Coimbatore', 'Coimbatore', 'PUBLISHED', 210, 14, 31],
    [83, 1040, 'Riya & Harsh', 'Sangeet · Mumbai', 'Mumbai', 'DRAFT', 45, 8, 39],
  ]
  for (const [acode, ev, title, subtitle, location, status, hue, pages, updated] of albSeed) {
    const photos = eventPhotos[ev].slice(0, pages)
    const album = await prisma.album.create({
      data: {
        studioId: studio.id,
        code: `ALB-${acode}`,
        eventId: events[ev].id,
        title,
        subtitle,
        location,
        status,
        hue,
        publicToken: token(),
        coverPhotoId: photos[0],
        publishedAt: status === 'PUBLISHED' ? ago(updated) : null,
        createdAt: ago(updated + 10),
        updatedAt: ago(updated),
      },
    })
    await prisma.albumPage.createMany({
      data: photos.map((photoId, i) => ({ albumId: album.id, photoId, position: i, caption: CAPTIONS[i % CAPTIONS.length] })),
    })
    if (acode === 86) {
      await prisma.albumFeedback.createMany({
        data: [
          { albumId: album.id, spreadIndex: 0, authorName: 'Divya (Bride)', message: 'Love this full bleed photo! Can we brighten the background fairy lights?', createdAt: ago(2) },
          { albumId: album.id, spreadIndex: 1, kind: 'APPROVAL', authorName: 'Arvind (Groom)', createdAt: ago(2) },
          { albumId: album.id, spreadIndex: 3, authorName: 'Divya (Bride)', message: 'Our absolute favourite spread of the whole album! ❤️', resolvedAt: ago(1), createdAt: ago(3) },
        ],
      })
    }
  }
  await prisma.counter.create({ data: { studioId: studio.id, key: 'ALB', value: 88 } })

  // --- WhatsApp credits & messages ----------------------------------------------------------
  let balance = 0
  const ledger = async (delta: number, reason: 'PURCHASE' | 'MESSAGE' | 'SIGNUP_BONUS', createdAt: Date, ref?: string) => {
    balance += delta
    await prisma.creditLedger.create({
      data: { studioId: studio.id, delta, reason, balanceAfter: balance, createdAt, refType: ref ? 'message' : undefined, refId: ref },
    })
  }
  await ledger(50, 'SIGNUP_BONUS', ago(180))
  await ledger(500, 'PURCHASE', ago(170))
  await prisma.payment.create({
    data: { studioId: studio.id, purpose: 'CREDIT_PACK', description: '2,000 WhatsApp credits', amount: 139_900, status: 'SUCCESS', provider: 'mock', providerRef: `mock_${token()}`, createdAt: ago(60) },
  })
  await ledger(2000, 'PURCHASE', ago(60))
  const olderTypes = ['SELECTION_REMINDER', 'SELECTION_INVITE', 'ALBUM_SHARE', 'INVOICE_SEND', 'EVENT_CONFIRMATION'] as const
  const olderCount = 50 + 500 + 2000 - 1840 - 4
  for (let i = 0; i < olderCount; i++) {
    const full = genericClients[i % genericClients.length]
    const createdAt = ago(170 - Math.floor((i * 165) / olderCount), i % 12)
    const templateKey = olderTypes[i % olderTypes.length]
    const msg = await prisma.whatsAppMessage.create({
      data: {
        studioId: studio.id,
        templateKey,
        toName: full.name,
        toPhone: full.phone,
        body: `Message from Golden Hour Studios to ${full.name}`,
        link: `https://wa.me/${full.phone.replace('+', '')}`,
        credits: 1,
        status: 'SENT',
        createdAt,
      },
    })
    await ledger(-1, 'MESSAGE', createdAt, msg.id)
  }
  const recent: [string, string, string, number][] = [
    ['Priya', 'EVENT_CONFIRMATION', 'Hi Priya Raman! Your booking with Golden Hour Studios for *Priya & Karthik Wedding* is confirmed. 📸', 7],
    ['Rahul', 'INVOICE_SEND', 'Hi Rahul Menon, invoice INV-2026-0031 from Golden Hour Studios is due soon. Thank you!', 6],
    ['Kavya', 'ALBUM_SHARE', 'Hi Kavya Reddy! ✨ Your digital album *Kavya & Aditya* from Golden Hour Studios is ready to view.', 1],
    ['Divya', 'SELECTION_REMINDER', 'Hi Divya Suresh! 💕 A gentle reminder from Golden Hour Studios: you have picked 7 of 20 photos.', 0],
  ]
  for (const [who, templateKey, body, days] of recent) {
    const c = clients[who]
    const createdAt = ago(days, 2)
    const msg = await prisma.whatsAppMessage.create({
      data: { studioId: studio.id, templateKey, toName: c.name, toPhone: c.phone, body, link: `https://wa.me/${c.phone.replace('+', '')}?text=${encodeURIComponent(body)}`, credits: 1, status: 'SENT', createdAt },
    })
    await ledger(-1, 'MESSAGE', createdAt, msg.id)
  }
  await prisma.studio.update({ where: { id: studio.id }, data: { creditBalance: balance } })

  // --- Invoices ------------------------------------------------------------------------
  type InvSeed = [seq: number, client: string, event: number | null, issue: number, due: number, pos: string, items: [string, number, number, number][], paid: 'none' | 'full', milestones?: [string, number, number][]]
  const invSeed: InvSeed[] = [
    [34, 'Priya', 1048, -5, 10, '33', [['Wedding day coverage — candid + traditional', 1, 12_000_000, 18], ['Premium flipbook album (40 spreads)', 1, 3_000_000, 18]], 'none',
      [['Booking advance', 5_310_000, -5], ['Pre-shoot', 5_310_000, 5], ['Final delivery', 7_080_000, 10]]],
    [33, 'Ananya', 1047, -10, 4, '29', [['Reception coverage', 1, 10_000_000, 18]], 'none'],
    [32, 'Divya', 1045, -29, -15, '33', [['Wedding coverage', 1, 7_000_000, 18], ['Photo selection gallery', 1, 1_000_000, 18]], 'none'],
    [31, 'Rahul', 1044, -33, -18, '34', [['Pre-wedding shoot', 1, 5_500_000, 18]], 'full'],
    [30, 'Kavya', 1043, -46, -31, '36', [['Wedding coverage (2 days)', 2, 9_000_000, 18]], 'full'],
  ]
  let maxSeq = 0
  for (const [seq, who, ev, issue, due, pos, items, paid, milestones] of invSeed) {
    const issueDate = dateOnly(issue)
    const fy = financialYearStart(issueDate.toISOString().slice(0, 10))
    const totals = computeInvoiceTotals(items.map(([, qty, ratePaise, gstRate]) => ({ qty, ratePaise, gstRate })), '33', pos)
    const inv = await prisma.invoice.create({
      data: {
        studioId: studio.id,
        number: formatInvoiceNumber(fy, seq),
        clientId: clients[who].id,
        eventId: ev ? events[ev].id : null,
        issueDate,
        dueDate: dateOnly(due),
        placeOfSupply: pos,
        supplierState: '33',
        subtotal: totals.subtotalPaise,
        cgst: totals.cgstPaise,
        sgst: totals.sgstPaise,
        igst: totals.igstPaise,
        total: totals.totalPaise,
        amountPaid: paid === 'full' ? totals.totalPaise : 0,
        status: paid === 'full' ? 'PAID' : 'PENDING',
        paidAt: paid === 'full' ? dateOnly(due - 2) : null,
        createdAt: issueDate,
        items: {
          create: items.map(([description, qty, rate, gstRate], i) => ({
            position: i, description, sac: '998386', qty, rate, gstRate,
            taxable: totals.lines[i].taxablePaise,
            tax: totals.lines[i].cgstPaise + totals.lines[i].sgstPaise + totals.lines[i].igstPaise,
            total: totals.lines[i].totalPaise,
          })),
        },
        milestones: milestones
          ? { create: milestones.map(([label, amount, off], i) => ({ position: i, label, amount, dueDate: dateOnly(off), paidAt: null })) }
          : undefined,
        payments: paid === 'full' ? { create: { amount: totals.totalPaise, method: 'UPI', paidOn: dateOnly(due - 2), reference: `UPI${seq}8812` } } : undefined,
      },
    })
    if (milestones) {
      const sum = milestones.reduce((s, m) => s + m[1], 0)
      if (sum !== inv.total) throw new Error(`Seed milestones for ${inv.number} add up to ${sum}, total ${inv.total}`)
    }
    maxSeq = Math.max(maxSeq, seq)
    await prisma.counter.upsert({
      where: { studioId_key: { studioId: studio.id, key: `INV-${fy}` } },
      create: { studioId: studio.id, key: `INV-${fy}`, value: maxSeq },
      update: { value: maxSeq },
    })
  }

  // --- Referrals & wallet ---------------------------------------------------------------
  const referred: [string, number, boolean][] = [
    ['Lens & Light Studio', 12, true],
    ['Moments by Kiran', 28, true],
    ['Frame Tales', 34, false],
    ['Candid Clicks', 50, true],
  ]
  let wallet = 0
  for (const [name, days, rewarded] of referred) {
    const s = await prisma.studio.create({
      data: { name, slug: name.toLowerCase().replace(/[^a-z]+/g, '-'), referralCode: name.replace(/[^A-Za-z]/g, '').slice(0, 6).toUpperCase() + '11', createdAt: ago(days) },
    })
    await prisma.user.create({
      data: { studioId: s.id, name: `${name} Owner`, email: `owner@${s.slug}.example.com`, passwordHash: await bcrypt.hash(randomBytes(12).toString('hex'), 4), role: 'OWNER' },
    })
    await prisma.subscription.create({
      data: { studioId: s.id, planId: rewarded ? plans.PRO.id : plans.STARTER.id, isTrial: !rewarded, currentPeriodStart: ago(days), currentPeriodEnd: new Date(ago(days).getTime() + 30 * DAY) },
    })
    await prisma.websiteSettings.create({ data: { studioId: s.id, sections: WEBSITE_SECTION_KEYS.map((key) => ({ key, on: key !== 'blog' })) } })
    const ref = await prisma.referral.create({
      data: { referrerStudioId: studio.id, referredStudioId: s.id, rewardAmount: 150_000, status: rewarded ? 'REWARDED' : 'PENDING', rewardedAt: rewarded ? ago(days - 2) : null, createdAt: ago(days) },
    })
    if (rewarded) {
      wallet += 150_000
      await prisma.walletTxn.create({ data: { studioId: studio.id, delta: 150_000, reason: 'REFERRAL_REWARD', balanceAfter: wallet, refId: ref.id, createdAt: ago(days - 2) } })
    }
  }
  wallet -= 125_000
  await prisma.walletTxn.create({ data: { studioId: studio.id, delta: -125_000, reason: 'REDEMPTION', balanceAfter: wallet, refId: 'renewal-discount', createdAt: ago(5) } })
  await prisma.studio.update({ where: { id: studio.id }, data: { walletBalance: wallet } })

  // --- Website, leads, banners ----------------------------------------------------------------
  await prisma.websiteSettings.create({
    data: {
      studioId: studio.id,
      sections: [
        { key: 'portfolio', on: true }, { key: 'packages', on: true }, { key: 'reviews', on: true },
        { key: 'about', on: true }, { key: 'video', on: false }, { key: 'blog', on: false }, { key: 'enquiry', on: true },
      ],
      theme: 'Ivory Classic',
      primaryColor: '#8B1E3F',
      font: 'Playfair Display',
      tagline: 'Candid South Indian wedding stories, told with light.',
      seoTitle: 'Golden Hour Studios — Wedding Photographers in Chennai',
      seoDescription: 'Candid and traditional wedding photography across Tamil Nadu and South India. Albums, films and more.',
      visits: 3240,
    },
  })
  for (let i = 0; i < 28; i++) {
    const [city] = CITIES[i % CITIES.length]
    await prisma.lead.create({
      data: {
        studioId: studio.id,
        name: `${FIRST[(i * 3 + 2) % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
        phone: `+9198${String(30000000 + i * 2711).slice(0, 8)}`,
        email: i % 3 === 0 ? `lead${i}@example.com` : null,
        eventDate: dateOnly(30 + i * 9),
        city,
        message: i % 2 === 0 ? 'Looking for candid + traditional coverage for our wedding.' : 'Please share your packages.',
        createdAt: ago(i * 4 + 1),
      },
    })
  }
  const posterPath = join(webAssetsDir, 'wedding-poster-horizontal.png')
  const poster = await saveFile(ctx, 'BANNER', readFileSync(posterPath), 'png', 'image/png', 'forever-begins-here.png')
  await prisma.banner.create({
    data: { studioId: studio.id, title: 'Forever Begins Here', placement: 'GALLERY_HERO', ctaText: 'Book a call', ctaUrl: 'https://goldenhour.weddingz.com/contact', imageFileId: poster.id, startDate: dateOnly(-20), endDate: dateOnly(60), active: true, position: 0 },
  })
  const sale = await saveFile(ctx, 'BANNER', gradientPng(1280, 720, 345, 3), 'png', 'image/png', 'season-sale.png')
  await prisma.banner.create({
    data: { studioId: studio.id, title: 'Season Sale — 20% Off', placement: 'WEBSITE_POPUP', ctaText: 'Claim offer', ctaUrl: 'https://goldenhour.weddingz.com/offers', imageFileId: sale.id, startDate: dateOnly(10), endDate: dateOnly(40), active: true, position: 1 },
  })
  const monsoon = await saveFile(ctx, 'BANNER', gradientPng(1280, 720, 190, 5), 'png', 'image/png', 'monsoon-weddings.png')
  await prisma.banner.create({
    data: { studioId: studio.id, title: 'Monsoon Weddings', placement: 'GALLERY_HERO', imageFileId: monsoon.id, active: false, position: 2 },
  })

  // --- Support tickets ------------------------------------------------------------------------
  type TicketSeed = [code: number, subject: string, cat: 'TECHNICAL' | 'ACCOUNT' | 'BILLING', pri: 'HIGH' | 'MEDIUM' | 'LOW', status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED', days: number, msgs: [boolean, string][]]
  const tickets: TicketSeed[] = [
    [512, 'Selection link not loading for one client', 'TECHNICAL', 'HIGH', 'OPEN', 4, [[false, 'Divya says the selection link shows a blank page on her iPhone. Other family members can open it.']]],
    [509, 'Custom domain SSL setup', 'ACCOUNT', 'MEDIUM', 'IN_PROGRESS', 8, [
      [false, 'I pointed gallery.goldenhour.studio to your servers but the certificate is not active yet.'],
      [true, 'Thanks Arjun! DNS has propagated; the certificate will be issued within 24 hours. We will update you here.'],
    ]],
    [501, 'Invoice GST number format', 'BILLING', 'LOW', 'RESOLVED', 20, [
      [false, 'Can the invoice show our GSTIN under the studio name?'],
      [true, 'Yes — your GSTIN from My Profile now prints under the studio name on every invoice.'],
    ]],
  ]
  for (const [tcode, subject, category, priority, status, days, msgs] of tickets) {
    await prisma.ticket.create({
      data: {
        studioId: studio.id,
        code: `TKT-${tcode}`,
        subject,
        category,
        priority,
        status,
        createdAt: ago(days),
        lastActivityAt: ago(days - msgs.length + 1),
        messages: {
          create: msgs.map(([fromSupport, body], i) => ({
            body,
            fromSupport,
            authorUserId: fromSupport ? admin.id : owner.id,
            createdAt: ago(days - i),
          })),
        },
      },
    })
  }
  await prisma.counter.create({ data: { studioId: studio.id, key: 'TKT', value: 512 } })

  // --- Activity feed (notifications) --------------------------------------------------------------
  const notes: [string, string, string, string, string, number][] = [
    ['EVENT_CREATED', 'Priya Raman', 'confirmed the ceremony schedule', 'calendar-check', '/', 0.01],
    ['SELECTION_PICK', 'Divya Suresh', 'selected 7 of 20 photos', 'images', '/photo-selection', 0.05],
    ['INVOICE_PAID', 'Rahul Menon', 'paid invoice INV-2026-0031', 'credit-card', '/billing', 0.13],
    ['ALBUM_FEEDBACK', 'Divya (Bride)', 'left feedback on album Divya & Arvind', 'chat-square-quote', '/digital-album', 1],
    ['LEAD_RECEIVED', 'Keerthi Rao', 'sent an enquiry from your website', 'envelope-heart', '/my-website', 2],
  ]
  for (const [type, who, what, icon, link, days] of notes) {
    await prisma.notification.create({
      data: { studioId: studio.id, type, title: who, body: what, icon, link, createdAt: ago(days), readAt: days > 1 ? ago(0) : null },
    })
  }

  console.log(`Demo studio ready. Log in with ${DEMO_EMAIL} / ${DEMO_PASSWORD} (admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD})`)
}
