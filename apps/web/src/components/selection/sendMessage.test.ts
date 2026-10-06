import { describe, expect, it } from 'vitest'
import { buildSendMessage, whatsappPhone, whatsappSendUrl } from './sendMessage'

const links = { android: 'https://play.example/app', ios: 'https://apps.example/app', web: 'https://studio.example/selection/auth' }
const event = { customerName: 'Priya', eventTitle: 'Priya & Karthik Wedding', code: '482913' }
const studio = { name: 'Golden Hour Studios', phone: '9840012345' }

describe('buildSendMessage', () => {
  it('Android: the Android link only, laid out like the customer message', () => {
    expect(buildSendMessage(event, studio, 'android', links)).toBe(
      [
        'Hi Priya! 📸 Your Priya & Karthik Wedding photos from Golden Hour Studios are ready for you to pick.',
        'Android app:\nhttps://play.example/app',
        'Access code: 482913',
        'Questions? Reply here or call 9840012345',
      ].join('\n\n'),
    )
  })

  it('each card sends only its own link', () => {
    const ios = buildSendMessage(event, studio, 'ios', links)
    expect(ios).toContain('iOS app:\nhttps://apps.example/app\n\n')
    expect(ios).not.toContain(links.android)
    expect(ios).not.toContain(links.web)
    const web = buildSendMessage(event, studio, 'web', links)
    expect(web).toContain('Open your gallery:\nhttps://studio.example/selection/auth\n\n')
    expect(web).not.toContain(links.android)
    expect(web).not.toContain(links.ios)
  })

  it('All with Message has all three', () => {
    const all = buildSendMessage(event, studio, 'all', links)
    expect(all).toContain('Android app:\nhttps://play.example/app\n\niOS app:\nhttps://apps.example/app\n\nOpen your gallery:\nhttps://studio.example/selection/auth\n\nAccess code: 482913')
  })

  it('leaves out a store link that is not set, and a missing studio phone', () => {
    const msg = buildSendMessage(event, { name: 'Golden Hour Studios', phone: null }, 'all', { ...links, android: null })
    expect(msg).not.toContain('Android')
    expect(msg.endsWith('Questions? Reply here.')).toBe(true)
  })
})

describe('WhatsApp link', () => {
  it('adds 91 to a 10-digit mobile, drops the phone when invalid', () => {
    expect(whatsappPhone('98400 12345')).toBe('919840012345')
    expect(whatsappPhone('+91 98400-12345')).toBe('919840012345')
    expect(whatsappPhone('12345')).toBeNull()
    expect(whatsappSendUrl('9840012345', 'Hi\n\nthere')).toBe('https://api.whatsapp.com/send?phone=919840012345&text=Hi%0A%0Athere')
    expect(whatsappSendUrl('', 'Hi')).toBe('https://api.whatsapp.com/send?text=Hi')
  })
})
