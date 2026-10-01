import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockFetch, renderPage } from '../../test/render'
import { CreateInvoiceModal } from './CreateInvoiceModal'

vi.mock('../../auth/AuthProvider', () => ({
  ME_KEY: ['me'],
  useMe: () => ({
    user: { id: 'u1', name: 'Arjun Mehta', email: 'a@b.com', phone: null, role: 'OWNER' },
    studio: { id: 's1', name: 'Golden Hour Studios', stateCode: '33', gstin: '33ABCDE1234F1Z5', plan: { code: 'PRO', name: 'Pro' } },
    features: { faceRecognition: false },
  }),
}))

afterEach(() => vi.unstubAllGlobals())

const dialog = () => screen.getByRole('dialog', { name: 'Create GST Invoice' })

describe('Create invoice form', () => {
  it('shows live CGST + SGST totals for an intra-state invoice', async () => {
    mockFetch({ body: { data: [], meta: { page: 1, limit: 20, total: 0 } } })
    renderPage(<CreateInvoiceModal open onClose={() => {}} />)
    await userEvent.type(within(dialog()).getByLabelText(/^Item 1/), 'Wedding coverage')
    await userEvent.type(within(dialog()).getByLabelText(/^Rate/), '100000')
    expect(screen.getByTestId('cgst')).toHaveTextContent('₹9,000')
    expect(screen.getByTestId('sgst')).toHaveTextContent('₹9,000')
    expect(screen.getByTestId('grand-total')).toHaveTextContent('₹1,18,000')
    expect(screen.queryByTestId('igst')).toBeNull()
  })

  it('switches to IGST when the place of supply is another state', async () => {
    mockFetch({ body: { data: [], meta: { page: 1, limit: 20, total: 0 } } })
    renderPage(<CreateInvoiceModal open onClose={() => {}} />)
    await userEvent.type(within(dialog()).getByLabelText(/^Rate/), '50000')
    await userEvent.click(within(dialog()).getByLabelText(/^Place of supply/))
    await userEvent.type(within(dialog()).getByLabelText(/^Place of supply/), 'Karnataka{enter}')
    expect(await screen.findByTestId('igst')).toHaveTextContent('₹9,000')
    expect(screen.getByTestId('grand-total')).toHaveTextContent('₹59,000')
    expect(screen.getByText('Different state from your studio → IGST')).toBeInTheDocument()
  })

  it('reports every validation error and does not submit', async () => {
    const fetch = mockFetch({ body: { data: [], meta: { page: 1, limit: 20, total: 0 } } })
    renderPage(<CreateInvoiceModal open onClose={() => {}} />)
    await userEvent.clear(within(dialog()).getByLabelText(/^Qty/))
    await userEvent.type(within(dialog()).getByLabelText(/^Qty/), '0')
    await userEvent.click(screen.getByRole('button', { name: /create invoice/i }))
    expect(await screen.findByText('Select a client')).toBeInTheDocument()
    expect(screen.getByText('Description is required')).toBeInTheDocument()
    expect(screen.getByText('Quantity must be at least 1')).toBeInTheDocument()
    expect(screen.getByText('Amount must be greater than 0')).toBeInTheDocument()
    // Only the client/event option lists were fetched — nothing was submitted.
    const methods = (fetch.mock.calls as unknown as [string, RequestInit | undefined][]).map(([, init]) => init?.method)
    expect(methods).not.toContain('POST')
  })

  it('checks that milestones add up to the total', async () => {
    mockFetch({ body: { data: [], meta: { page: 1, limit: 20, total: 0 } } })
    renderPage(<CreateInvoiceModal open onClose={() => {}} />)
    await userEvent.type(within(dialog()).getByLabelText(/^Rate/), '100000')
    await userEvent.click(screen.getByRole('button', { name: 'Split 30/30/40' }))
    expect(screen.getByText(/Milestones ₹1,18,000 of ₹1,18,000/)).toBeInTheDocument()
    const amounts = within(dialog()).getAllByLabelText(/^Amount \(₹\)/)
    await userEvent.clear(amounts[0])
    await userEvent.type(amounts[0], '1000')
    await waitFor(() => expect(screen.getByText(/Milestones ₹83,600 of ₹1,18,000/)).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /create invoice/i }))
    expect(await screen.findByText(/invoice total is ₹1,18,000/)).toBeInTheDocument()
  })
})
