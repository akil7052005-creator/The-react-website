import { describe, expect, it } from 'vitest'
import { isLocalUrl, resolvePublicBase } from '../../lib/env'
import { buildCustomerMessage, buildOptionMessage, shareLink, smsUrl, whatsappMeUrl, whatsappSendUrl, type ShareLinks } from './sendMessage'

describe('Send/Share messages', () => {
  const link = shareLink('tok123', 'https://studio.example.com')!
  const links: ShareLinks = {
    personal: link,
    web: 'https://studio.example.com/selection/auth',
    android: 'https://play.google.com/store/apps/details?id=app.weddyzone',
    ios: null,
  }
  const event = { customerName: 'Priya', eventTitle: 'Priya & Karthik Wedding', code: '482913' }
  const studio = { name: 'Golden Hour Studio', phone: '+919876543210' }
  const hello = 'Hi Priya! 📸 Your Priya & Karthik Wedding photos from Golden Hour Studio are ready for you to pick.'
  const code = 'Access code: 482913'
  const questions = 'Questions? Reply here or call +919876543210'

  it('links to /select/<token> on the public address, and to nothing without one', () => {
    expect(link).toBe('https://studio.example.com/select/tok123')
    expect(shareLink('tok123', null)).toBeNull()
  })

  it('the personal-link message: the link alone on its line, a blank line around it, then the code', () => {
    const msg = buildOptionMessage(event, studio, links, 'personal')
    expect(msg).toBe([hello, `Open your gallery:\n${link}`, code, questions].join('\n\n'))
    // WhatsApp links the whole URL only when nothing touches it.
    const lines = msg.split('\n')
    const at = lines.indexOf(link)
    expect(at).toBeGreaterThan(0)
    expect(lines[at - 1]).toBe('Open your gallery:')
    expect(lines[at + 1]).toBe('')
  })

  it('buildCustomerMessage: exactly the WhatsApp message, link alone on its line, no period after the phone', () => {
    const msg = buildCustomerMessage({ ...event, shareToken: 'tok123', studio }, 'https://studio.example.com')
    expect(msg).toBe(
      [
        'Hi Priya! 📸 Your Priya & Karthik Wedding photos from Golden Hour Studio are ready for you to pick.',
        'Open your gallery:\nhttps://studio.example.com/select/tok123',
        'Access code: 482913',
        'Questions? Reply here or call +919876543210',
      ].join('\n\n'),
    )
    // Same text as the personal-link Send on WhatsApp message.
    expect(msg).toBe(buildOptionMessage(event, studio, links, 'personal'))
    expect(msg!.endsWith('+919876543210')).toBe(true)
    // No public address: no message (never a message without its link).
    expect(buildCustomerMessage({ ...event, shareToken: 'tok123', studio }, null)).toBeNull()
  })

  it('keeps 📸 one real character: UTF-8 percent-encoded once in WhatsApp links, never "�"', () => {
    const msg = buildCustomerMessage({ ...event, shareToken: 'tok123', studio }, 'https://studio.example.com')!
    expect([...'📸']).toHaveLength(1)
    expect(msg).toContain('📸')
    expect(msg).not.toContain('�')
    for (const url of [whatsappSendUrl('9876543210', msg), whatsappMeUrl('9876543210', msg)]) {
      expect(url).toContain('%F0%9F%93%B8')
      expect(url).not.toContain('%25') // not encoded twice
      expect(decodeURIComponent(url.split('text=')[1])).toBe(msg)
    }
    expect(whatsappMeUrl('98765 43210', msg).startsWith('https://wa.me/919876543210?text=Hi%20Priya!%20%F0%9F%93%B8')).toBe(true)
  })

  it('the web sign-in message points to /selection/auth', () => {
    expect(buildOptionMessage(event, studio, links, 'web')).toBe(
      [hello, 'Open your gallery:\nhttps://studio.example.com/selection/auth', code, questions].join('\n\n'),
    )
  })

  it('the full message has every link that is set (an empty iOS link is left out) and the code', () => {
    const msg = buildOptionMessage(event, studio, links)
    expect(msg).toBe(
      [
        hello,
        `Open your gallery:\n${link}`,
        'Or sign in with your access code:\nhttps://studio.example.com/selection/auth',
        'Android app:\nhttps://play.google.com/store/apps/details?id=app.weddyzone',
        code,
        questions,
      ].join('\n\n'),
    )
    expect(msg).not.toContain('iOS')
  })

  it('without a studio phone the last line is just "Reply here"', () => {
    expect(buildOptionMessage(event, { ...studio, phone: null }, links, 'personal').endsWith('\n\nQuestions? Reply here.')).toBe(true)
  })

  it('never treats this computer or a private address as a public link', () => {
    for (const u of ['http://localhost:5173', 'https://127.0.0.1', 'http://192.168.1.4:5173', 'http://10.0.0.2', 'http://172.20.1.5', 'http://0.0.0.0:80']) {
      expect(isLocalUrl(u)).toBe(true)
    }
    expect(isLocalUrl('https://studio.weddyzone.app')).toBe(false)
    expect(isLocalUrl('http://172.32.0.1')).toBe(false)
  })

  it('builds links on the public address only; Wi-Fi addresses need the LAN switch; localhost never', () => {
    expect(resolvePublicBase('https://studio.example.com/', false)).toBe('https://studio.example.com')
    expect(resolvePublicBase('', true)).toBeNull()
    expect(resolvePublicBase(undefined, true)).toBeNull()
    expect(resolvePublicBase('http://192.168.1.4:5173', false)).toBeNull()
    expect(resolvePublicBase('http://192.168.1.4:5173', true)).toBe('http://192.168.1.4:5173')
    for (const u of ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://0.0.0.0:5173', 'http://[::1]:5173']) {
      expect(resolvePublicBase(u, true)).toBeNull()
    }
    expect(shareLink('tok123', resolvePublicBase('http://192.168.1.4:5173', true))).toBe('http://192.168.1.4:5173/select/tok123')
  })

  it('opens wa.me and sms: with the whole message encoded', () => {
    expect(whatsappMeUrl('98400 12345', 'Hi\nthere')).toBe('https://wa.me/919840012345?text=Hi%0Athere')
    expect(whatsappMeUrl('+91 76039 47817', 'Open:\nhttps://a.example/select/t?x=1&y=2')).toBe(
      'https://wa.me/917603947817?text=Open%3A%0Ahttps%3A%2F%2Fa.example%2Fselect%2Ft%3Fx%3D1%26y%3D2',
    )
    expect(whatsappMeUrl(null, 'Hi')).toBe('https://wa.me/?text=Hi')
    expect(smsUrl('+91 98400 12345', 'Hi there')).toBe('sms:+919840012345?body=Hi%20there')
  })
})
