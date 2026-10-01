import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockFetch, renderPage } from '../../test/render'
import Login from './Login'

afterEach(() => vi.unstubAllGlobals())

describe('Login form', () => {
  it('shows field errors on submit and focuses the first invalid field', async () => {
    const fetch = mockFetch()
    renderPage(<Login />, '/login')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(await screen.findByText('Email is required')).toBeInTheDocument()
    expect(screen.getByText('Password is required')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveFocus()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('validates email on blur', async () => {
    mockFetch()
    renderPage(<Login />, '/login')
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'nope')
    await userEvent.tab()
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
  })

  it('maps API field errors onto the form', async () => {
    mockFetch({
      status: 401,
      body: { error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password', fields: { password: 'Incorrect email or password' } } },
    })
    renderPage(<Login />, '/login')
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'a@b.com')
    await userEvent.type(screen.getByLabelText(/^Password/), 'Secret123')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    await waitFor(() => expect(document.querySelector('.field-error')?.textContent).toMatch(/Incorrect email or password/))
  })
})
