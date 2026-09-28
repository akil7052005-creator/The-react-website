// Sidebar menu, grouped into sections. Add a page here and in main.jsx.
// Icons are Bootstrap Icons names: https://icons.getbootstrap.com
export const navSections = [
  {
    label: 'Services',
    items: [
      { to: '/', label: 'Dashboard', icon: 'grid-1x2', featureKey: 'dashboard' },
      { to: '/photo-selection', label: 'Photo Selection', icon: 'images', featureKey: 'photoSelection' },
      { to: '/digital-album', label: 'Digital Album', icon: 'journal-album', featureKey: 'digitalAlbum' },
      { to: '/face-recognition', label: 'AI Face Recognition', icon: 'person-bounding-box', featureKey: 'faceRecognition' },
    ],
  },
  {
    label: 'Plans & Wallet',
    items: [
      { to: '/subscriptions', label: 'All Subscriptions', icon: 'box-seam', featureKey: 'subscriptions' },
      { to: '/my-subscription', label: 'My Subscription', icon: 'patch-check', featureKey: 'mySubscription' },
      { to: '/all-access', label: 'All-Access', icon: 'stars', badge: 'New', featureKey: 'allAccess' },
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
