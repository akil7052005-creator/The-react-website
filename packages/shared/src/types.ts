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
  publicToken: string
  members: SelectionMemberDto[]
  submittedAt: string | null
  lastRemindedAt: string | null
  createdAt: string
}

export interface PhotoDto {
  id: string
  url: string
  originalName: string
  size: number
  position: number
}

export interface StudioSelectionPhotoDto extends PhotoDto {
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
  })[]
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
  popular: boolean
}

export interface SubscriptionDto {
  plan: PlanDto
  cycle: BillingCycle
  status: 'ACTIVE' | 'CANCELLED'
  isTrial: boolean
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  pricePaise: number
}

export interface UsageItem {
  key: 'events' | 'albums' | 'storage' | 'credits'
  label: string
  used: number
  limit: number | null
  unit: string
}

export interface PaymentDto {
  id: string
  purpose: 'SUBSCRIPTION' | 'CREDIT_PACK'
  description: string
  amountPaise: number
  status: 'SUCCESS' | 'FAILED' | 'PENDING'
  provider: string
  createdAt: string
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
  }
  nextAssignment: (EventDto & { daysLeft: number }) | null
  recentEvents: EventDto[]
  activity: NotificationDto[]
  monthlyEvents: { month: string; count: number }[]
  pipeline: { name: string; progress: number; link: string }[]
  recentAlbums: AlbumDto[]
  activeBanner: BannerDto | null
}
