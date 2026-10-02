import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockFetch, renderPage } from '../test/render'
import MyProfile from './MyProfile'

const studio = {
  id: 's1',
  name: 'Golden Hour Studios',
  slug: 'golden-hour',
  ownerName: 'Arjun Mehta',
  email: 'hello@goldenhour.studio',
  phone: '+919876543210',
  city: 'Chennai',
  stateCode: '33',
  addressLine1: null,
  addressLine2: null,
  pincode: '600006',
  gstin: '33ABCDE1234F1Z5',
  pan: 'ABCDE1234F',
  website: null,
  bio: 'Candid storytellers',
  logoUrl: null,
  referralCode: 'GOLDEN25',
  walletBalancePaise: 0,
  creditBalance: 100,
  plan: { code: 'PRO', name: 'Pro' },
}

vi.mock('../auth/AuthProvider', () => ({
  ME_KEY: ['me'],
  useMe: () => ({ user: { id: 'u1', name: 'Arjun Mehta', email: 'a@b.com', phone: null, role: 'OWNER' }, studio, features: { faceRecognition: false } }),
}))

afterEach(() => vi.unstubAllGlobals())

const form = () => within(screen.getByTestId('profile-form'))

describe('Profile form', () => {
  it('enables Save only when changed and valid, and Reset restores saved values', async () => {
    mockFetch({ body: studio })
    renderPage(<MyProfile />, '/profile')
    const save = form().getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()

    const bio = form().getByLabelText(/^About your studio/)
    await userEvent.clear(bio)
    await userEvent.type(bio, 'Wedding films and photos')
    await waitFor(() => expect(save).toBeEnabled())

    const gstin = form().getByLabelText(/^GSTIN/)
    await userEvent.clear(gstin)
    await userEvent.type(gstin, '29ABCDE1234F1Z5')
    expect(await screen.findByText(/GSTIN must start with 33/)).toBeInTheDocument()
    await waitFor(() => expect(save).toBeDisabled())

    await userEvent.click(form().getByRole('button', { name: 'Reset' }))
    expect(form().getByLabelText(/^GSTIN/)).toHaveValue('33ABCDE1234F1Z5')
    expect(form().getByLabelText(/^About your studio/)).toHaveValue('Candid storytellers')
    expect(save).toBeDisabled()
  })

  it('validates phone and PIN code', async () => {
    mockFetch({ body: studio })
    renderPage(<MyProfile />, '/profile')
    const phone = form().getByLabelText(/^Mobile number/)
    await userEvent.clear(phone)
    await userEvent.type(phone, '12345')
    await userEvent.tab()
    expect(await screen.findByText('Enter a valid 10-digit Indian mobile number')).toBeInTheDocument()
    const pin = form().getByLabelText(/^PIN code/)
    await userEvent.clear(pin)
    await userEvent.type(pin, '012345')
    await userEvent.tab()
    expect(await screen.findByText('Enter a valid 6-digit PIN code')).toBeInTheDocument()
  })

  it('submits the changes and maps API field errors', async () => {
    const fetch = mockFetch(
      { body: studio }, // initial GET (refetch of the profile)
      { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'Please fix the highlighted fields', fields: { website: 'This website is not allowed' } } } },
    )
    renderPage(<MyProfile />, '/profile')
    const website = form().getByLabelText(/^Website/)
    await userEvent.type(website, 'goldenhour.studio')
    await userEvent.click(form().getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('This website is not allowed')).toBeInTheDocument()
    const patch = (fetch.mock.calls as unknown as [string, RequestInit | undefined][]).find(([, init]) => init?.method === 'PATCH')
    expect(patch).toBeDefined()
    expect(JSON.parse(String(patch![1]!.body))).toMatchObject({ website: 'goldenhour.studio', phone: '+919876543210', gstin: '33ABCDE1234F1Z5' })
  })
})
