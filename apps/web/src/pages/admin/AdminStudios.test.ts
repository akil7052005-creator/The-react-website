import { describe, expect, it } from 'vitest'
import { expiryText } from './AdminStudios'

describe('expiryText', () => {
  it('reads days left and days since expiry', () => {
    expect(expiryText(12)).toBe('12 days left')
    expect(expiryText(1)).toBe('1 day left')
    expect(expiryText(0)).toBe('Expires today')
    expect(expiryText(-1)).toBe('Expired 1 day ago')
    expect(expiryText(-3)).toBe('Expired 3 days ago')
    expect(expiryText(null)).toBe('')
  })
})
