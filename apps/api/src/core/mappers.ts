import type { Album, Client, Event, Selection, SelectionMember } from '@prisma/client'
import type {
  AlbumDto,
  ClientDto,
  ClientRef,
  EventDto,
  EventRef,
  SelectionDto,
  SelectionEffectiveStatus,
} from '@weddyzone/shared'
import { todayIST } from '@weddyzone/shared'
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

export const eventRef = (e: Event): EventRef => ({ id: e.id, code: e.code, title: e.title })

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

/** EXPIRED is derived on read: the deadline passed before the client submitted. */
export function selectionStatus(s: Pick<Selection, 'status' | 'deadline'>, today = todayIST()): SelectionEffectiveStatus {
  if (s.status !== 'SUBMITTED' && toIso(s.deadline) < today) return 'EXPIRED'
  return s.status
}

export type SelectionWithRelations = Selection & {
  event: Event & { client: Client }
  members: SelectionMember[]
  _count: { photos: number }
}

export function selectionDto(
  s: SelectionWithRelations,
  pickedCount: number,
  memberPicks: Map<string, number>,
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
    pickedCount,
    publicToken: s.publicToken,
    members: s.members.map((m) => ({ id: m.id, name: m.name, phone: m.phone, pickCount: memberPicks.get(m.id) ?? 0 })),
    submittedAt: s.submittedAt?.toISOString() ?? null,
    lastRemindedAt: s.lastRemindedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
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
