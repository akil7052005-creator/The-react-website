// Comprehensive feature descriptions and cursor-hover information across Weddingz studio platform.

export const featureInfo = {
  // Navigation & Core Services
  dashboard: {
    title: 'Studio Command Center',
    badge: 'Real-time Hub',
    icon: 'grid-1x2',
    summary: 'The central nerve center for your entire photography studio operations and client pipeline.',
    highlights: [
      'Live tracking of 48+ seasonal wedding shoots and proofing progress',
      'Instant access to recent bookings, selection statuses, and guest face searches',
      'Automated revenue insights, monthly shoot volume, and quick action shortcuts'
    ],
    metric: '99.9% uptime · Real-time live sync',
    tip: 'Review your upcoming delivery deadlines here every morning.'
  },
  photoSelection: {
    title: 'Smart Photo Selection Gallery',
    badge: 'Client Favorite',
    icon: 'images',
    summary: 'Give clients a private, mobile-optimized proofing gallery where they heart and select their favorite shots.',
    highlights: [
      'Clients select on any phone or laptop with zero login friction',
      'Real-time quota lock prevents over-selection beyond package limits',
      '1-click export of selected filenames to Lightroom and Photoshop'
    ],
    metric: 'Saves ~4.5 hours per event in back-and-forth emails',
    tip: 'Send automated WhatsApp reminders with one click to keep deadlines on track.'
  },
  digitalAlbum: {
    title: '3D Interactive Digital Album',
    badge: '3D Interactive',
    icon: 'journal-album',
    summary: 'Turn designed wedding spreads into stunning 3D virtual flipbooks that couples can share worldwide.',
    highlights: [
      'Realistic page-curl animations and tactile sound effects on touch',
      'Zero-loss high resolution zoom on intricate bridal jewelry and attire',
      'Client spread approval mode with direct revision notes on pages'
    ],
    metric: 'Over 85% of couples share their flipbook with 20+ family members',
    tip: 'Enable client revision mode before sending albums to print labs.'
  },
  faceRecognition: {
    title: 'AI Neural Face Recognition',
    badge: 'AI Powered',
    icon: 'person-bounding-box',
    summary: 'Wedding guests take one selfie and instantly discover all the photos they appear in from thousands of shots.',
    highlights: [
      'Instant matching in < 1.5 seconds powered by neural facial embeddings',
      'Venue QR code table stands allow guests to search without downloading an app',
      'Custom watermark overlay protects your studio copyright and branding'
    ],
    metric: '12,480+ face matches processed with 99.8% recognition precision',
    tip: 'Print the QR code on reception tables for viral word-of-mouth branding.'
  },

  // Plans & Wallet
  subscriptions: {
    title: 'Studio Subscription Plans',
    badge: 'Flexible Pricing',
    icon: 'box-seam',
    summary: 'Transparent studio tiers designed to scale as your booking calendar fills up.',
    highlights: [
      'Upgrade, downgrade, or cancel anytime with zero lock-in contracts',
      'Choose between Monthly and Yearly billing with 2 months free',
      'Includes cloud storage, selection galleries, and AI face recognition quotas'
    ],
    metric: 'Save 17% on annual studio commitments',
    tip: 'Studios shooting 3+ weddings a month save the most on Pro & All-Access tiers.'
  },
  mySubscription: {
    title: 'Subscription & Quota Manager',
    badge: 'Active: Pro',
    icon: 'patch-check',
    summary: 'Monitor your active studio tier, monthly usage quotas, and upcoming renewals.',
    highlights: [
      'Live storage utilization tracker (212 GB / 500 GB used)',
      'Event and face scan quotas with clear monthly reset countdowns',
      'Download GST tax invoices and payment receipts in one click'
    ],
    metric: 'Pro plan renewal: 2nd Nov · 12 days left',
    tip: 'Track your face scan counter before big multi-day destination weddings.'
  },
  allAccess: {
    title: 'Weddingz All-Access Pass',
    badge: 'VIP Unlimited',
    icon: 'stars',
    summary: 'The ultimate studio power tier: unmetered weddings, storage, face scans, and VIP concierge.',
    highlights: [
      'Unlimited events, selections, and AI face scans for all year',
      'Massive 5 TB cloud storage with original RAW / high-res download links',
      '10,000 free WhatsApp credits included every year plus dedicated manager'
    ],
    metric: 'Best value for multi-crew wedding production houses',
    tip: 'Eliminates all per-event stress during peak wedding months (Oct - Feb).'
  },
  referAndEarn: {
    title: 'Partner Referral Network',
    badge: '₹1,500 Reward',
    icon: 'wallet2',
    summary: 'Earn ₹1,500 cash in your studio wallet for every photographer who joins Weddingz with your link.',
    highlights: [
      'Both you and your referred studio receive ₹1,500 instant wallet credits',
      'Wallet credits can be redeemed directly toward renewals and WhatsApp packs',
      'Real-time tracking of referred studios, onboarding status, and payouts'
    ],
    metric: '₹7,500 total referral earnings to date',
    tip: 'Share your code in your regional wedding photographer WhatsApp groups.'
  },
  whatsappCredit: {
    title: 'WhatsApp Business Automation',
    badge: 'Meta Certified',
    icon: 'whatsapp',
    summary: 'Send official WhatsApp proofing links, selection nudges, and invoices directly to clients.',
    highlights: [
      '98% message open rate compared to under 18% for traditional email',
      'Automated personalized client templates with wedding names and gallery links',
      'Credits never expire and work across selection, face AI, and billing'
    ],
    metric: '1,840 credits available (≈ 9+ full weddings)',
    tip: 'WhatsApp notifications cut client selection turnaround time by 60%.'
  },

  // Business Suite
  billing: {
    title: 'GST Invoicing & Payments',
    badge: 'GST Compliant',
    icon: 'receipt',
    summary: 'Create professional, GST-compliant photography invoices and track milestone payments.',
    highlights: [
      'Automated CGST, SGST, and IGST rate breakdown with your studio GSTIN',
      'Direct WhatsApp invoice delivery with UPI and payment gateway links',
      'Automated tracking of advance deposits, mid-payments, and overdue balances'
    ],
    metric: '₹8.45L collected this quarter with 100% on-time receipts',
    tip: 'Schedule balance payment reminders 48 hours before delivering final albums.'
  },
  myWebsite: {
    title: 'Portfolio Website Builder',
    badge: 'Custom Domain',
    icon: 'globe2',
    summary: 'Launch a lightning-fast, high-converting photography website with your custom domain.',
    highlights: [
      'Showcase your best cinematic wedding stories, films, and client reviews',
      'Built-in lead capture forms sending new booking alerts directly to WhatsApp',
      'Optimized for mobile viewing and local Google SEO ranking'
    ],
    metric: '2,840 monthly views with 18 high-intent bridal enquiries',
    tip: 'Keep your hero banner updated with your latest destination shoot.'
  },
  galleryBanner: {
    title: 'Hero Banner Showcase',
    badge: 'Brand Builder',
    icon: 'image',
    summary: 'Elevate your proofing galleries and portfolio website with immersive full-width hero imagery.',
    highlights: [
      'Custom banner placement across client selection portals and public pages',
      'Automatic mobile-first responsive scaling and WebP high-compression delivery',
      'Schedule seasonal booking promos and award-winning showcase spreads'
    ],
    metric: 'High-res 1920×1080 display with zero buffering',
    tip: 'Use imagery with negative space on the left to keep client names legible.'
  },

  // Account
  profile: {
    title: 'Studio Profile & Branding',
    badge: 'Branding Hub',
    icon: 'person-circle',
    summary: 'Customize your studio brand mark, contact details, social links, and GST configuration.',
    highlights: [
      'Set primary and accent brand colors shown on all client galleries',
      'Configure studio watermarks, copyright notices, and studio email handles',
      'Manage team shooter profiles and client communications credentials'
    ],
    metric: 'Golden Hour Studios · Chennai HQ',
    tip: 'Add your studio Instagram handle so guests can tag you on social media.'
  },
  help: {
    title: 'Knowledge Base & Guides',
    badge: '24/7 Guides',
    icon: 'question-circle',
    summary: 'Step-by-step masterclasses, video tutorials, and technical guides for every tool in Weddingz.',
    highlights: [
      'Comprehensive walkthroughs for AI face indexing and print lab formatting',
      'Best practice tips for speeding up client photo selection by 3x',
      'Downloadable print size cheat sheets and Lightroom export presets'
    ],
    metric: '40+ guides and video tutorials available',
    tip: 'Check out the "Viral Venue QR Code" guide to double your guest bookings.'
  },
  support: {
    title: 'Dedicated Studio Support',
    badge: '< 15m Response',
    icon: 'headset',
    summary: 'Connect directly with our photography technical specialists for priority assistance.',
    highlights: [
      'Priority ticket resolution with average 12-minute response time',
      'Dedicated WhatsApp support group for Pro and All-Access members',
      'Live screen-share assistance for custom domain DNS setups'
    ],
    metric: '99.4% customer satisfaction rating',
    tip: 'Urgent weekend wedding issues get bumped to our priority emergency queue.'
  },

  // Granular Feature Breakdown (for Checklists & Badges)
  features: {
    '10 events / month': {
      title: 'Event Quota (10/mo)',
      description: 'Create up to 10 distinct wedding, engagement, or reception events every billing cycle with independent client galleries.'
    },
    '30 events / month': {
      title: 'Event Quota (30/mo)',
      description: 'Support high-volume peak wedding season with 30 active events every single month.'
    },
    'Unlimited events': {
      title: 'Unlimited Event Capacity',
      description: 'Host as many weddings, pre-shoots, haldis, and sangeets as you want with zero per-event restrictions.'
    },
    '100 GB storage': {
      title: '100 GB High-Speed Cloud',
      description: 'Encrypted AWS cloud storage optimized for rapid thumbnail rendering and fast client browsing.'
    },
    '500 GB storage': {
      title: '500 GB High-Speed Cloud',
      description: 'Ample capacity to host multiple full-resolution high-bitrate wedding collections concurrently.'
    },
    '2 TB storage': {
      title: '2 TB Ultra Cloud Storage',
      description: 'Enterprise-grade capacity capable of storing tens of thousands of original uncompressed image files.'
    },
    '5 TB storage': {
      title: '5 TB Studio Vault',
      description: 'Massive dedicated cloud repository preserving original high-definition RAW and TIFF archives.'
    },
    'Photo selection': {
      title: 'Online Client Selection Portal',
      description: 'Branded portal where couples select album candidates with hearting, category filters, and live sync.'
    },
    'Digital albums': {
      title: 'Virtual 3D Flipbook Albums',
      description: 'Realistic book-turn simulations allowing brides and families to preview wedding albums before printing.'
    },
    'AI face recognition (10k scans)': {
      title: '10,000 AI Face Scans / mo',
      description: 'Guests snap a selfie to instantly filter and download all photos they appear in out of thousands.'
    },
    'AI face recognition (50k scans)': {
      title: '50,000 AI Face Scans / mo',
      description: 'Heavyweight neural face indexing tailored for mega destination weddings with 1,000+ attendees.'
    },
    'Custom domain': {
      title: 'Custom Domain White-labeling',
      description: 'Host your client portal and portfolio directly on your own domain (e.g., gallery.yourstudio.com).'
    },
    'Basic website': {
      title: 'Responsive Studio Website',
      description: 'Clean portfolio page featuring your curated best work, packages, and direct inquiry forms.'
    },
    '5 team seats': {
      title: 'Multi-User Studio Access',
      description: 'Grant separate logins for your retouchers, assistant photographers, and studio managers with role permissions.'
    },
    'Priority support': {
      title: 'Priority Helpdesk SLA',
      description: 'Front-of-the-line ticketing and live phone assistance to resolve issues quickly on busy shoot weekends.'
    },
    '10,000 WhatsApp credits every year': {
      title: 'Annual WhatsApp Credit Grant',
      description: 'Free automated messaging credits to power client reminders, album delivery links, and booking confirmations.'
    },
    'Dedicated account manager': {
      title: 'Dedicated Studio Concierge',
      description: 'Direct phone & WhatsApp contact with a dedicated Weddingz account manager for workflow optimization.'
    },
    'Total Events': {
      title: 'Total Active & Delivered Events',
      description: 'Aggregates all wedding shoots, receptions, and pre-wedding assignments logged in your studio database.'
    },
    'Photo Selections': {
      title: 'Active Selection Portals',
      description: 'Total galleries currently live where couples are actively reviewing and hearting their favorite shots.'
    },
    'Digital Albums': {
      title: 'Published & Draft Flipbooks',
      description: 'All 3D interactive albums created in the studio, including client reviews and finalized layouts.'
    },
    'Face Matches': {
      title: 'AI Facial Matches Delivered',
      description: 'Total individual photos successfully identified and delivered to wedding guests via selfie scans.'
    }
  }
}
