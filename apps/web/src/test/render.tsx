import { vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'
import { ConfirmProvider } from '../components/Modal'

/** Renders a page inside the same providers the app uses (router, query client, confirm dialogs). */
export function renderPage(element: ReactNode, path = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter(
    [{ path: '*', element: <ConfirmProvider>{element}</ConfirmProvider> }],
    { initialEntries: [path] },
  )
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  )
}

/** Stubs fetch with a sequence of JSON responses; returns the mock to inspect calls. */
export function mockFetch(...responses: { status?: number; body: unknown }[]) {
  const queue = [...responses]
  const fn = vi.fn(async () => {
    const r = queue.shift() ?? { status: 200, body: {} }
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
