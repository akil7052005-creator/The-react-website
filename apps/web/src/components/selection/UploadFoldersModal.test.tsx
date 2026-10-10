import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UploadFoldersModal } from './UploadFoldersModal'

vi.mock('./upload/uploadStore', async (orig) => ({
  ...(await orig<typeof import('./upload/uploadStore')>()),
  uploadStore: { get: vi.fn(async () => null), clear: vi.fn(async () => undefined) },
}))
vi.mock('./upload/copyPool', () => ({ copiesOf: vi.fn(), stopCopyPool: vi.fn(), uploadConcurrency: () => 1 }))

afterEach(() => vi.unstubAllGlobals())

const limits = { planName: 'Pro', maxFilesPerUpload: 2000, maxPhotoMb: 100, concurrency: 4 }

function photo(path: string, size = 2048) {
  const f = new File([new Uint8Array(size)], path.split('/').pop()!, { type: 'image/jpeg' })
  Object.defineProperty(f, 'webkitRelativePath', { value: path })
  return f
}

function renderModal() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(limits), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  )
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <UploadFoldersModal open onClose={() => {}} selectionId="s1" folders={[]} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  fireEvent.change(screen.getByTestId('folder-input'), {
    target: { files: [photo('Wedding/Haldi/a.jpg'), photo('Wedding/Haldi/b.jpg'), photo('Wedding/Reception/c.jpg')] },
  })
}

describe('UploadFoldersModal: remove before uploading', () => {
  it('an X removes a whole folder', async () => {
    renderModal()
    const box = screen.getByTestId('selected-folders')
    expect(await within(box).findByText('Haldi')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Haldi' }))
    expect(within(box).queryByText('Haldi')).not.toBeInTheDocument()
    expect(within(box).getByText('Reception')).toBeInTheDocument()
  })

  it('an X removes one photo; removing the last photo removes the folder', async () => {
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: 'Show photos in Haldi' }))
    const list = screen.getByRole('list', { name: 'Photos in Haldi' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.jpg' }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Remove b.jpg' }))
    expect(within(screen.getByTestId('selected-folders')).queryByText('Haldi')).not.toBeInTheDocument()
  })

  it('the Delete key removes a focused folder card', async () => {
    renderModal()
    const box = screen.getByTestId('selected-folders')
    await within(box).findByText('Haldi')
    fireEvent.keyDown(screen.getByLabelText(/^Haldi, 2 photos/), { key: 'Delete' })
    expect(within(box).queryByText('Haldi')).not.toBeInTheDocument()
  })

  it('Clear all empties the list and Start Upload is disabled', async () => {
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: 'Clear all' }))
    expect(within(screen.getByTestId('selected-folders')).queryByText('Reception')).not.toBeInTheDocument()
    expect(screen.getByTestId('start-upload')).toBeDisabled()
  })
})
