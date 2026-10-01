import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockFetch, renderPage } from '../../test/render'
import { ForgotPassword } from './Passwords'

afterEach(() => vi.unstubAllGlobals())

async function requestReset() {
  await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'asha@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
}

describe('Forgot password', () => {
  it('confirms when the reset link is on its way', async () => {
    mockFetch({ body: { ok: true } })
    renderPage(<ForgotPassword />, '/forgot-password')
    await requestReset()
    expect(await screen.findByText(/a reset link is on its way/)).toBeInTheDocument()
  })

  it('shows a clear message on the page when the email could not be sent', async () => {
    mockFetch({
      status: 503,
      body: { error: { code: 'EMAIL_FAILED', message: "We couldn't send the email right now. Please try again in a few minutes." } },
    })
    renderPage(<ForgotPassword />, '/forgot-password')
    await requestReset()
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't send the email right now. Please try again in a few minutes.")
    expect(screen.queryByText(/a reset link is on its way/)).not.toBeInTheDocument()
    // The form stays so the user can try again.
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled()
  })
})
