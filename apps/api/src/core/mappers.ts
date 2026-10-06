import type { Album, Client, Event, Selection, SelectionMember } from '@prisma/client'
import type {
  AlbumDto,
  ClientDto,
  ClientRef,
  EventDto,
  EventRef,
  SelectionDto,
  SelectionEffectiveStatus,
  SendVia,
} from '@weddyzone/shared'
import { SEND_VIA, todayIST } from '@weddyzone/shared'
import { toIso } from '../common/util'

export const clientRef = (c: Client): ClientRef => ({ id: c.id, name: c.name, phone: c.phone })

export const clientDto = (c: Client): ClientDto => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  email: c.email,
  city: c.city,
  stateCode: c.stateCode,
  gstin: c.gstin,
  notes: c.notes,
  createdAt: c.createdAt.toISOString(),
})

export const eventRef = (e: Event): EventRef => ({ id: e.id, code: e.code, title: e.title, type: e.type })

export const eventDto = (e: Event & { client: Client }): EventDto => ({
  id: e.id,
  code: e.code,
  title: e.title,
  type: e.type,
  date: toIso(e.date),
  venue: e.venue,
  city: e.city,
  guests: e.guests,
  status: e.status,
  notes: e.notes,
  client: clientRef(e.client),
  createdAt: e.createdAt.toISOString(),
})

/** EXPIRED is derived on read: the gallery expiry passed before the client submitted. */
export function selectionStatus(s: Pick<Selection, 'status' | 'deadline'>, today = todayIST()): SelectionEffectiveStatus {
  if (s.status !== 'SUBMITTED' && s.status !== 'DELIVERED' && toIso(s.deadline) < today) return 'EXPIRED'
  return s.status
}

/** The studio reopened it (Reset Selection / Unlock) and the client hasn't submitted again yet. */
export const isReopened = (s: Pick<Selection, 'status' | 'reopenedAt'>) => !!s.reopenedAt && s.status !== 'SUBMITTED' && s.status !== 'DELIVERED'

export type SelectionWithRelations = Selection & {
  event: Event & { client: Client }
  members: SelectionMember[]
  _count: { photos: number; folders?: number }
}

export function selectionDto(
  s: SelectionWithRelations,
  pickedCount: number,
  memberPicks: Map<string, number>,
  videoCount = 0,
): SelectionDto {
  return {
    id: s.id,
    code: s.code,
    event: eventRef(s.event),
    client: clientRef(s.event.client),
    quota: s.quota,
    deadline: toIso(s.deadline),
    status: selectionStatus(s),
    photoCount: s._count.photos,
    folderCount: s._count.folders ?? 0,
    videoCount,
    pickedCount,
    publicToken: s.publicToken,
    members: s.members.map((m) => ({ id: m.id, name: m.name, phone: m.phone, pickCount: memberPicks.get(m.id) ?? 0 })),
    submittedAt: s.submittedAt?.toISOString() ?? null,
    lastRemindedAt: s.lastRemindedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    eventDate: toIso(s.event.date),
    sharedAt: s.sharedAt?.toISOString() ?? null,
    reopened: isReopened(s),
    deliveredAt: s.deliveredAt?.toISOString() ?? null,
    lastClientVisitAt: s.lastClientVisitAt?.toISOString() ?? null,
    clientVisits: s.clientVisits,
    hasPin: !!s.pinHash,
    allowDownload: s.allowDownload,
    watermark: s.watermark,
    notesAllowed: s.notesAllowed,
    lastSentAt: s.lastSentAt?.toISOString() ?? null,
    sentVia: (SEND_VIA as readonly string[]).includes(s.sentVia ?? '') ? (s.sentVia as SendVia) : null,
  }
}

export type AlbumWithRelations = Album & {
  event: Event
  _count: { pages: number }
  feedback?: { id: string }[]
}

export function albumDto(a: AlbumWithRelations, coverUrl: string | null): AlbumDto {
  return {
    id: a.id,
    code: a.code,
    title: a.title,
    subtitle: a.subtitle,
    location: a.location,
    status: a.status,
    hue: a.hue,
    pageCount: a._count.pages,
    coverUrl,
    publicToken: a.publicToken,
    event: eventRef(a.event),
    openFeedbackCount: a.feedback?.length ?? 0,
    updatedAt: a.updatedAt.toISOString(),
    createdAt: a.createdAt.toISOString(),
  }
}
