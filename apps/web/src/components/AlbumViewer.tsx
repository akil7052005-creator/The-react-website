import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ALBUM_STATUS_LABELS, type AlbumDetailDto, type AlbumDto, type AlbumStatus, type SendResultDto } from '@weddyzone/shared'
import { toast } from 'sonner'
import { api } from '../lib/api'
import { toastError } from '../lib/query'
import { copyText, publicLink, sendViaWhatsApp } from '../lib/whatsapp'
import { FlipbookModal } from './FlipbookModal'
import { useConfirm } from './Modal'

const nextStatus: Record<AlbumStatus, { to: AlbumStatus; label: string; icon: string; message: string } | null> = {
  DRAFT: { to: 'IN_REVIEW', label: 'Send for review', icon: 'send', message: 'The couple will be able to open the album link and leave feedback.' },
  IN_REVIEW: { to: 'PUBLISHED', label: 'Publish', icon: 'globe2', message: 'The album becomes the final version shared with family.' },
  PUBLISHED: { to: 'IN_REVIEW', label: 'Unpublish', icon: 'arrow-counterclockwise', message: 'The album goes back to review; the link keeps working.' },
}

/** Studio view of an album: the flipbook plus status, sharing and feedback actions. */
export function AlbumViewer({ albumId, onClose }: { albumId: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const q = useQuery({
    queryKey: ['album', albumId],
    queryFn: () => api.get<AlbumDetailDto>(`/albums/${albumId}`),
    enabled: Boolean(albumId),
  })
  const album = q.data

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['album', albumId] })
    qc.invalidateQueries({ queryKey: ['albums'] })
    qc.invalidateQueries({ queryKey: ['albums-summary'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const resolve = useMutation({
    mutationFn: ({ id, resolved }: { id: string; resolved: boolean }) => api.patch(`/albums/${albumId}/feedback/${id}`, { resolved }),
    onSuccess: (_d, v) => {
      toast.success(v.resolved ? 'Feedback marked as resolved' : 'Feedback reopened')
      refresh()
    },
    onError: (e) => toastError(e),
  })

  if (!albumId) return null

  const changeStatus = (a: AlbumDto) => {
    const step = nextStatus[a.status]
    if (!step) return
    void confirm({
      title: `${step.label}: ${a.title}?`,
      message: (
        <>
          <strong>{a.code}</strong> moves from {ALBUM_STATUS_LABELS[a.status]} to <strong>{ALBUM_STATUS_LABELS[step.to]}</strong>. {step.message}
        </>
      ),
      confirmLabel: step.label,
      icon: step.icon,
      onConfirm: async () => {
        try {
          await api.patch(`/albums/${a.id}/status`, { status: step.to })
          toast.success(`Album ${a.code} is now ${ALBUM_STATUS_LABELS[step.to]}`)
          refresh()
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })
  }

  const copyLink = async (a: AlbumDto) => {
    const doCopy = async () => {
      await api.post(`/albums/${a.id}/mark-shared`)
      await copyText(publicLink('album', a.publicToken), 'Album link')
      refresh()
    }
    if (a.status !== 'DRAFT') return doCopy().catch(toastError)
    await confirm({
      title: 'Share this draft?',
      message: (
        <>
          Sharing <strong>{a.title}</strong> moves it to <strong>In Review</strong> so the couple can open it.
        </>
      ),
      confirmLabel: 'Copy link & share',
      icon: 'link-45deg',
      onConfirm: () => doCopy().catch((e) => (toastError(e), Promise.reject(e))),
    })
  }

  const shareWhatsApp = (a: AlbumDto) =>
    confirm({
      title: `Send ${a.title} on WhatsApp?`,
      message: (
        <>
          We'll open WhatsApp with the album link for the couple. This uses <strong>1 credit</strong>
          {a.status === 'DRAFT' ? ' and moves the album to In Review' : ''}.
        </>
      ),
      confirmLabel: 'Send on WhatsApp',
      icon: 'whatsapp',
      onConfirm: () =>
        sendViaWhatsApp(() => api.post<SendResultDto>(`/albums/${a.id}/share`), qc, `Album ${a.code} shared on WhatsApp`)
          .then(refresh)
          .catch((e) => {
            toastError(e)
            throw e
          }),
    })

  const step = album ? nextStatus[album.status] : null

  return (
    <FlipbookModal
      isOpen
      mode="studio"
      title={album?.title ?? 'Loading…'}
      subtitle={album?.subtitle ?? undefined}
      pages={album?.pages ?? []}
      feedback={album?.feedback ?? []}
      loading={q.isPending}
      onClose={onClose}
      onResolve={(id, resolved) => resolve.mutateAsync({ id, resolved })}
      headerActions={
        album && (
          <>
            <button className="btn btn-sm btn-ghost" onClick={() => copyLink(album)}>
              <i className="bi bi-link-45deg" /> Copy link
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => shareWhatsApp(album)}>
              <i className="bi bi-whatsapp" /> WhatsApp
            </button>
            {step && (
              <button className="btn btn-sm btn-gold" onClick={() => changeStatus(album)}>
                <i className={`bi bi-${step.icon}`} /> {step.label}
              </button>
            )}
            <button className="btn btn-sm btn-ghost" onClick={() => toast('Lab Print-Ready Export is coming soon', { description: '300 DPI CMYK PDFs for Indian print labs.' })}>
              <i className="bi bi-printer" /> Print export
            </button>
          </>
        )
      }
    />
  )
}
