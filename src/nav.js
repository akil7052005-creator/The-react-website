// Sidebar menu, grouped into sections. Add a page here and in main.jsx.
// Icons are Bootstrap Icons names: https://icons.getbootstrap.com
export const navSections = [
  {
    label: 'Services',
    items: [
      { to: '/', label: 'Dashboard', icon: 'grid-1x2' },
      { to: '/photo-selection', label: 'Photo Selection', icon: 'images' },
      { to: '/digital-album', label: 'Digital Album', icon: 'journal-album' },
      { to: '/face-recognition', label: 'AI Face Recognition', icon: 'person-bounding-box' },
    ],
  },
  {
    label: 'Plans & Wallet',
    items: [
      { to: '/subscriptions', label: 'All Subscriptions', icon: 'box-seam' },
      { to: '/my-subscription', label: 'My Subscription', icon: 'patch-check' },
      { to: '/all-access', label: 'All-Access', icon: 'stars', badge: 'New' },
      { to: '/refer-and-earn', label: 'Refer & Earn', icon: 'wallet2' },
      { to: '/whatsapp-credit', label: 'WhatsApp Credit', icon: 'whatsapp' },
    ],
  },
  {
    label: 'Business',
    items: [
      { to: '/billing', label: 'Billing', icon: 'receipt' },
      { to: '/my-website', label: 'My Website', icon: 'globe2' },
      { to: '/gallery-banner', label: 'Gallery Banner', icon: 'image' },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/profile', label: 'My Profile', icon: 'person-circle' },
      { to: '/help', label: 'Help Center', icon: 'question-circle' },
      { to: '/support', label: 'Support Tickets', icon: 'headset' },
    ],
  },
]
