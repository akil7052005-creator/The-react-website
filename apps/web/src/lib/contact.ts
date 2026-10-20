// Business contact details shown in the public footer and the About Us panel (one place to change them).
export const CONTACT = [
  { icon: 'telephone', label: 'Phone', value: '97867 55777', href: 'tel:+919786755777', external: false },
  { icon: 'whatsapp', label: 'WhatsApp', value: '97867 55777', href: 'https://wa.me/919786755777', external: true },
  { icon: 'envelope', label: 'Email', value: 'brandlift123@gmail.com', href: 'mailto:brandlift123@gmail.com', external: false },
  { icon: 'geo-alt', label: 'Address', value: '80, Sastri Rd, Ram Nagar, Coimbatore, Tamil Nadu 641009', href: undefined, external: false },
] as const

export type ContactItem = (typeof CONTACT)[number]

/** A contact value as a link (new tab for WhatsApp), or plain text when it has no link. */
export const contactLinkProps = (c: ContactItem) => (c.external ? { target: '_blank', rel: 'noreferrer' } : {})
