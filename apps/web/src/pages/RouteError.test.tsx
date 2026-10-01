import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RouteError from './RouteError'

function Boom(): never {
  throw new Error('kaboom at secretModule.ts:42')
}

describe('RouteError', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows a friendly message without the error or its stack trace', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const router = createMemoryRouter([{ path: '/', element: <Boom />, errorElement: <RouteError /> }])
    const { container } = render(<RouterProvider router={router} />)

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/kaboom|secretModule|at Boom/)
    expect(container.querySelector('pre')).toBeNull()
  })
})
