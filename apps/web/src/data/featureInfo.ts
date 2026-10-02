// Comprehensive feature descriptions and cursor-hover information across Weddyzone studio platform.

export const featureInfo = {
  // Navigation & Core Services
  dashboard: {
    title: 'Studio Command Center',
    badge: 'Real-time Hub',
    icon: 'grid-1x2',
    summary: 'The central nerve center for your entire photography studio operations and client pipeline.',
    highlights: [
      'Upcoming events, selections and albums at a glance',
      'Recent bookings with their live client progress',
      'Monthly booking volume and quick action shortcuts'
    ],
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
      'Export picked filenames as TXT or CSV for a Lightroom filter'
    ],
    tip: 'Send a WhatsApp reminder with one click to keep deadlines on track.'
  },
  digitalAlbum: {
    title: 'Digital Flipbook Album',
    badge: 'Interactive',
    icon: 'journal-album',
    summary: 'Turn designed wedding spreads into an online flipbook that couples can share with family.',
    highlights: [
      'Browse the album spread by spread on any device',
      '2× zoom for checking jewelry and attire details',
      'Client spread approval mode with direct revision notes on pages'
    ],
    tip: 'Ask the couple to approve every spread before sending albums to print labs.'
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
      'Upgrade or downgrade anytime with zero lock-in contracts',
      'Choose between Monthly and Yearly billing',
      'Each tier sets your event, album and storage limits'
    ],
    tip: 'Studios shooting 3+ weddings a month save the most on Pro & All-Access tiers.'
  },
  mySubscription: {
    title: 'Subscription & Quota Manager',
    badge: 'Your Plan',
    icon: 'patch-check',
    summary: 'Monitor your active studio tier, monthly usage quotas, and upcoming renewals.',
    highlights: [
      'Live storage usage against your plan limit',
      'Events used this month and your renewal date',
      'Change plan or billing cycle in a few clicks'
    ],
    tip: 'Check your event quota before a busy wedding month.'
  },
  allAccess: {
    title: 'Weddyzone All-Access Pass',
    badge: 'VIP Unlimited',
    icon: 'stars',
    summary: 'The top studio tier: unlimited events and albums with the most storage and WhatsApp credits.',
    highlights: [
      'Unlimited events and albums all year',
      '5 TB cloud storage',
      '10,000 free WhatsApp credits included every year'
    ],
    metric: 'Best value for multi-crew wedding production houses',
    tip: 'Eliminates all per-event stress during peak wedding months (Oct - Feb).'
  },
  referAndEarn: {
    title: 'Partner Referral Network',
    badge: '₹1,500 Reward',
    icon: 'wallet2',
    summary: 'Earn ₹1,500 in your studio wallet for every studio that joins Weddyzone with your link and upgrades to a paid plan.',
    highlights: [
      'Both you and your referred studio receive ₹1,500 in wallet credit',
      'Credited when the referred studio makes its first paid upgrade',
      'Real-time tracking of referred studios and their status'
    ],
    tip: 'Share your code in your regional wedding photographer WhatsApp groups.'
  },
  whatsappCredit: {
    title: 'WhatsApp Client Messaging',
    badge: 'Credits',
    icon: 'whatsapp',
    summary: 'Send proofing links, selection nudges, album shares and invoices to clients on WhatsApp.',
    highlights: [
      'Personalized templates with client names and gallery links',
      'Opens WhatsApp on your device with the message ready to send',
      'Credits never expire and work across selections, albums, events and billing'
    ],
    tip: 'A reminder a few days before the deadline keeps selections on track.'
  },

  // Business Suite
  billing: {
    title: 'GST Invoicing & Payments',
    badge: 'GST Compliant',
    icon: 'receipt',
    summary: 'Create professional, GST-compliant photography invoices and track milestone payments.',
    highlights: [
      'Automated CGST, SGST, and IGST rate breakdown with your studio GSTIN',
      'Send invoices to clients on WhatsApp and print them',
      'Track advance deposits, part-payments, and overdue balances'
    ],
    tip: 'Record each payment as it arrives so balances stay accurate.'
  },
  myWebsite: {
    title: 'Portfolio Website Builder',
    badge: 'Your Website',
    icon: 'globe2',
    summary: 'Publish a photography portfolio website with your work, films and an enquiry form.',
    highlights: [
      'Showcase your best wedding stories and highlight films',
      'Built-in enquiry form with in-app alerts for new leads',
      'Optimized for mobile viewing, with your own SEO title and description'
    ],
    tip: 'Keep your hero banner updated with your latest destination shoot.'
  },
  galleryBanner: {
    title: 'Hero Banner Showcase',
    badge: 'Brand Builder',
    icon: 'image',
    summary: 'Elevate your proofing galleries and portfolio website with immersive full-width hero imagery.',
    highlights: [
      'Banner placements for your gallery hero, website hero and website popup',
      'Optional call-to-action button on each banner',
      'Schedule seasonal booking promos with start and end dates'
    ],
    tip: 'Use imagery with negative space on the left to keep client names legible.'
  },

  // Account
  profile: {
    title: 'Studio Profile & Branding',
    badge: 'Branding Hub',
    icon: 'person-circle',
    summary: 'Keep your studio name, contact details, address and GST configuration up to date.',
    highlights: [
      'Studio and owner details shown to clients',
      'GSTIN, PAN and state used on your invoices',
      'Change your account password'
    ],
    tip: 'Add your state and GSTIN before creating your first invoice.'
  },
  help: {
    title: 'Knowledge Base & Guides',
    badge: 'FAQs',
    icon: 'question-circle',
    summary: 'Searchable answers to common questions about every tool in Weddyzone.',
    highlights: [
      'Search FAQs by keyword or browse by category',
      'Tell us whether each answer was helpful',
      'Raise a support ticket if you cannot find an answer'
    ],
    tip: 'Search for a feature name to jump straight to its FAQs.'
  },
  support: {
    title: 'Studio Support',
    badge: 'Tickets',
    icon: 'headset',
    summary: 'Raise a support ticket with our team and follow the conversation in one place.',
    highlights: [
      'Set a category and priority for each ticket',
      'Attach screenshots to explain the issue',
      'In-app notification when the team replies'
    ],
    tip: 'Mark urgent shoot-day issues as High priority.'
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
      description: 'Space for your uploaded event photos (JPG, PNG or WebP), shared across selections and albums.'
    },
    '500 GB storage': {
      title: '500 GB High-Speed Cloud',
      description: 'Room for several full wedding collections at once.'
    },
    '2 TB storage': {
      title: '2 TB Ultra Cloud Storage',
      description: 'Capacity for tens of thousands of high-resolution photos.'
    },
    '5 TB storage': {
      title: '5 TB Studio Vault',
      description: 'The largest storage tier for high-resolution JPG, PNG and WebP photos.'
    },
    'Photo selection': {
      title: 'Online Client Selection Portal',
      description: 'Private link where couples heart their favourite photos, limited to their package quota.'
    },
    'Digital albums': {
      title: 'Virtual 3D Flipbook Albums',
      description: 'Online flipbooks that let couples and families preview, comment on and approve albums before printing.'
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
      description: 'Coming soon: host your portfolio on your own domain (e.g. gallery.yourstudio.com).'
    },
    'Basic website': {
      title: 'Responsive Studio Website',
      description: 'Clean portfolio page featuring your curated best work, packages, and direct inquiry forms.'
    },
    '5 team seats': {
      title: 'Multi-User Studio Access',
      description: 'Coming soon: separate logins for your retouchers, assistant photographers and studio managers.'
    },
    'Priority support': {
      title: 'Priority Helpdesk SLA',
      description: 'Coming soon: priority handling for your support tickets.'
    },
    '10,000 WhatsApp credits every year': {
      title: 'Annual WhatsApp Credit Grant',
      description: 'WhatsApp credits for client reminders, album links and booking confirmations, added every year.'
    },
    'Dedicated account manager': {
      title: 'Dedicated Studio Concierge',
      description: 'Coming soon: a dedicated Weddyzone account manager for your studio.'
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
      description: 'All flipbook albums created in the studio, including ones in client review.'
    },
    'Face Matches': {
      title: 'AI Facial Matches Delivered',
      description: 'Total individual photos successfully identified and delivered to wedding guests via selfie scans.'
    }
  }
}
