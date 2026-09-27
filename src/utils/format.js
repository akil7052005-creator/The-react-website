export const formatINR = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

export const formatNumber = (n) => new Intl.NumberFormat('en-IN').format(n)

export const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

// Maps any status label from db.json to a colour tone used by <StatusPill>.
const tones = {
  success: ['Delivered', 'Completed', 'Published', 'Paid', 'Live', 'Active', 'Resolved', 'Read'],
  warning: ['Awaiting Selection', 'Pending', 'In Review', 'Processing', 'Scheduled', 'Medium'],
  info: ['Upcoming', 'In Progress', 'Open'],
  danger: ['Overdue', 'Failed', 'High'],
}

export function statusTone(status) {
  for (const [tone, list] of Object.entries(tones)) {
    if (list.includes(status)) return tone
  }
  return 'neutral'
}

export function initials(name) {
  return name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}
