import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CREDIT_PACKS,
  LOW_CREDIT_THRESHOLD,
  MESSAGE_TEMPLATE_KEYS,
  MESSAGE_TYPE_LABELS,
  type Paginated,
  type WhatsAppMessageDto,
} from '@weddyzone/shared'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  PageHeader,
  Card,
  StatusPill,
  FeatureTooltip,
  FeatureBar,
  EmptyState,
  ErrorState,
  TableSkeleton,
  Pagination,
  Skeleton,
  type FeatureBarItem,
} from '../components/ui'
import { useConfirm } from '../components/Modal'
import { Select } from '../components/Select'
import { formatDateTime, formatMoney, formatNumber } from '../utils/format'
import { featureInfo } from '../data/featureInfo'
import { useDebouncedUrlSearch, useUrlState } from '../hooks/useUrlState'
import { api } from '../lib/api'
import { TestModeNote } from '../lib/billing'
import { toastError } from '../lib/query'
import { syncCredits } from '../lib/whatsapp'

const waFeatures: FeatureBarItem[] = [
  {
    title: 'Credits Never Expire',
    badge: 'No Lock-in',
    icon: 'infinity',
    summary: 'Any WhatsApp credits you top up carry over indefinitely and never expire across wedding seasons.',
    highlights: ['1 credit = 1 message', 'Use across photo selection, albums, events and invoices', 'Top up once for the whole year'],
    tip: 'Stock up before peak wedding season.',
  },
  {
    title: 'Personalized Templates',
    badge: 'Auto-Merged',
    icon: 'chat-left-quote',
    summary: 'Messages automatically insert client names, event details, deadlines and the right private link.',
    highlights: ['Ready-made template for each message type', 'Preview every message before sending', 'Signed with your studio name'],
    tip: 'Check the preview before sending to make sure the details are right.',
  },
]

const typeOptions = [{ value: '', label: 'All message types' }, ...MESSAGE_TEMPLATE_KEYS.map((k) => ({ value: k, label: MESSAGE_TYPE_LABELS[k] }))]

interface CreditsInfo {
  balance: number
  spentThisMonth: number
  testMode: boolean
}

function WhatsAppCredit() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [url, setUrl] = useUrlState({ type: '', search: '', page: '1' })
  const [search, setSearch] = useDebouncedUrlSearch(url.search, (v) => setUrl({ search: v }))
  const page = Math.max(1, Number(url.page) || 1)
  const [picked, setPicked] = useState(CREDIT_PACKS.findIndex((p) => p.popular))
  const pack = CREDIT_PACKS[picked]

  const info = useQuery({ queryKey: ['credits'], queryFn: () => api.get<CreditsInfo>('/credits') })
  const log = useQuery({
    queryKey: ['whatsapp-messages', { type: url.type, search: url.search, page }],
    queryFn: () => api.get<Paginated<WhatsAppMessageDto>>('/credits/messages', { type: url.type, search: url.search, page, limit: 10 }),
    placeholderData: (prev) => prev,
  })
  const balance = info.data?.balance

  const buy = () =>
    confirm({
      title: `Buy ${formatNumber(pack.credits)} credits?`,
      icon: 'whatsapp',
      message: (
        <>
          You'll pay <strong>{formatMoney(pack.pricePaise)}</strong> (+18% GST) and the credits are added to your balance immediately. Credits never expire.
          <TestModeNote />
        </>
      ),
      confirmLabel: `Buy for ${formatMoney(pack.pricePaise)}`,
      onConfirm: async () => {
        try {
          const r = await api.post<{ creditBalance: number }>('/credits/purchase', { packCode: pack.code })
          syncCredits(qc, r.creditBalance)
          qc.invalidateQueries({ queryKey: ['credits'] })
          qc.invalidateQueries({ queryKey: ['subscription'] })
          toast.success(`${formatNumber(pack.credits)} credits added`, { description: `New balance: ${formatNumber(r.creditBalance)} · Test mode, no real charge` })
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  const rows = log.data?.data ?? []

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Wallet & Communications"
        featureBadge="WhatsApp Messaging"
        title="WhatsApp Credit Management"
        subtitle="Credits power client reminders, private proofing and album links, event confirmations and GST invoices."
      />

      {/* Feature Capabilities Ribbon */}
      <FeatureBar items={waFeatures} />

      <div className="grid grid-1-2">
        <FeatureTooltip feature={featureInfo.whatsappCredit} position="right" width={310}>
          <Card title="Available Credits" subtitle="Your live WhatsApp messaging balance">
            <div className="wa-balance-card">
              <span className="wa-icon-glow">
                <i className="bi bi-whatsapp" />
              </span>
              <div>
                {info.isPending ? (
                  <Skeleton width={120} height={36} />
                ) : info.isError ? (
                  <ErrorState error={info.error} onRetry={() => info.refetch()} />
                ) : (
                  <>
                    <p className="big-number" data-testid="credit-balance">
                      {formatNumber(balance!)}
                    </p>
                    <p className="muted">≈ {Math.floor(balance! / 200)} full weddings worth of guest notifications</p>
                    {balance! < LOW_CREDIT_THRESHOLD ? (
                      <span className="pill pill-danger" style={{ marginTop: 8 }}>
                        <i className="bi bi-exclamation-triangle" /> Low balance — top up
                      </span>
                    ) : (
                      <span className="pill pill-success" style={{ marginTop: 8 }}>
                        <i className="bi bi-check-circle" /> Ready to send
                      </span>
                    )}
                    <p className="muted" style={{ marginTop: 8 }}>
                      {formatNumber(info.data!.spentThisMonth)} used this month
                    </p>
                  </>
                )}
              </div>
            </div>
          </Card>
        </FeatureTooltip>

        <Card title="Top Up Credits" subtitle="Credits never expire · Instant activation">
          <p className="perks-hint" style={{ marginBottom: 12 }}>
            <i className="bi bi-cursor-fill" /> Point cursor on any pack to see how many weddings it powers:
          </p>
          <div className="grid grid-3" style={{ gap: 12 }}>
            {CREDIT_PACKS.map((p, i) => (
              <FeatureTooltip
                key={p.code}
                title={`${formatNumber(p.credits)} WhatsApp Credits`}
                badge={`₹${(p.pricePaise / 100 / p.credits).toFixed(2)} / msg`}
                summary={`Powers approximately ${Math.round(p.credits / 150)} weddings with complete proofing, guest selfie links, and payment nudges.`}
                position="top"
                width={260}
              >
                <button
                  className={`pack pack-catchy ${picked === i ? 'selected' : ''}`}
                  onClick={() => setPicked(i)}
                  aria-pressed={picked === i}
                  aria-label={`${formatNumber(p.credits)} credits for ${formatMoney(p.pricePaise)}`}
                >
                  {p.popular ? (
                    <span className="pill pill-warning">Most Popular</span>
                  ) : (
                    <span className="muted" style={{ fontSize: 11 }}>
                      Pack Option
                    </span>
                  )}
                  <strong>{formatNumber(p.credits)}</strong>
                  <span className="muted">credits · {formatMoney(p.pricePaise)}</span>
                </button>
              </FeatureTooltip>
            ))}
          </div>
          <div className="form-foot">
            <span className="pill pill-warning" title="Payments are simulated">
              <i className="bi bi-cone-striped" /> Test mode
            </span>
            <button className="btn btn-primary btn-lg" onClick={buy}>
              <i className="bi bi-lightning-charge-fill" /> Buy {formatNumber(pack.credits)} Credits for {formatMoney(pack.pricePaise)}
            </button>
          </div>
        </Card>
      </div>

      <Card
        title="Recent Message Log"
        subtitle="Every message your studio has sent, with the credits it used"
        feature={{
          title: 'Automated Messaging Audit',
          badge: 'Real-time',
          icon: 'list-check',
          summary: 'Transparent delivery logging showing exactly which couple received links and their credit deductions.',
        }}
        flush
      >
        <div className="list-toolbar">
          <label className="search">
            <i className="bi bi-search" />
            <input type="search" placeholder="Search recipient name or phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search messages" />
          </label>
          <Select<string>
            aria-label="Filter by message type"
            options={typeOptions}
            value={typeOptions.find((o) => o.value === url.type) ?? typeOptions[0]}
            onChange={(o) => setUrl({ type: o?.value ?? '' })}
          />
        </div>
        {log.isPending ? (
          <TableSkeleton rows={6} cols={5} />
        ) : log.isError ? (
          <ErrorState error={log.error} onRetry={() => log.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="chat-dots"
            title={url.type || url.search ? 'No messages match' : 'No messages sent yet'}
            text={url.type || url.search ? 'Try a different filter.' : 'Reminders, selection links, album shares and invoices you send on WhatsApp appear here.'}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Notification Type</th>
                  <th className="num">Credits</th>
                  <th>Sent Timestamp</th>
                  <th>Delivery Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="cell-main">{m.toName}</div>
                      <div className="cell-sub">{m.toPhone}</div>
                    </td>
                    <td>
                      <FeatureTooltip title={m.typeLabel} summary={m.body} position="top" width={300}>
                        <span className="pill pill-neutral">{m.typeLabel}</span>
                      </FeatureTooltip>
                    </td>
                    <td className="num cell-main">{m.credits}</td>
                    <td>{formatDateTime(m.createdAt)}</td>
                    <td>
                      <StatusPill status={m.status === 'SENT' ? 'Sent' : 'Failed'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {log.data && <Pagination page={page} limit={log.data.meta.limit} total={log.data.meta.total} onPage={(p) => setUrl({ page: String(p) })} />}
      </Card>
    </div>
  )
}

export default WhatsAppCredit
