// Enum values mirror the Prisma enums. Labels are what the UI shows.
export const USER_ROLES = ['OWNER', 'STAFF', 'SUPER_ADMIN'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const EVENT_TYPES = ['WEDDING', 'PRE_WEDDING', 'RECEPTION', 'ENGAGEMENT', 'OTHER'] as const
export type EventType = (typeof EVENT_TYPES)[number]
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  WEDDING: 'Wedding',
  PRE_WEDDING: 'Pre-wedding',
  RECEPTION: 'Reception',
  ENGAGEMENT: 'Engagement',
  OTHER: 'Other',
}

export const EVENT_STATUSES = ['UPCOMING', 'IN_PROGRESS', 'AWAITING_SELECTION', 'DELIVERED', 'CANCELLED'] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]
export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  UPCOMING: 'Upcoming',
  IN_PROGRESS: 'In Progress',
  AWAITING_SELECTION: 'Awaiting Selection',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
}

/**
 * Selection workflow: Draft (no photos) → Uploading (photos added, not shared yet) → Shared (SENT:
 * the link went out) → In progress (the client started picking) → Submitted (locked) → Delivered.
 */
export const SELECTION_STATUSES = ['DRAFT', 'UPLOADING', 'SENT', 'IN_PROGRESS', 'SUBMITTED', 'DELIVERED'] as const
export type SelectionStatus = (typeof SELECTION_STATUSES)[number]
/** EXPIRED is never stored: it is derived when the gallery expiry has passed before submission. */
export type SelectionEffectiveStatus = SelectionStatus | 'EXPIRED'
export const SELECTION_STATUS_LABELS: Record<SelectionEffectiveStatus, string> = {
  DRAFT: 'Draft',
  UPLOADING: 'Uploading',
  SENT: 'Shared',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Selected',
  DELIVERED: 'Delivered',
  EXPIRED: 'Expired',
}
/** Picks are final: the client submitted (or the studio already delivered). */
export const isSelectionLocked = (s: SelectionEffectiveStatus | SelectionStatus) => s === 'SUBMITTED' || s === 'DELIVERED'
/** Not shared with the client yet. */
export const isSelectionUnshared = (s: SelectionEffectiveStatus | SelectionStatus) => s === 'DRAFT' || s === 'UPLOADING'

/**
 * Album workflow: Draft → In review (shared with the client) → Changes requested → Approved → Sent to
 * print. PUBLISHED is the older name for a finished album and is shown as Approved.
 */
export const ALBUM_STATUSES = ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'PUBLISHED', 'SENT_TO_PRINT'] as const
export type AlbumStatus = (typeof ALBUM_STATUSES)[number]
export const ALBUM_STATUS_LABELS: Record<AlbumStatus, string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In review',
  CHANGES_REQUESTED: 'Changes requested',
  APPROVED: 'Approved',
  PUBLISHED: 'Approved',
  SENT_TO_PRINT: 'Sent to print',
}
/** Finished albums: shown on the studio website and counted as published. */
export const FINISHED_ALBUM_STATUSES: AlbumStatus[] = ['APPROVED', 'PUBLISHED', 'SENT_TO_PRINT']

export const PLAN_CODES = ['STARTER', 'PRO', 'STUDIO', 'ALL_ACCESS'] as const
export type PlanCode = (typeof PLAN_CODES)[number]

export const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const
export type BillingCycle = (typeof BILLING_CYCLES)[number]

export const INVOICE_STATUSES = ['PENDING', 'PAID', 'CANCELLED'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]
/** OVERDUE is derived: unpaid and due date before today. */
export type InvoiceEffectiveStatus = InvoiceStatus | 'OVERDUE'
export const INVOICE_STATUS_LABELS: Record<InvoiceEffectiveStatus, string> = {
  PENDING: 'Pending',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
  OVERDUE: 'Overdue',
}

export const PAYMENT_METHODS = ['UPI', 'CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  UPI: 'UPI',
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  CARD: 'Card',
  CHEQUE: 'Cheque',
}

export const GST_RATES = [0, 5, 12, 18, 28] as const
export type GstRate = (typeof GST_RATES)[number]
export const DEFAULT_SAC = '998386'

export const TICKET_CATEGORIES = ['GENERAL', 'BILLING', 'TECHNICAL', 'ACCOUNT', 'FEATURE_REQUEST'] as const
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]
export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  GENERAL: 'General inquiry',
  BILLING: 'Billing & payments',
  TECHNICAL: 'Technical issue',
  ACCOUNT: 'Account & access',
  FEATURE_REQUEST: 'Feature request',
}

export const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]
export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
}

export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
}

export const BANNER_PLACEMENTS = ['GALLERY_HERO', 'WEBSITE_HERO', 'WEBSITE_POPUP'] as const
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number]
export const BANNER_PLACEMENT_LABELS: Record<BannerPlacement, string> = {
  GALLERY_HERO: 'Gallery hero',
  WEBSITE_HERO: 'Website hero',
  WEBSITE_POPUP: 'Website popup',
}
/** Derived from the active flag and the date window. */
export type BannerStatus = 'Active' | 'Scheduled' | 'Expired' | 'Draft'

export const REFERRAL_STATUSES = ['PENDING', 'REWARDED'] as const
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number]

export const MESSAGE_TEMPLATE_KEYS = [
  'SELECTION_INVITE',
  'SELECTION_REMINDER',
  'ALBUM_SHARE',
  'INVOICE_SEND',
  'EVENT_CONFIRMATION',
  'REFERRAL_INVITE',
] as const
export type MessageTemplateKey = (typeof MESSAGE_TEMPLATE_KEYS)[number]
export const MESSAGE_TYPE_LABELS: Record<MessageTemplateKey, string> = {
  SELECTION_INVITE: 'Selection link',
  SELECTION_REMINDER: 'Selection reminder',
  ALBUM_SHARE: 'Album share',
  INVOICE_SEND: 'Invoice',
  EVENT_CONFIRMATION: 'Event confirmation',
  REFERRAL_INVITE: 'Referral invite',
}

export const WEBSITE_THEMES = ['Ivory Classic', 'Midnight Noir', 'Blush Editorial', 'Heritage Gold'] as const
export const WEBSITE_FONTS = ['Playfair Display', 'Manrope', 'Cormorant Garamond', 'Lora'] as const
export const WEBSITE_SECTION_KEYS = ['portfolio', 'packages', 'reviews', 'about', 'video', 'blog', 'enquiry'] as const
export type WebsiteSectionKey = (typeof WEBSITE_SECTION_KEYS)[number]
export const WEBSITE_SECTION_LABELS: Record<WebsiteSectionKey, string> = {
  portfolio: 'Portfolio gallery',
  packages: 'Packages & pricing',
  reviews: 'Client reviews',
  about: 'About the studio',
  video: 'Highlight film',
  blog: 'Blog',
  enquiry: 'Enquiry form',
}

export const FAQ_CATEGORIES = ['Getting started', 'Selections & albums', 'Billing & GST', 'Plans & credits', 'Website'] as const

export const NOTIFICATION_TYPES = [
  'SELECTION_SUBMITTED',
  'SELECTION_PICK',
  'ALBUM_FEEDBACK',
  'INVOICE_PAID',
  'LEAD_RECEIVED',
  'TICKET_REPLY',
  'REFERRAL_REWARD',
  'PLAN_CHANGED',
  'CREDITS_ADDED',
  'EVENT_CREATED',
  // Subscription lifecycle (studio and platform-admin alerts)
  'SUBSCRIPTION_PURCHASED',
  'SUBSCRIPTION_RENEWED',
  'SUBSCRIPTION_REMINDER',
  'SUBSCRIPTION_GRACE',
  'SUBSCRIPTION_EXPIRED',
  'SUBSCRIPTION_CANCELLED',
  'SUBSCRIPTION_CHANGED',
  'PAYMENT_FAILED',
  'USAGE_HIGH',
  'WINBACK_COUPON',
  'ADMIN_DIGEST',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

// WhatsApp credit packs sold through the payment service. Prices in paise.
export const CREDIT_PACKS = [
  { code: 'PACK_500', credits: 500, pricePaise: 39_900, popular: false },
  { code: 'PACK_2000', credits: 2000, pricePaise: 139_900, popular: true },
  { code: 'PACK_5000', credits: 5000, pricePaise: 299_900, popular: false },
] as const
export type CreditPackCode = (typeof CREDIT_PACKS)[number]['code']

export const REFERRAL_REWARD_PAISE = 150_000 // ₹1,500
// Below the 50-credit trial grant, so a new studio is not told to top up straight away.
export const LOW_CREDIT_THRESHOLD = 20
