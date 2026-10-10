import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderPage } from '../../test/render'
import Login from './Login'

afterEach(() => vi.unstubAllGlobals())

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const unauthenticated = () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue' } })

const ME = {
  user: { id: 'u1', name: 'Arjun Mehta', email: 'hello@goldenhour.studio', phone: null, role: 'OWNER' },
  studio: { id: 's1', name: 'Golden Hour Studios' },
  features: { faceRecognition: false },
}

/**
 * A tiny fake of the auth API: `loggedIn` says whether the browser has a session cookie.
 * Unknown paths fail loudly so a test can't pass by accident.
 */
function fakeAuthApi({ loggedIn, login }: { loggedIn: boolean; login?: () => Response }) {
  const state = { loggedIn }
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname.replace('/api/v1', '')
    const method = init?.method ?? 'GET'
    if (method === 'GET' && path === '/auth/me') return state.loggedIn ? json(200, ME) : unauthenticated()
    if (method === 'POST' && path === '/auth/refresh') return state.loggedIn ? json(200, { ok: true }) : unauthenticated()
    if (method === 'POST' && path === '/auth/logout') {
      state.loggedIn = false
      return json(200, { ok: true })
    }
    if (method === 'POST' && path === '/auth/login' && login) return login()
    throw new Error(`Unexpected request in test: ${method} ${path}`)
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, state, calls: () => fetch.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${new URL(String(u), 'http://localhost').pathname}`) }
}

describe('Login form', () => {
  it('shows field errors on submit and focuses the first invalid field', async () => {
    const api = fakeAuthApi({ loggedIn: false })
    renderPage(<Login />, '/login')
    await userEvent.click(await screen.findByRole('button', { name: /log in/i }))
    expect(await screen.findByText('Enter your email or mobile number')).toBeInTheDocument()
    expect(screen.getByText('Password is required')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Email or mobile number' })).toHaveFocus()
    expect(api.calls()).not.toContain('POST /api/v1/auth/login')
  })

  it('validates email on blur', async () => {
    fakeAuthApi({ loggedIn: false })
    renderPage(<Login />, '/login')
    await userEvent.type(await screen.findByRole('textbox', { name: 'Email or mobile number' }), 'nope')
    await userEvent.tab()
    expect(await screen.findByText('Enter a valid email or 10-digit mobile number')).toBeInTheDocument()
  })

  it('maps API field errors onto the form', async () => {
    fakeAuthApi({
      loggedIn: false,
      login: () =>
        json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password', fields: { password: 'Incorrect email or password' } } }),
    })
    renderPage(<Login />, '/login')
    await userEvent.type(await screen.findByRole('textbox', { name: 'Email or mobile number' }), 'a@b.com')
    await userEvent.type(screen.getByLabelText(/^Password/), 'Secret123')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    await waitFor(() => expect(document.querySelector('.field-error')?.textContent).toMatch(/Incorrect email or password/))
  })
})

describe('Login page when already logged in', () => {
  it('says who is logged in instead of redirecting, with a link to the dashboard', async () => {
    fakeAuthApi({ loggedIn: true })
    renderPage(<Login />, '/login')

    expect(await screen.findByTestId('signed-in-notice')).toHaveTextContent("You're logged in as Arjun Mehta (hello@goldenhour.studio)")
    expect(screen.getByRole('link', { name: /Go to dashboard/ })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('textbox', { name: 'Email or mobile number' })).not.toBeInTheDocument()
  })

  it('sends "Go to dashboard" back to the page the user came from', async () => {
    fakeAuthApi({ loggedIn: true })
    renderPage(<Login />, '/login?next=%2Fbilling')
    expect(await screen.findByRole('link', { name: /Go to dashboard/ })).toHaveAttribute('href', '/billing')
  })

  it('ignores an off-site next link', async () => {
    fakeAuthApi({ loggedIn: true })
    renderPage(<Login />, '/login?next=%2F%2Fevil.example')
    expect(await screen.findByRole('link', { name: /Go to dashboard/ })).toHaveAttribute('href', '/')
  })

  it('"Log in with a different account" logs out and shows the login form', async () => {
    const api = fakeAuthApi({ loggedIn: true })
    renderPage(<Login />, '/login')

    await userEvent.click(await screen.findByRole('button', { name: /Log in with a different account/ }))

    expect(await screen.findByRole('textbox', { name: 'Email or mobile number' })).toHaveValue('')
    expect(screen.queryByTestId('signed-in-notice')).not.toBeInTheDocument()
    expect(api.state.loggedIn).toBe(false)
    expect(api.calls()).toContain('POST /api/v1/auth/logout')
  })
})
