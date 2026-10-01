import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  SELECTION_STATUS_LABELS,
  type MessagePreviewDto,
  type Paginated,
  type SelectionDto,
  type SendResultDto,
} from '@weddyzone/shared'
import { useState } from 'react'
import {
  PageHeader,
  Card,
  StatCard,
  StatusPill,
  Progress,
  Avatar,
  FeatureTooltip,
  FeatureBar,
  EmptyState,
  ErrorState,
  TableSkeleton,
  Pagination,
  type FeatureBarItem,
} from '../components/ui'
import { formatDate, formatNumber } from '../utils/format'
import { featureInfo } from '../data/featureInfo'
import WhatsAppPreviewModal from '../components/WhatsAppPreviewModal'
import { NewSelectionModal } from '../components/selection/NewSelectionModal'
import { SelectionManageModal } from '../components/selection/SelectionManageModal'
import { Select } from '../components/Select'
import { useConfirm } from '../components/Modal'
import { useDebouncedUrlSearch, useUrlState } from '../hooks/useUrlState'
import { api } from '../lib/api'
import { toastError } from '../lib/query'
import { sendViaWhatsApp } from '../lib/whatsapp'

const selectionFeatures: FeatureBarItem[] = [
  {
    title: 'Smart Quota Lock',
    badge: 'Auto Limits',
    icon: 'lock',
    summary: 'Prevents couples from picking more photos than their package includes without an upgrade.',
    highlights: ['Automatic counter shows remaining picks', 'Option for clients to purchase additional picks', 'Zero studio manual counting needed'],
    tip: 'Couples choose an average of 42 additional paid photos when quota warnings appear.'
  },
  {
    title: 'Lightroom XML Sync',
    badge: 'Instant Culling',
    icon: 'file-earmark-code',
    summary: 'Export selected filenames directly as a filter list or XML file into Adobe Lightroom Classic or Photoshop.',
    highlights: ['Zero manual file searching in Finder/Explorer', 'Compatible with Capture One and Photo Mechanic', 'Instant rating star synchronization'],
    tip: 'Save up to 4 hours per wedding by auto-filtering your 5,000 RAW shots in Lightroom.'
  },
  {
    title: 'WhatsApp Nudges',
    badge: '1-Click Remind',
    icon: 'whatsapp',
    summary: 'Send a personalized WhatsApp message with the private gallery link to nudge couples before their deadline.',
    highlights: ['Personalized with bride & groom names', 'Includes selection count progress', 'Direct access without passwords'],
    tip: 'Reminders sent on Sunday evenings yield 3x faster turnaround.'
  },
  {
    title: 'Family Multi-Hearting',
    badge: 'Collaborative',
    icon: 'heart-half',
    summary: 'Allow both bride and groom to create independent favorite lists before consolidating.',
    highlights: ['Filter by Bride picks vs Groom picks', 'Color-coded tags for ceremony, portraits, haldi', 'Shared summary view for final approval'],
    tip: 'Reduces wedding family disagreements over album selections.'
  }
]

const statusFilters = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active (not submitted)' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SENT', label: 'Awaiting Selection' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'SUBMITTED', label: 'Completed' },
  { value: 'EXPIRED', label: 'Expired' },
]

interface Summary {
  active: number
  completed: number
  picked: number
  avgTurnaroundDays: number | null
}

function PhotoSelection() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [url, setUrl] = useUrlState({ search: '', status: '', page: '1', sort: '', selection: '', new: '' })
  const [search, setSearch] = useDebouncedUrlSearch(url.search, (v) => setUrl({ search: v }))
  const [preview, setPreview] = useState(false)
  const page = Math.max(1, Number(url.page) || 1)

  const list = useQuery({
    queryKey: ['selections', { search: url.search, status: url.status, page, sort: url.sort }],
    queryFn: () => api.get<Paginated<SelectionDto>>('/selections', { search: url.search, status: url.status, page, limit: 10, sort: url.sort }),
    placeholderData: (prev) => prev,
  })
  const summary = useQuery({ queryKey: ['selections-summary'], queryFn: () => api.get<Summary>('/selections/summary') })

  const managed = list.data?.data.find((s) => s.id === url.selection) ?? null
  const managedQ = useQuery({
    queryKey: ['selection', url.selection],
    queryFn: () => api.get<SelectionDto>(`/selections/${url.selection}`),
    enabled: Boolean(url.selection) && !managed,
  })

  // "Preview Client Message" shows the reminder for the most urgent live selection.
  const firstActive = useQuery({
    queryKey: ['selections', { status: 'active', limit: 1, sort: 'deadline' }],
    queryFn: () => api.get<Paginated<SelectionDto>>('/selections', { status: 'active', limit: 1, sort: 'deadline' }),
    enabled: preview,
  })
  const previewId = firstActive.data?.data[0]?.id
  const previewQ = useQuery({
    queryKey: ['selection-preview', previewId, 'reminder'],
    queryFn: () => api.get<MessagePreviewDto>(`/selections/${previewId}/message-preview`, { type: 'reminder' }),
    enabled: Boolean(previewId),
  })

  const remind = (s: SelectionDto) =>
    confirm({
      title: `Remind ${s.client.name}?`,
      message: (
        <>
          We'll open WhatsApp with a reminder for <strong>{s.event.title}</strong> ({s.pickedCount} of {s.quota} picked, deadline {formatDate(s.deadline)}). This uses{' '}
          <strong>1 credit</strong>.
        </>
      ),
      confirmLabel: 'Send reminder',
      icon: 'whatsapp',
      onConfirm: () =>
        sendViaWhatsApp(
          () => api.post<SendResultDto>(`/selections/${s.id}/${s.status === 'DRAFT' ? 'send' : 'remind'}`),
          qc,
          `Reminder sent to ${s.client.name}`,
        )
          .then(() => qc.invalidateQueries({ queryKey: ['selections'] }))
          .catch((e) => {
            toastError(e)
            throw e
          }),
    })

  const sum = summary.data
  const rows = list.data?.data ?? []

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Services"
        featureBadge="AI Culling & Proofing"
        title="Photo Selection Portal"
        subtitle="Share private branded galleries where couples heart and select their favorite shots. Selections sync live with your editing catalog."
        actions={
          <>
            <FeatureTooltip
              title="Preview Client WhatsApp Notification"
              summary="See the realistic smartphone WhatsApp message that couples receive with their gallery link."
              position="bottom"
              width={270}
            >
              <button className="btn btn-ghost" onClick={() => setPreview(true)}>
                <i className="bi bi-whatsapp" style={{ color: 'var(--success)' }} /> Preview Client Message
              </button>
            </FeatureTooltip>

            <FeatureTooltip
              title="Create New Selection Gallery"
              badge="Client Link"
              icon="plus-circle"
              summary="Upload watermarked thumbnails and assign maximum selection quota for client album proofing."
              position="bottom"
              width={280}
            >
              <button className="btn btn-primary" onClick={() => setUrl({ new: '1' })}>
                <i className="bi bi-plus-lg" />
                New Selection
              </button>
            </FeatureTooltip>
          </>
        }
      />

      {/* Feature Capabilities Ribbon */}
      <FeatureBar items={selectionFeatures} />

      <div className="grid grid-4">
        <StatCard
          icon="hourglass-split"
          label="Active Selections"
          value={sum ? sum.active : '—'}
          tone="gold"
          tooltip={{
            title: 'Galleries Awaiting Client Picks',
            badge: `${sum?.active ?? 0} Active`,
            icon: 'hourglass-split',
            summary: 'Couples currently have access to their selection portal and are picking album favorites.',
            highlights: ['Real-time quota lock is active', 'Track who is actively viewing photos right now'],
            tip: 'Check in on selections that have been idle for more than 7 days.',
          }}
        />
        <StatCard
          icon="check2-circle"
          label="Completed"
          value={sum ? sum.completed : '—'}
          tone="green"
          tooltip={{
            title: 'Finalized Client Selections',
            badge: `${sum?.completed ?? 0} Ready`,
            icon: 'check2-circle',
            summary: 'Couples have locked their selections and submitted them for album design.',
            highlights: ['Ready for 1-click Lightroom XML export', 'Client receives confirmation notification'],
            tip: 'Move completed selections straight into 3D Digital Album layout.',
          }}
        />
        <StatCard
          icon="heart"
          label="Photos Picked"
          value={sum ? formatNumber(sum.picked) : '—'}
          tone="wine"
          tooltip={{
            title: 'Total Photos Favorited',
            badge: `${formatNumber(sum?.picked ?? 0)} Hearts`,
            icon: 'heart',
            summary: 'Cumulative number of photos favorited by clients across all active weddings.',
          }}
        />
        <StatCard
          icon="lightning-charge"
          label="Avg. Turnaround"
          value={sum?.avgTurnaroundDays != null ? `${sum.avgTurnaroundDays} days` : '—'}
          tone="blue"
          tooltip={{
            title: 'Average Selection Speed',
            badge: 'From your data',
            icon: 'lightning-charge',
            summary: 'Time elapsed between gallery link delivery and client submission of final album picks.',
          }}
        />
      </div>

      <Card title="All Client Selections" subtitle="Point cursor at any client or progress bar to view details" feature={featureInfo.photoSelection} flush>
        <div className="list-toolbar">
          <label className="search">
            <i className="bi bi-search" />
            <input type="search" placeholder="Search couple, event or SEL code" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search selections" />
          </label>
          <Select<string>
            aria-label="Filter by status"
            options={statusFilters}
            value={statusFilters.find((f) => f.value === url.status) ?? statusFilters[0]}
            onChange={(o) => setUrl({ status: o?.value ?? '' })}
          />
          <Select<string>
            aria-label="Sort"
            options={[
              { value: '', label: 'Newest first' },
              { value: 'deadline', label: 'Deadline (soonest)' },
              { value: '-deadline', label: 'Deadline (latest)' },
            ]}
            value={[{ value: '', label: 'Newest first' }, { value: 'deadline', label: 'Deadline (soonest)' }, { value: '-deadline', label: 'Deadline (latest)' }].find((o) => o.value === url.sort)}
            onChange={(o) => setUrl({ sort: o?.value ?? '' })}
          />
        </div>

        {list.isPending ? (
          <TableSkeleton rows={5} cols={6} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          url.search || url.status ? (
            <EmptyState
              icon="search"
              title="No selections match"
              text="Try a different search or status."
              action={
                <button className="btn btn-ghost" onClick={() => setUrl({ search: '', status: '' })}>
                  Clear filters
                </button>
              }
            />
          ) : (
            <EmptyState
              icon="images"
              title="No selections yet"
              text="Create a selection, upload the event photos, and share the private link with your couple."
              action={
                <button className="btn btn-primary" onClick={() => setUrl({ new: '1' })}>
                  <i className="bi bi-plus-lg" /> New Selection
                </button>
              }
            />
          )
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Event & ID</th>
                  <th>Client</th>
                  <th style={{ minWidth: 200 }}>
                    <FeatureTooltip title="Selection Quota Progress" summary="Number of photos chosen by the couple versus the allocated package limit." position="top" width={240}>
                      <span className="table-th-interactive">
                        Selection Progress <i className="bi bi-info-circle" />
                      </span>
                    </FeatureTooltip>
                  </th>
                  <th>Deadline</th>
                  <th>Status</th>
                  <th className="num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const left = s.quota - s.pickedCount
                  const canRemind = s.status !== 'SUBMITTED' && s.status !== 'EXPIRED' && s.photoCount > 0
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="cell-main">{s.event.title}</div>
                        <div className="cell-sub mono">{s.code}</div>
                      </td>
                      <td>
                        <div className="person">
                          <Avatar name={s.client.name} size={30} />
                          {s.client.name}
                        </div>
                      </td>
                      <td>
                        <div className="progress-meta" style={{ marginBottom: 6 }}>
                          <span>
                            <strong>{formatNumber(s.pickedCount)}</strong> / {formatNumber(s.quota)} photos
                          </span>
                          <small style={{ color: 'var(--gold)', fontWeight: 600 }}>{left <= 0 ? 'Quota Complete' : `${left} left`}</small>
                        </div>
                        <Progress value={s.pickedCount} max={s.quota} label={`${s.event.title} selection progress`} />
                      </td>
                      <td>
                        <span style={{ fontWeight: 500 }}>{formatDate(s.deadline)}</span>
                      </td>
                      <td>
                        <StatusPill status={SELECTION_STATUS_LABELS[s.status]} />
                      </td>
                      <td className="num">
                        <div className="row-actions">
                          <FeatureTooltip
                            title="WhatsApp Nudge"
                            summary={
                              canRemind
                                ? `Send a reminder to ${s.client.name} to complete their selection before ${formatDate(s.deadline)}.`
                                : s.photoCount === 0
                                  ? 'Upload photos first.'
                                  : 'Nothing to remind — this selection is closed.'
                            }
                            position="left"
                            width={240}
                          >
                            <button className="btn btn-sm btn-ghost" onClick={() => remind(s)} disabled={!canRemind}>
                              <i className="bi bi-whatsapp" />
                              Remind
                            </button>
                          </FeatureTooltip>
                          <button className="btn btn-sm btn-ghost" onClick={() => setUrl({ selection: s.id })} aria-label={`Manage ${s.code}`}>
                            <i className="bi bi-sliders" /> Manage
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.data && <Pagination page={page} limit={list.data.meta.limit} total={list.data.meta.total} onPage={(p) => setUrl({ page: String(p) })} />}
      </Card>

      <NewSelectionModal open={url.new === '1'} onClose={() => setUrl({ new: '' })} />
      {url.selection && (managed ?? managedQ.data) && <SelectionManageModal selection={(managed ?? managedQ.data)!} onClose={() => setUrl({ selection: '' })} />}

      <WhatsAppPreviewModal
        isOpen={preview}
        onClose={() => setPreview(false)}
        preview={previewQ.data}
        loading={firstActive.isPending || (Boolean(previewId) && previewQ.isPending)}
        error={firstActive.isSuccess && !previewId ? 'No active selection yet — create one to preview the client message.' : null}
      />
    </div>
  )
}

export default PhotoSelection
