import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  ticketReplySchema,
  type Paginated,
  type TicketDetailDto,
  type TicketDto,
  type TicketStatus,
} from '@weddyzone/shared'
import { toast } from 'sonner'
import { applyApiErrors, SubmitButton, TextAreaField, useZodForm } from '../../components/form/form'
import { Modal } from '../../components/Modal'
import { Card, CardSkeleton, EmptyState, ErrorState, PageHeader, Pagination, StatusPill, TableSkeleton } from '../../components/ui'
import { useDebouncedUrlSearch, useUrlState } from '../../hooks/useUrlState'
import { api } from '../../lib/api'
import { fileUrl } from '../../lib/env'
import { toastError } from '../../lib/query'
import { formatDateTime } from '../../utils/format'

const LIMIT = 20
const statusTabs: { key: string; label: string }[] = [
  { key: 'active', label: 'Needs attention' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'CLOSED', label: 'Closed' },
  { key: 'all', label: 'All' },
]

const listKey = (q: object) => ['admin', 'tickets', q] as const

function TicketThread({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'ticket', id], queryFn: () => api.get<TicketDetailDto>(`/admin/tickets/${id}`) })
  const form = useZodForm(ticketReplySchema, { defaultValues: { body: '' } })
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] })

  const reply = useMutation({
    mutationFn: (body: { body: string }) => api.post(`/admin/tickets/${id}/messages`, body),
    onSuccess: async () => {
      form.reset({ body: '' })
      toast.success('Reply sent to the studio')
      await refresh()
    },
    onError: (e) => applyApiErrors(form, e),
  })
  const setStatus = useMutation({
    mutationFn: (status: TicketStatus) => api.patch(`/admin/tickets/${id}/status`, { status }),
    onSuccess: async (_d, status) => {
      toast.success(`Marked ${TICKET_STATUS_LABELS[status].toLowerCase()}`)
      await refresh()
    },
    onError: (e) => toastError(e),
  })
  const t = q.data

  return (
    <Modal open onClose={onClose} title={t ? `${t.code} · ${t.subject}` : 'Ticket'} subtitle={t ? `${t.studioName} · ${TICKET_CATEGORY_LABELS[t.category]} · ${TICKET_PRIORITY_LABELS[t.priority]} priority` : undefined} icon="headset" size="lg">
      {q.isPending ? (
        <CardSkeleton rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row-between" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label className="admin-inline-field">
              <span>Status</span>
              <select
                aria-label="Ticket status"
                value={t!.status}
                disabled={setStatus.isPending}
                onChange={(e) => setStatus.mutate(e.target.value as TicketStatus)}
              >
                {TICKET_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TICKET_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted">Last update {formatDateTime(t!.lastActivityAt)}</span>
          </div>
          <ol className="thread">
            {t!.messages.map((m) => (
              <li key={m.id} className={`thread-msg${m.fromSupport ? ' from-support' : ''}`}>
                <div className="thread-meta">
                  <strong>{m.authorName}</strong>
                  <time>{formatDateTime(m.createdAt)}</time>
                </div>
                <p>{m.body}</p>
                {m.attachmentUrl && (
                  <a className="link" href={fileUrl(m.attachmentUrl)} target="_blank" rel="noreferrer">
                    <i className="bi bi-paperclip" /> {m.attachmentName}
                  </a>
                )}
              </li>
            ))}
          </ol>
          <form onSubmit={form.handleSubmit((v) => reply.mutate(v))} noValidate>
            <TextAreaField form={form} name="body" label="Reply as Weddyzone Support" required maxLength={5000} rows={4} />
            <div className="form-foot">
              <span className="muted">The studio is notified in the app.</span>
              <SubmitButton busy={reply.isPending} icon="send">
                Send reply
              </SubmitButton>
            </div>
          </form>
        </div>
      )}
    </Modal>
  )
}

/** Platform admin: every studio's support tickets. */
export default function AdminTickets() {
  const [url, setUrl] = useUrlState({ status: 'active', search: '', page: '1', ticket: '' })
  const [search, setSearch] = useDebouncedUrlSearch(url.search, (v) => setUrl({ search: v, page: '1' }))
  const page = Number(url.page) || 1
  // An empty value falls back to the default tab in the URL, so 'All' has its own key.
  const query = { status: url.status === 'all' ? undefined : url.status, search: url.search || undefined, page, limit: LIMIT }
  const list = useQuery({
    queryKey: listKey(query),
    queryFn: () => api.get<Paginated<TicketDto>>('/admin/tickets', query),
    placeholderData: keepPreviousData,
  })
  const rows = list.data?.data ?? []

  return (
    <div className="stack">
      <PageHeader title="Support inbox" subtitle="Every studio's tickets. Replies reach the studio as Weddyzone Support." />
      <Card
        title="Tickets"
        flush
        action={
          <div className="tabs" role="tablist">
            {statusTabs.map((s) => (
              <button key={s.label} role="tab" aria-selected={url.status === s.key} className={url.status === s.key ? 'on' : ''} onClick={() => setUrl({ status: s.key, page: '1' })}>
                {s.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="list-toolbar">
          <label className="search">
            <i className="bi bi-search" />
            <input type="search" placeholder="Search subject or TKT code" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search tickets" />
          </label>
        </div>
        {list.isPending ? (
          <TableSkeleton rows={5} cols={6} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon="inbox" title={url.search ? 'No tickets match' : 'Nothing here'} text={url.status === 'active' && !url.search ? 'No studio is waiting on support right now.' : 'Try another filter.'} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Studio</th>
                    <th>Subject</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id} className="row-clickable" onClick={() => setUrl({ ticket: t.id })}>
                      <td>
                        <button className="link" onClick={() => setUrl({ ticket: t.id })}>
                          {t.code}
                        </button>
                      </td>
                      <td>{t.studioName}</td>
                      <td className="cell-main">{t.subject}</td>
                      <td>
                        <StatusPill status={TICKET_PRIORITY_LABELS[t.priority]} />
                      </td>
                      <td>
                        <StatusPill status={TICKET_STATUS_LABELS[t.status]} />
                      </td>
                      <td className="muted">{formatDateTime(t.lastActivityAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} limit={LIMIT} total={list.data!.meta.total} onPage={(p) => setUrl({ page: String(p) })} />
          </>
        )}
      </Card>
      {url.ticket && <TicketThread id={url.ticket} onClose={() => setUrl({ ticket: '' })} />}
    </div>
  )
}
