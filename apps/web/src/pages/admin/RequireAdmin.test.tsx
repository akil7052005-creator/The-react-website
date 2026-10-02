import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RequireAdmin } from '../../auth/AuthProvider'

afterEach(() => vi.unstubAllGlobals())

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function stubMe(me: unknown | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://localhost').pathname
      if (path.endsWith('/auth/me') && me) return json(200, me)
      return json(401, { error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue' } })
    }),
  )
}

function renderAdmin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/admin', element: <RequireAdmin><h1>Support inbox</h1></RequireAdmin> },
      { path: '/login', element: <h1>Login page</h1> },
    ],
    { initialEntries: ['/admin'] },
  )
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const user = (role: string) => ({ id: 'u1', name: 'Priya Ops', email: 'ops@weddyzone.test', phone: null, role })

describe('RequireAdmin', () => {
  it('lets platform admins in', async () => {
    stubMe({ user: user('SUPER_ADMIN'), studio: null, features: { faceRecognition: false } })
    renderAdmin()
    expect(await screen.findByRole('heading', { name: 'Support inbox' })).toBeInTheDocument()
  })

  it('shows studio users "Page not found" instead of the admin area', async () => {
    stubMe({ user: user('OWNER'), studio: { id: 's1', name: 'Golden Hour Studios' }, features: { faceRecognition: false } })
    renderAdmin()
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Support inbox' })).not.toBeInTheDocument()
  })

  it('sends visitors who are not logged in to the login page, then back to /admin', async () => {
    stubMe(null)
    const router = renderAdmin()
    expect(await screen.findByRole('heading', { name: 'Login page' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?next=%2Fadmin')
  })
})
