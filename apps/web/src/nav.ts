import { features } from './lib/env'

// Sidebar menu, grouped into sections. Add a page here and in main.tsx.
// Icons are Bootstrap Icons names: https://icons.getbootstrap.com
export interface NavItem {
  to: string
  label: string
  icon: string
  featureKey: string
  badge?: string
  /** Only shown when this feature flag is on. */
  flag?: keyof typeof features
}

const allSections: { label: string; items: NavItem[] }[] = [
  {
    label: 'Services',
    items: [
      { to: '/', label: 'Dashboard', icon: 'grid-1x2', featureKey: 'dashboard' },
      { to: '/photo-selection', label: 'Photo Selection', icon: 'images', featureKey: 'photoSelection' },
      { to: '/face-recognition', label: 'AI Face Recognition', icon: 'person-bounding-box', featureKey: 'faceRecognition', flag: 'faceRecognition' },
    ],
  },
  {
    label: 'Plans & Wallet',
    items: [
      { to: '/subscriptions', label: 'All Subscriptions', icon: 'box-seam', featureKey: 'subscriptions' },
      { to: '/my-subscription', label: 'My Subscription', icon: 'patch-check', featureKey: 'mySubscription' },
      { to: '/all-access', label: 'VIP', icon: 'stars', badge: 'New', featureKey: 'allAccess' },
      { to: '/refer-and-earn', label: 'Refer & Earn', icon: 'wallet2', featureKey: 'referAndEarn' },
      { to: '/whatsapp-credit', label: 'WhatsApp Credit', icon: 'whatsapp', featureKey: 'whatsappCredit' },
    ],
  },
  {
    label: 'Business',
    items: [
      { to: '/billing', label: 'Billing', icon: 'receipt', featureKey: 'billing' },
      { to: '/my-website', label: 'My Website', icon: 'globe2', featureKey: 'myWebsite' },
      { to: '/gallery-banner', label: 'Gallery Banner', icon: 'image', featureKey: 'galleryBanner' },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/profile', label: 'My Profile', icon: 'person-circle', featureKey: 'profile' },
      { to: '/help', label: 'Help Center', icon: 'question-circle', featureKey: 'help' },
      { to: '/support', label: 'Support Tickets', icon: 'headset', featureKey: 'support' },
    ],
  },
]

export const navSections = allSections.map((s) => ({
  ...s,
  items: s.items.filter((i) => !i.flag || features[i.flag]),
}))
