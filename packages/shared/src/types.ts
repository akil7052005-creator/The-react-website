import type { FolderType, SendVia } from './selection'
// Response shapes returned by the API. Money fields end in `Paise`; dates are
// ISO strings (date-only fields are YYYY-MM-DD).
import type {
  AlbumStatus,
  BannerPlacement,
  BannerStatus,
  BillingCycle,
  EventStatus,
  EventType,
  InvoiceEffectiveStatus,
  MessageTemplateKey,
  PaymentMethod,
  PlanCode,
  ReferralStatus,
  SelectionEffectiveStatus,
  TicketCategory,
  TicketPriority,
  TicketStatus,
  UserRole,
  WebsiteSectionKey,
} from './enums'
import type { PlanLimits } from './schemas/billing'
import type { SupplyType } from './gst'
import type { AlertSettings, CancelReason, SubscriptionEventType, SubscriptionStatus } from './subscriptions'

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    fields?: Record<string, string>
  }
}

export interface Paginated<T> {
  data: T[]
  meta: { page: number; limit: number; total: number }
}

export interface PlanSummary {
  code: PlanCode
  name: string
}

export interface StudioDto {
  id: string
  name: string
  slug: string
  ownerName: string
  email: string | null
  phone: string | null
  city: string | null
  stateCode: string | null
  addressLine1: string | null
  addressLine2: string | null
  pincode: string | null
  gstin: string | null
  pan: string | null
  website: string | null
  /** Instagram handle without the @ (Profile » Social Setup). */
  instagramHandle?: string | null
  bio: string | null
  logoUrl: string | null
  referralCode: string
  walletBalancePaise: number
  creditBalance: number
  plan: PlanSummary
}

export interface UserDto {
  id: string
  name: string
  email: string
  phone: string | null
  role: UserRole
}

export interface MeDto {
  user: UserDto
  studio: StudioDto | null
  features: { faceRecognition: boolean }
}

export interface ClientDto {
  id: string
  name: string
  phone: string
  email: string | null
  city: string | null
  stateCode: string | null
  gstin: string | null
  notes: string | null
  createdAt: string
}

export interface ClientRef {
  id: string
  name: string
  phone: string
}

export interface EventDto {
  id: string
  code: string
  title: string
  type: EventType
  date: string
  venue: string
  city: string
  guests: number | null
  status: EventStatus
  notes: string | null
  client: ClientRef
  createdAt: string
}

export interface EventRef {
  id: string
  code: string
  title: string
  type: EventType
}

export interface SelectionMemberDto {
  id: string
  name: string
  phone: string | null
  pickCount: number
}

export interface SelectionDto {
  id: string
  code: string
  event: EventRef
  client: ClientRef
  quota: number
  deadline: string
  status: SelectionEffectiveStatus
  photoCount: number
  pickedCount: number
  /** Folders in the selection (Haldi, Wedding…). */
  folderCount?: number
  /** Videos in the selection. */
  videoCount?: number
  publicToken: string
  members: SelectionMemberDto[]
  submittedAt: string | null
  lastRemindedAt: string | null
  createdAt: string
  /** Event date (YYYY-MM-DD). */
  eventDate?: string
  sharedAt?: string | null
  /** The studio reopened it (Reset Selection / Unlock) and the client hasn't submitted again: shown as Pending. */
  reopened?: boolean
  deliveredAt?: string | null
  lastClientVisitAt?: string | null
  clientVisits?: number
  /** Gallery access settings. */
  hasPin?: boolean
  allowDownload?: boolean
  watermark?: boolean
  notesAllowed?: boolean
  /** Last "Send Options" send, and which card was used. */
  lastSentAt?: string | null
  sentVia?: SendVia | null
}

export interface SelectionFolderDto {
  id: string
  name: string
  position: number
  /** Images in the folder (videos are counted in videoCount). */
  photoCount: number
  pickedCount: number
  videoCount?: number
  /** photo (default) or video. */
  type?: FolderType
}

export interface SelectionLogDto {
  id: string
  actor: 'STUDIO' | 'CLIENT' | 'SYSTEM'
  action: string
  detail: string | null
  createdAt: string
}

/** Everything the event page needs in one call. */
export interface SelectionOverviewDto {
  selection: SelectionDto
  folders: SelectionFolderDto[]
  noteCount: number
  log: SelectionLogDto[]
}

/** Studio-wide defaults for new selections. */
export interface SelectionDefaultsDto {
  watermark: boolean
  allowDownload: boolean
  galleryDays: number
  notesAllowed: boolean
}

export interface PhotoDto {
  id: string
  url: string
  originalName: string
  size: number
  position: number
}

export interface StudioSelectionPhotoDto extends PhotoDto {
  /** Folder the photo was uploaded from, e.g. "Haldi" or "Wedding/Stage" (null for single files). */
  folder?: string | null
  /** The selection folder (Haldi, Wedding…) it is filed under. */
  folderId?: string | null
  /** Small, fast preview for the studio grid (the original stays at url). */
  previewUrl?: string
  /** 'video' for MP4/MOV clips (kept with the event, not shown to the client for picking). */
  media?: 'image' | 'video'
  mimeType?: string
  /** Stored as a preview made from the original; originalName is the file on the studio's computer. */
  compressed?: boolean
  /** The original file's size in bytes and pixel size (null when not known). */
  originalSize?: number | null
  originalWidth?: number | null
  originalHeight?: number | null
  /** Where the original sits under the uploaded folder, file name included ("Wedding/Haldi/IMG_1.jpg"). */
  relativePath?: string | null
  /** SHA-256 (hex) of the original, computed in the browser: Copy from my computer matches on it first. */
  sha256?: string | null
  /** The 400 px thumbnail (null for photos uploaded before thumbnails existed, and for videos). */
  thumbUrl?: string | null
  pickedBy: string[]
  comments: { memberName: string; text: string; createdAt: string }[]
}

export interface PublicSelectionDto {
  code: string
  studio: { name: string; logoUrl: string | null; phone: string | null }
  eventTitle: string
  clientName: string
  quota: number
  deadline: string
  status: SelectionEffectiveStatus
  readOnly: boolean
  pickedCount: number
  members: SelectionMemberDto[]
  photos: (PhotoDto & {
    pickedBy: string[]
    comments: { memberId: string; memberName: string; text: string; createdAt: string }[]
    folderId?: string | null
    /** Present only when the studio allows downloads. */
    downloadUrl?: string | null
  })[]
  folders?: { id: string; name: string; photoCount: number }[]
  notesAllowed?: boolean
  allowDownload?: boolean
  /** Hearts are on (the studio can turn picking off for a view-only gallery). */
  favoritesEnabled?: boolean
  /** Client can download a whole folder as a ZIP. */
  downloadAllFolder?: boolean
  /** Follow this Instagram account before viewing. */
  instagram?: { handle: string } | null
}

/** What the client sees before entering the PIN. */
export interface PublicSelectionLockedDto {
  pinRequired: true
  code: string
  studio: { name: string; logoUrl: string | null; phone: string | null }
  eventTitle: string
  clientName: string
}

export interface AlbumDto {
  id: string
  code: string
  title: string
  subtitle: string | null
  location: string | null
  status: AlbumStatus
  hue: number
  pageCount: number
  coverUrl: string | null
  publicToken: string
  event: EventRef
  openFeedbackCount: number
  updatedAt: string
  createdAt: string
}

export interface AlbumPageDto {
  id: string
  position: number
  caption: string | null
  photoId: string
  url: string
}

export interface AlbumFeedbackDto {
  id: string
  spreadIndex: number
  kind: 'COMMENT' | 'APPROVAL'
  authorName: string
  message: string | null
  resolvedAt: string | null
  createdAt: string
}

export interface AlbumDetailDto extends AlbumDto {
  pages: AlbumPageDto[]
  feedback: AlbumFeedbackDto[]
}

export interface PublicAlbumDto {
  code: string
  title: string
  subtitle: string | null
  location: string | null
  status: AlbumStatus
  studio: { name: string; logoUrl: string | null }
  pages: AlbumPageDto[]
  feedback: AlbumFeedbackDto[]
}

export interface PlanDto {
  id: string
  code: PlanCode
  name: string
  tagline: string
  monthlyPricePaise: number | null
  yearlyPricePaise: number
  limits: PlanLimits
  features: string[]
  /** Features on this plan that are not built yet ("Coming soon" instead of a check mark). */
  comingSoon: string[]
  popular: boolean
}

/** A plan as platform admins see it: hidden plans included. */
export interface AdminPlanDto extends PlanDto {
  isActive: boolean
}

export interface SubscriptionDto {
  plan: PlanDto
  cycle: BillingCycle
  status: SubscriptionStatus
  isTrial: boolean
  currentPeriodStart: string
  /** The deadline. */
  currentPeriodEnd: string
  /** When a plan in grace turns read-only (set once the deadline passes). */
  graceEndsAt: string | null
  cancelAtPeriodEnd: boolean
  autoRenew: boolean
  /** IST calendar days until the deadline (0 on the day, negative after). */
  daysLeft: number
  /** Expired or cancelled: the studio can view everything but not create events, albums or uploads. */
  readOnly: boolean
  pricePaise: number
}

/** GET /me/subscription — just enough for the dashboard banner. */
export interface MySubscriptionBannerDto {
  planName: string
  planCode: PlanCode
  status: SubscriptionStatus
  endDate: string
  graceEndsAt: string | null
  daysLeft: number
  readOnly: boolean
  autoRenew: boolean
  renewLink: string
}

export interface UsageItem {
  key: 'events' | 'albums' | 'storage' | 'credits'
  label: string
  used: number
  /** The plan's limit; null when there is none (unlimited plans, and WhatsApp credits). */
  limit: number | null
  /** WhatsApp credits only: the prepaid balance left (credits are bought, not a plan quota). */
  remaining?: number
  unit: string
}

export interface PaymentDto {
  id: string
  purpose: 'SUBSCRIPTION' | 'CREDIT_PACK'
  description: string
  /** Total charged, GST included. */
  amountPaise: number
  gstPaise: number
  status: 'SUCCESS' | 'FAILED' | 'PENDING'
  provider: string
  invoiceNumber: string | null
  paidAt: string | null
  createdAt: string
}

/** Tax invoice Weddyzone issues to a studio for a plan payment. */
export interface PlatformInvoiceDto {
  number: string
  date: string
  seller: { name: string; gstin: string | null; address: string | null; stateCode: string | null }
  buyer: { name: string; gstin: string | null; address: string | null; stateCode: string | null; email: string | null }
  description: string
  sac: string
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  totalPaise: number
  totalInWords: string
  paymentRef: string | null
}

export interface CheckoutResultDto {
  payment: PaymentDto
  testMode: boolean
}

export interface WhatsAppMessageDto {
  id: string
  toName: string
  toPhone: string
  templateKey: MessageTemplateKey
  typeLabel: string
  body: string
  credits: number
  status: 'SENT' | 'FAILED'
  link: string
  createdAt: string
}

export interface SendResultDto {
  message: WhatsAppMessageDto
  waLink: string
  creditBalance: number
}

export interface MessagePreviewDto {
  studioName: string
  toName: string
  eventTitle: string
  body: string
  link: string
  creditCost: number
}

export interface InvoiceItemDto {
  id: string
  description: string
  sac: string
  qty: number
  ratePaise: number
  gstRate: number
  taxablePaise: number
  taxPaise: number
  totalPaise: number
}

export interface MilestoneDto {
  id: string
  label: string
  amountPaise: number
  dueDate: string
  paidAt: string | null
}

export interface InvoicePaymentDto {
  id: string
  amountPaise: number
  method: PaymentMethod
  paidOn: string
  reference: string | null
  createdAt: string
}

export interface InvoiceDto {
  id: string
  number: string
  client: ClientRef & { email: string | null; gstin: string | null; city: string | null; stateCode: string | null }
  event: EventRef | null
  issueDate: string
  dueDate: string
  placeOfSupply: string
  supplyType: SupplyType
  subtotalPaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  totalPaise: number
  amountPaidPaise: number
  balancePaise: number
  status: InvoiceEffectiveStatus
  notes: string | null
  createdAt: string
}

export interface InvoiceDetailDto extends InvoiceDto {
  items: InvoiceItemDto[]
  milestones: MilestoneDto[]
  payments: InvoicePaymentDto[]
  studio: StudioDto
}

export interface InvoiceSummaryDto {
  outstandingPaise: number
  overduePaise: number
  collectedPaise: number
  counts: { all: number; pending: number; overdue: number; paid: number; cancelled: number }
}

export interface ReferralDto {
  id: string
  studioName: string
  joinedAt: string
  status: ReferralStatus
  rewardPaise: number
  rewardedAt: string | null
}

export interface WalletTxnDto {
  id: string
  deltaPaise: number
  reason: string
  balanceAfterPaise: number
  createdAt: string
}

export interface ReferralOverviewDto {
  code: string
  link: string
  walletBalancePaise: number
  totalEarnedPaise: number
  referrals: ReferralDto[]
  transactions: WalletTxnDto[]
  shareText: string
}

export interface WebsiteSectionDto {
  key: WebsiteSectionKey
  label: string
  on: boolean
}

export interface WebsiteSettingsDto {
  sections: WebsiteSectionDto[]
  theme: string
  primaryColor: string
  font: string
  tagline: string | null
  customDomain: string | null
  seoTitle: string | null
  seoDescription: string | null
  videoUrl: string | null
  visits: number
  leadCount: number
  publicUrl: string
  /** Draft until the portfolio (published albums) has at least one item. */
  status: 'Live' | 'Draft'
}

export interface PublicWebsiteDto {
  studio: { name: string; slug: string; city: string | null; phone: string | null; email: string | null; bio: string | null; logoUrl: string | null }
  settings: Omit<WebsiteSettingsDto, 'visits' | 'leadCount' | 'publicUrl' | 'status'>
  plans: { name: string; tagline: string }[]
  albums: { title: string; subtitle: string | null; coverUrl: string | null; link: string }[]
  banners: BannerDto[]
}

export interface LeadDto {
  id: string
  name: string
  phone: string
  email: string | null
  eventDate: string | null
  city: string | null
  message: string | null
  createdAt: string
}

export interface BannerDto {
  id: string
  title: string
  placement: BannerPlacement
  ctaText: string | null
  ctaUrl: string | null
  imageUrl: string
  startDate: string | null
  endDate: string | null
  active: boolean
  position: number
  status: BannerStatus
}

export interface FaqDto {
  id: string
  category: string
  question: string
  answer: string
  myVote: boolean | null
}

/** An FAQ as platform admins see it: drafts included, with the "Was this helpful?" counts. */
export interface AdminFaqDto {
  id: string
  category: string
  question: string
  answer: string
  position: number
  isPublished: boolean
  helpfulYes: number
  helpfulNo: number
  updatedAt: string
}

export interface TicketMessageDto {
  id: string
  body: string
  authorName: string
  fromSupport: boolean
  attachmentUrl: string | null
  attachmentName: string | null
  createdAt: string
}

export interface TicketDto {
  id: string
  code: string
  subject: string
  category: TicketCategory
  priority: TicketPriority
  status: TicketStatus
  studioName?: string
  createdAt: string
  lastActivityAt: string
}

export interface TicketDetailDto extends TicketDto {
  messages: TicketMessageDto[]
}

export interface NotificationDto {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  icon: string
  readAt: string | null
  createdAt: string
}

export interface SearchResultDto {
  type: 'client' | 'event' | 'album' | 'invoice'
  id: string
  title: string
  subtitle: string
  link: string
}

export interface DashboardDto {
  stats: {
    totalEvents: { value: number; trend: number }
    photoSelections: { value: number; trend: number }
    digitalAlbums: { value: number; trend: number }
    upcomingEvents: number
    activeSelections: number
    publishedAlbums: number
    /** Selections the client has submitted. */
    completedSelections: number
  }
  nextAssignment: (EventDto & { daysLeft: number }) | null
  recentEvents: EventDto[]
  activity: NotificationDto[]
  monthlyEvents: { month: string; count: number }[]
  pipeline: { name: string; progress: number; link: string }[]
  recentAlbums: AlbumDto[]
  activeBanner: BannerDto | null
  /** Client activity and this month's additions for the dashboard. */
  workflow?: DashboardWorkflowDto
}

export interface DashboardWorkflowDto {
  /** Latest things clients did in their galleries. */
  activity: {
    id: string
    selectionId: string
    eventTitle: string
    clientName: string
    action: string
    detail: string | null
    at: string
    /** The selection's status at the time of the action (for the pill); DRAFT shows as Pending. */
    status?: SelectionEffectiveStatus
    /** Reopened by the studio and not submitted again: shown as Pending. */
    reopened?: boolean
  }[]
  /** Created this month (the "+N this month" chips). */
  createdThisMonth: { events: number; selections: number }
}

// ------------------------------------------------------------------ platform admin: subscriptions

export interface AdminSubscriptionRowDto {
  id: string
  studio: { id: string; name: string; slug: string }
  owner: { name: string; email: string; phone: string | null }
  plan: { id: string; code: PlanCode; name: string }
  cycle: BillingCycle
  /** Last amount paid for this subscription, excluding GST (admin amounts never include GST). */
  amountPaise: number
  startDate: string
  endDate: string
  graceEndsAt: string | null
  daysLeft: number
  tone: 'green' | 'amber' | 'red' | 'grey'
  status: SubscriptionStatus
  isTrial: boolean
  autoRenew: boolean
  cancelAtPeriodEnd: boolean
  createdAt: string
}

export interface SubscriptionEventDto {
  id: string
  type: SubscriptionEventType
  fromPlan: string | null
  toPlan: string | null
  amountPaise: number | null
  actorName: string | null
  note: string | null
  createdAt: string
}

export interface SentNotificationDto {
  id: string
  recipientType: 'ADMIN' | 'STUDIO'
  channel: 'IN_APP' | 'EMAIL' | 'WHATSAPP'
  type: string
  title: string
  message: string
  sentAt: string | null
  error: string | null
  createdAt: string
}

export interface AdminSubscriptionDetailDto extends AdminSubscriptionRowDto {
  studioProfile: {
    city: string | null
    stateCode: string | null
    gstin: string | null
    email: string | null
    phone: string | null
    createdAt: string
  }
  gatewaySubscriptionId: string | null
  cancelReason: CancelReason | null
  cancelDetails: string | null
  usage: UsageItem[]
  events: SubscriptionEventDto[]
  payments: PaymentDto[]
  notifications: SentNotificationDto[]
}

export interface AdminStatsDto {
  activeByPlan: { code: PlanCode; name: string; count: number }[]
  trials: number
  mrrPaise: number
  arrPaise: number
  newThisMonth: number
  expiringIn7Days: number
  expiredThisMonth: number
  failedPayments: number
  inGrace: number
  /** Subscriptions whose last payment failed (still before their deadline). */
  paymentFailed: number
  /** In grace, payment failed or expiring within 7 days (each subscription counted once). */
  needsAttention: number
  /** Last 12 months, oldest first; month is YYYY-MM. The last point is MRR now (= mrrPaise). */
  mrrTrend: { month: string; mrrPaise: number }[]
  newVsChurned: { month: string; new: number; churned: number }[]
  cancelReasons: { reason: CancelReason; count: number }[]
}

export interface AdminNotificationDto {
  id: string
  type: string
  title: string
  message: string
  link: string | null
  readAt: string | null
  createdAt: string
}

export interface AdminAlertSettingsDto extends AlertSettings {
  updatedAt: string | null
  /** False when no WhatsApp provider is set up: WhatsApp alerts are skipped, not attempted. */
  whatsappConfigured?: boolean
}

export interface TwoFactorStatusDto {
  enabled: boolean
}

export interface TwoFactorSetupDto {
  secret: string
  otpauthUrl: string
}
