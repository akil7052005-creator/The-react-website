import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  ticketReplySchema,
  ticketSchema,
  type Paginated,
  type TicketDetailDto,
  type TicketDto,
} from '@weddyzone/shared'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader, Card, StatusPill, FeatureTooltip, FeatureBar, EmptyState, ErrorState, TableSkeleton, Pagination, CardSkeleton, type FeatureBarItem } from '../components/ui'
import { applyApiErrors, FieldShell, SelectField, SubmitButton, TextAreaField, TextField, useUnsavedChangesWarning, useZodForm } from '../components/form/form'
import { Modal, useConfirm } from '../components/Modal'
import { formatDate, formatDateTime, formatBytes } from '../utils/format'
import { featureInfo } from '../data/featureInfo'
import { useDebouncedUrlSearch, useUrlState } from '../hooks/useUrlState'
import { api, upload } from '../lib/api'
import { fileUrl } from '../lib/env'
import { toastError } from '../lib/query'

const ticketFeatures: FeatureBarItem[] = [
  {
    title: 'Guaranteed 4h SLA',
    badge: 'Fast Turnaround',
    icon: 'clock-history',
    summary: 'Our engineering and photography support desk responds to all studio inquiries in under 4 hours.',
    highlights: ['Weekend emergency support queue active', 'Assigned directly to dedicated engineer', 'Email & SMS notification on reply'],
    tip: 'Pro and All-Access members receive prioritized queue placement.',
  },
  {
    title: 'Screen-Share Assistance',
    badge: 'Live Support',
    icon: 'display',
    summary: 'Request a 1-on-1 Google Meet screen share for complex custom domain DNS or large RAW library uploads.',
    highlights: ['Live DNS verification with Cloudflare/GoDaddy', 'Lightroom catalog troubleshooting', 'Zero extra charge for studio members'],
    tip: 'Schedule screen shares during weekday mornings for fastest slots.',
  },
  {
    title: 'Album Recovery Vault',
    badge: 'Data Safety',
    icon: 'shield-check',
    summary: 'Accidentally deleted a gallery? Our recovery vault preserves backups of client selections for 90 days.',
    highlights: ['1-click historical restore', 'Preserves bride & groom heart selections', 'Audit trail of client actions'],
    tip: 'Open a ticket immediately if an accidental deletion occurs.',
  },
  {
    title: 'Dedicated WhatsApp Desk',
    badge: 'Pro & VIP',
    icon: 'whatsapp',
    summary: 'All-Access studio owners receive a direct private WhatsApp support line for instantaneous answers.',
    highlights: ['Direct line to engineering lead', 'Voice note queries accepted', 'Real-time shoot status checks'],
    tip: 'Upgrade to All-Access to unlock direct WhatsApp concierge.',
  },
]

const ATTACH_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const categoryOptions = TICKET_CATEGORIES.map((c) => ({ value: c, label: TICKET_CATEGORY_LABELS[c] }))
const priorityOptions = TICKET_PRIORITIES.map((p) => ({
  value: p,
  label: { LOW: 'Low — General inquiry', MEDIUM: 'Medium — Feature guidance', HIGH: 'High — Active wedding shoot issue' }[p],
}))
const statusTabs = [
  { key: '', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'IN_PROGRESS', label: 'In Progress' },
  { key: 'RESOLVED', label: 'Resolved' },
]

function AttachmentPicker({ file, onFile, error }: { file: File | null; onFile: (f: File | null, err?: string) => void; error?: string }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <FieldShell label="Attachment (optional)" htmlFor="ticket-attachment" error={error} hint="Screenshot or PDF, up to 10 MB" full>
      <div className="attach-row">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => input.current?.click()}>
          <i className="bi bi-paperclip" /> {file ? 'Change file' : 'Attach a file'}
        </button>
        {file && (
          <span className="muted">
            {file.name} · {formatBytes(file.size)}{' '}
            <button type="button" className="link" onClick={() => onFile(null)}>
              Remove
            </button>
          </span>
        )}
      </div>
      <input
        id="ticket-attachment"
        ref={input}
        type="file"
        hidden
        accept={ATTACH_TYPES.join(',')}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          if (!ATTACH_TYPES.includes(f.type)) return onFile(null, 'Attach an image (JPG, PNG, WebP) or a PDF')
          if (f.size > 10 * 1024 * 1024) return onFile(null, 'Attachments can be up to 10 MB')
          onFile(f)
        }}
      />
    </FieldShell>
  )
}

function NewTicketForm({ onDone }: { onDone: (t: TicketDto) => void }) {
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string>()
  const form = useZodForm(ticketSchema, { defaultValues: { subject: '', category: 'GENERAL', priority: 'MEDIUM', description: '' } })
  useUnsavedChangesWarning(form.formState.isDirty)
  const create = useMutation({
    mutationFn: (values: Record<string, string>) => {
      const fd = new FormData()
      Object.entries(values).forEach(([k, v]) => fd.append(k, v))
      if (file) fd.append('attachment', file)
      return upload<TicketDto>('/tickets', fd)
    },
    onSuccess: (t) => {
      toast.success(`Ticket ${t.code} created — we'll reply here and notify you`)
      qc.invalidateQueries({ queryKey: ['tickets'] })
      form.reset()
      onDone(t)
    },
    onError: (e) => applyApiErrors(form, e),
  })
  return (
    <Card title="Raise a Support Ticket" subtitle="Fill in details to connect with a senior technical specialist">
      <form onSubmit={form.handleSubmit((v) => create.mutate(v as Record<string, string>))} noValidate data-testid="ticket-form">
        <div className="form-grid">
          <TextField form={form} name="subject" label="Subject" required maxLength={120} showCounter placeholder="What do you need help with?" />
          <SelectField form={form} name="category" label="Category" required options={categoryOptions} />
          <SelectField form={form} name="priority" label="Priority" required options={priorityOptions} />
          <div />
          <TextAreaField form={form} name="description" label="Details & Steps" required maxLength={5000} placeholder="Please describe the event name, client URL, or screenshots link…" />
          <AttachmentPicker
            file={file}
            error={fileError}
            onFile={(f, err) => {
              setFile(f)
              setFileError(err)
            }}
          />
        </div>
        <div className="form-foot">
          <SubmitButton busy={create.isPending} icon="send">
            Submit Ticket
          </SubmitButton>
        </div>
      </form>
    </Card>
  )
}

function TicketThread({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string>()
  const q = useQuery({ queryKey: ['ticket', id], queryFn: () => api.get<TicketDetailDto>(`/tickets/${id}`) })
  const form = useZodForm(ticketReplySchema, { defaultValues: { body: '' } })
  const reply = useMutation({
    mutationFn: (v: { body: string }) => {
      const fd = new FormData()
      fd.append('body', v.body)
      if (file) fd.append('attachment', file)
      return upload<TicketDetailDto>(`/tickets/${id}/messages`, fd)
    },
    onSuccess: (t) => {
      qc.setQueryData(['ticket', id], t)
      qc.invalidateQueries({ queryKey: ['tickets'] })
      toast.success('Reply sent')
      form.reset()
      setFile(null)
    },
    onError: (e) => applyApiErrors(form, e),
  })
  const t = q.data
  const closed = t?.status === 'RESOLVED' || t?.status === 'CLOSED'

  const setStatus = (status: 'OPEN' | 'RESOLVED') =>
    confirm({
      title: status === 'RESOLVED' ? `Mark ${t!.code} as resolved?` : `Reopen ${t!.code}?`,
      message: status === 'RESOLVED' ? 'You can reopen it any time by replying.' : 'Our team will pick it up again.',
      confirmLabel: status === 'RESOLVED' ? 'Mark resolved' : 'Reopen',
      onConfirm: async () => {
        try {
          await api.patch(`/tickets/${id}/status`, { status })
          toast.success(status === 'RESOLVED' ? `Ticket ${t!.code} resolved` : `Ticket ${t!.code} reopened`)
          qc.invalidateQueries({ queryKey: ['ticket', id] })
          qc.invalidateQueries({ queryKey: ['tickets'] })
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  return (
    <Modal
      open
      onClose={onClose}
      title={t ? `${t.code} · ${t.subject}` : 'Ticket'}
      subtitle={t ? `${TICKET_CATEGORY_LABELS[t.category]} · ${TICKET_PRIORITY_LABELS[t.priority]} priority · opened ${formatDate(t.createdAt)}` : undefined}
      icon="headset"
      size="lg"
      footer={
        t && (
          <button className="btn btn-ghost" onClick={() => setStatus(closed ? 'OPEN' : 'RESOLVED')}>
            <i className={`bi bi-${closed ? 'arrow-counterclockwise' : 'check2-circle'}`} /> {closed ? 'Reopen ticket' : 'Mark resolved'}
          </button>
        )
      }
    >
      {q.isPending ? (
        <CardSkeleton rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row-between" style={{ alignItems: 'center' }}>
            <StatusPill status={TICKET_STATUS_LABELS[t!.status]} />
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
            <TextAreaField form={form} name="body" label={closed ? 'Reply (reopens the ticket)' : 'Reply'} required maxLength={5000} rows={3} />
            <AttachmentPicker
              file={file}
              error={fileError}
              onFile={(f, err) => {
                setFile(f)
                setFileError(err)
              }}
            />
            <div className="form-foot">
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

function SupportTickets() {
  const [url, setUrl] = useUrlState({ status: '', search: '', page: '1', ticket: '', new: '' })
  const [search, setSearch] = useDebouncedUrlSearch(url.search, (v) => setUrl({ search: v }))
  const page = Math.max(1, Number(url.page) || 1)
  const showForm = url.new === '1'
  const list = useQuery({
    queryKey: ['tickets', { status: url.status, search: url.search, page }],
    queryFn: () => api.get<Paginated<TicketDto>>('/tickets', { status: url.status, search: url.search, page, limit: 10 }),
    placeholderData: (p) => p,
  })
  const rows = list.data?.data ?? []

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Account & Support"
        featureBadge="Priority Helpdesk · 4h SLA"
        title="Support Tickets & Concierge"
        subtitle="Our dedicated technical support team replies within 4 working hours. Pro and All-Access studio plans receive front-of-line priority."
        actions={
          <button className="btn btn-primary" onClick={() => setUrl({ new: showForm ? '' : '1' })}>
            <i className={`bi bi-${showForm ? 'x-lg' : 'plus-lg'}`} />
            {showForm ? 'Cancel' : 'New Ticket'}
          </button>
        }
      />

      {/* Feature Capabilities Ribbon */}
      <FeatureBar items={ticketFeatures} />

      {showForm && <NewTicketForm onDone={(t) => setUrl({ new: '', ticket: t.id })} />}

      <Card
        title="Your Support Tickets"
        subtitle="Point cursor at ticket ID or priority for status SLA"
        feature={featureInfo.support}
        flush
        action={
          <div className="tabs" role="tablist">
            {statusTabs.map((s) => (
              <button key={s.label} role="tab" aria-selected={url.status === s.key} className={url.status === s.key ? 'on' : ''} onClick={() => setUrl({ status: s.key })}>
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
          <TableSkeleton rows={4} cols={5} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="headset"
            title={url.status || url.search ? 'No tickets match' : 'No support tickets yet'}
            text={url.status || url.search ? 'Try another filter.' : 'Stuck on something? Raise a ticket and we’ll help.'}
            action={
              !showForm && (
                <button className="btn btn-primary" onClick={() => setUrl({ new: '1' })}>
                  <i className="bi bi-plus-lg" /> New Ticket
                </button>
              )
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Ticket ID</th>
                  <th>Subject</th>
                  <th>Priority</th>
                  <th>Last Update</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} onClick={() => setUrl({ ticket: t.id })} style={{ cursor: 'pointer' }}>
                    <td className="mono">
                      <FeatureTooltip title={t.code} summary={`${TICKET_CATEGORY_LABELS[t.category]} · opened ${formatDate(t.createdAt)}. Click to open the conversation.`} position="top" width={240}>
                        <span className="table-th-interactive">{t.code}</span>
                      </FeatureTooltip>
                    </td>
                    <td className="cell-main">{t.subject}</td>
                    <td>
                      <FeatureTooltip
                        title={`${TICKET_PRIORITY_LABELS[t.priority]} Priority Ticket`}
                        summary={t.priority === 'HIGH' ? 'Guaranteed response within 60 minutes.' : 'Guaranteed response within 4 working hours.'}
                        position="top"
                        width={220}
                      >
                        <span className="table-th-interactive">
                          <StatusPill status={TICKET_PRIORITY_LABELS[t.priority]} />
                        </span>
                      </FeatureTooltip>
                    </td>
                    <td>{formatDate(t.lastActivityAt)}</td>
                    <td>
                      <StatusPill status={TICKET_STATUS_LABELS[t.status]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && <Pagination page={page} limit={list.data.meta.limit} total={list.data.meta.total} onPage={(p) => setUrl({ page: String(p) })} />}
      </Card>

      {url.ticket && <TicketThread id={url.ticket} onClose={() => setUrl({ ticket: '' })} />}
    </div>
  )
}

export default SupportTickets
