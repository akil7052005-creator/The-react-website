import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { albumFeedbackSchema, type AlbumFeedbackDto, type PublicAlbumDto } from '@weddyzone/shared'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { FlipbookModal } from '../../components/FlipbookModal'
import { applyApiErrors, SubmitButton, TextAreaField, TextField, useZodForm } from '../../components/form/form'
import { Avatar, EmptyState, ErrorState, Skeleton } from '../../components/ui'
import { api, isApiError } from '../../lib/api'
import { toastError } from '../../lib/query'

function useStoredName() {
  const [name, setName] = useState<string>(() => {
    try {
      return localStorage.getItem('wz-album-name') ?? ''
    } catch {
      return ''
    }
  })
  const save = (n: string) => {
    setName(n)
    try {
      localStorage.setItem('wz-album-name', n)
    } catch {
      /* ignore */
    }
  }
  return [name, save] as const
}

function FeedbackForm({ token, spreadIndex, name, onName, onAdded }: { token: string; spreadIndex: number; name: string; onName: (n: string) => void; onAdded: () => void }) {
  const form = useZodForm(albumFeedbackSchema, { defaultValues: { spreadIndex, authorName: name, message: '' } })
  useEffect(() => {
    form.setValue('spreadIndex', spreadIndex)
  }, [spreadIndex, form])
  const add = useMutation({
    mutationFn: (body: { authorName: string }) => api.post<AlbumFeedbackDto>(`/public/albums/${token}/feedback`, body),
    onSuccess: (_d, v) => {
      onName(v.authorName)
      toast.success(`Feedback sent for spread ${spreadIndex + 1}`)
      form.reset({ spreadIndex, authorName: v.authorName, message: '' })
      onAdded()
    },
    onError: (e) => applyApiErrors(form, e),
  })
  return (
    <form className="album-feedback-form" onSubmit={form.handleSubmit((v) => add.mutate(v as { authorName: string }))} noValidate>
      <p className="afb-title">
        <i className="bi bi-chat-heart" /> Feedback on spread {spreadIndex + 1}
      </p>
      <div className="afb-grid">
        <TextField form={form} name="authorName" label="Your name" required maxLength={60} placeholder="Priya (Bride)" />
        <TextAreaField form={form} name="message" label="Your note" maxLength={1000} rows={2} placeholder="e.g. Can we swap the left photo for a candid one?" />
      </div>
      <SubmitButton busy={add.isPending} className="btn btn-sm btn-gold" icon="send">
        Send feedback
      </SubmitButton>
    </form>
  )
}

export default function PublicAlbum() {
  const { token = '' } = useParams()
  const qc = useQueryClient()
  const key = ['public-album', token]
  const [name, setName] = useStoredName()
  const q = useQuery({ queryKey: key, queryFn: () => api.get<PublicAlbumDto>(`/public/albums/${token}`), retry: false })

  useEffect(() => {
    if (q.data) document.title = `${q.data.title} · Digital album`
  }, [q.data])

  const approve = async (spreadIndex: number, approved: boolean) => {
    if (!name) {
      toast.info('Add your name in the feedback box below first, so your photographer knows who approved it.', { id: 'album-name' })
      document.getElementById('f-authorName')?.focus()
      return
    }
    const authorName = name
    try {
      const d = await api.post<PublicAlbumDto>(`/public/albums/${token}/approvals`, { spreadIndex, authorName, approved })
      qc.setQueryData(key, d)
      toast.success(approved ? `Spread ${spreadIndex + 1} approved` : `Approval removed from spread ${spreadIndex + 1}`)
    } catch (e) {
      toastError(e)
    }
  }

  if (q.isPending) {
    return (
      <div className="public-shell">
        <div className="public-wrap">
          <Skeleton height={520} radius={22} />
        </div>
      </div>
    )
  }
  if (q.isError || !q.data) {
    return (
      <div className="public-shell">
        <div className="public-wrap">
          <div className="card">
            {isApiError(q.error) && q.error.status === 404 ? (
              <EmptyState icon="journal-x" title="This album isn't available" text="It may not be shared yet. Please ask your photographer for the link." />
            ) : (
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            )}
          </div>
        </div>
      </div>
    )
  }
  const a = q.data

  return (
    <div className="public-shell public-album">
      <header className="public-head">
        <div className="public-wrap public-head-inner">
          <div className="public-brand">
            <Avatar name={a.studio.name} src={a.studio.logoUrl} size={40} />
            <div>
              <strong>{a.studio.name}</strong>
              <small>
                {a.code} · {a.status === 'PUBLISHED' ? 'Final album' : 'For your review'}
              </small>
            </div>
          </div>
        </div>
      </header>
      <main className="public-wrap">
        <div className="public-title">
          <p className="eyebrow">{a.subtitle ?? a.location}</p>
          <h1 className="page-title">{a.title}</h1>
          <p className="page-subtitle">Turn the pages with the arrows or your keyboard. Approve each spread or leave a note for your photographer.</p>
        </div>
        <FlipbookModal
          inline
          isOpen
          mode="client"
          title={a.title}
          subtitle={a.subtitle ?? undefined}
          pages={a.pages}
          feedback={a.feedback}
          onToggleApproval={approve}
          renderFeedbackForm={(i) => <FeedbackForm token={token} spreadIndex={i} name={name} onName={setName} onAdded={() => q.refetch()} />}
        />
      </main>
    </div>
  )
}
