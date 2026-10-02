import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  istParts,
  SUBSCRIPTION_STATUS_LABELS,
  type AdminNotificationDto,
  type AdminSubscriptionRowDto,
  type Paginated,
  type SubscriptionStatus,
} from '@weddyzone/shared'
import { StatusPill } from '../components/ui'
import { api } from './api'

export const ADMIN_NOTIFICATIONS_KEY = ['admin', 'notifications'] as const

export function useAdminNotifications(opts: { page?: number; limit?: number; unread?: boolean } = {}) {
  const query = { page: opts.page ?? 1, limit: opts.limit ?? 8, unread: opts.unread ? 'true' : undefined }
  return useQuery({
    queryKey: [...ADMIN_NOTIFICATIONS_KEY, query],
    queryFn: () => api.get<Paginated<AdminNotificationDto> & { unreadCount: number }>('/admin/notifications', query),
    // New purchases and deadline alerts should show up without a reload.
    refetchInterval: 30_000,
  })
}

export function useAdminNotificationActions() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ADMIN_NOTIFICATIONS_KEY })
  const readOne = useMutation({ mutationFn: (id: string) => api.patch(`/admin/notifications/${id}/read`), onSuccess: refresh })
  const readAll = useMutation({ mutationFn: () => api.post('/admin/notifications/read-all'), onSuccess: refresh })
  return { readOne, readAll }
}

export function SubscriptionStatusPill({ status }: { status: SubscriptionStatus }) {
  return <StatusPill status={SUBSCRIPTION_STATUS_LABELS[status]} />
}

/** "12 days left" badge: green > 7, amber ≤ 7, red ≤ 1 or in grace, grey when over. */
export function DaysLeftBadge({ row }: { row: Pick<AdminSubscriptionRowDto, 'daysLeft' | 'tone' | 'status'> }) {
  const d = row.daysLeft
  const text =
    row.status === 'EXPIRED' || row.status === 'CANCELLED'
      ? d < 0
        ? `Ended ${-d}d ago`
        : 'Ended'
      : d < 0
        ? `${-d}d overdue`
        : d === 0
          ? 'Today'
          : `${d} day${d === 1 ? '' : 's'}`
  return <span className={`days-badge days-${row.tone}`}>{text}</span>
}

// Fixed month names: Intl gives "Sept" in some locales, unlike the alerts and emails.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "02 Oct 2027" (IST), matching the dates in alerts and emails. */
export function formatIstDate(iso: string): string {
  const p = istParts(new Date(iso))
  return `${String(p.day).padStart(2, '0')} ${MONTHS[p.month - 1]} ${p.year}`
}

/** "02 Oct 2027, 9:05 am" (IST). */
export function formatIstDateTime(iso: string): string {
  const p = istParts(new Date(iso))
  const h = p.hour % 12 || 12
  return `${formatIstDate(iso)}, ${h}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'am' : 'pm'}`
}
