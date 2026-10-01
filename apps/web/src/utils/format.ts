/** Formats rupees (whole or decimal). */
export const formatINR = (rupees: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
  }).format(rupees)

/** Formats an API money value (integer paise) as ₹. */
export const formatMoney = (paise: number) => formatINR(paise / 100)

export const formatNumber = (n: number) => new Intl.NumberFormat('en-IN').format(n)

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/** "12 min ago", "Yesterday", "Sep 24" — used by activity feeds and logs. */
export function timeAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime())
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min} min ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

// Maps any status label to a colour tone used by <StatusPill>.
const tones: Record<string, string[]> = {
  success: ['Delivered', 'Completed', 'Published', 'Paid', 'Live', 'Active', 'Resolved', 'Read', 'Rewarded', 'Sent', 'Success'],
  warning: ['Awaiting Selection', 'Pending', 'In Review', 'Processing', 'Scheduled', 'Medium'],
  info: ['Upcoming', 'In Progress', 'Open'],
  danger: ['Overdue', 'Failed', 'High', 'Expired', 'Cancelled'],
}

export function statusTone(status: string) {
  for (const [tone, list] of Object.entries(tones)) {
    if (list.includes(status)) return tone
  }
  return 'neutral'
}

export function initials(name: string) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function daysUntil(isoDate: string, today = new Date()): number {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const d = new Date(`${isoDate}T00:00:00`).getTime()
  return Math.round((d - t) / 86_400_000)
}
