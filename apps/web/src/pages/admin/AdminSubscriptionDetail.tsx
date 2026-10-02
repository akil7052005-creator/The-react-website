import { useQuery } from '@tanstack/react-query'
import { CANCEL_REASON_LABELS, stateName, type AdminSubscriptionDetailDto, type SubscriptionEventType } from '@weddyzone/shared'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { SubscriptionActionDialog, type SubscriptionAction } from '../../components/SubscriptionActions'
import { Card, CardSkeleton, EmptyState, ErrorState, PageHeader, Progress, StatusPill } from '../../components/ui'
import { DaysLeftBadge, deliveryLabel, durationText, formatIstDate, formatIstDateTime, planCycle, SubscriptionStatusPill } from '../../lib/admin'
import { api, isApiError } from '../../lib/api'
import { usageMax, usageText } from '../../lib/billing'
import { formatMoney } from '../../utils/format'

const EVENT_LABELS: Record<SubscriptionEventType, string> = {
  CREATED: 'Subscribed',
  RENEWED: 'Renewed',
  UPGRADED: 'Upgraded',
  DOWNGRADED: 'Downgraded',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired (read-only)',
  GRACE_STARTED: 'Grace period started',
  PAYMENT_FAILED: 'Payment failed',
  EXTENDED_BY_ADMIN: 'Extended by admin',
  PLAN_CHANGED_BY_ADMIN: 'Plan changed by admin',
  AUTO_RENEW_CHANGED: 'Auto-renew changed',
}
const CHANNEL_ICONS = { IN_APP: 'bell', EMAIL: 'envelope', WHATSAPP: 'whatsapp' } as const

/** Time to the deadline (or to the end of grace once the deadline has passed): "2 days 22 hrs". Updates each minute. */
function Countdown({ to, label }: { to: string; label: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const diff = new Date(to).getTime() - now
  const over = diff < 0
  return (
    <div>
      <p className="muted" style={{ margin: '0 0 6px' }}>
        {over ? `${label} passed` : label} · {formatIstDateTime(to)} IST
      </p>
      <p className={`countdown-text${over ? ' over' : ''}`}>{over ? `${durationText(diff)} ago` : `${durationText(diff)} left`}</p>
    </div>
  )
}

const ALERTS_SHOWN = 5

export default function AdminSubscriptionDetail() {
  const { id = '' } = useParams()
  const [dialog, setDialog] = useState<SubscriptionAction | null>(null)
  const [showAllAlerts, setShowAllAlerts] = useState(false)
  const q = useQuery({ queryKey: ['admin', 'subscription', id], queryFn: () => api.get<AdminSubscriptionDetailDto>(`/admin/subscriptions/${id}`), refetchInterval: 30_000 })
  const s = q.data

  if (q.isPending) {
    return (
      <div className="stack">
        <PageHeader eyebrow="Subscriptions" title="Subscription" />
        <div className="grid grid-2">
          <CardSkeleton rows={6} />
          <CardSkeleton rows={6} />
        </div>
      </div>
    )
  }
  if (q.isError || !s) {
    return (
      <div className="stack">
        <PageHeader eyebrow="Subscriptions" title="Subscription" />
        <div className="card">
          {isApiError(q.error) && q.error.status === 404 ? (
            <EmptyState icon="credit-card-2-front" title="Subscription not found" action={<Link to="/admin/subscriptions" className="btn btn-primary">All subscriptions</Link>} />
          ) : (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          )}
        </div>
      </div>
    )
  }

  const inGraceOrOver = s.status === 'GRACE' || s.status === 'EXPIRED' || s.status === 'CANCELLED'
  return (
    <div className="stack">
      <PageHeader
        eyebrow={
          <Link to="/admin/subscriptions" className="link">
            <i className="bi bi-arrow-left" /> Subscriptions
          </Link>
        }
        title={s.studio.name}
        subtitle={`${planCycle(s)} · deadline ${formatIstDate(s.endDate)}`}
        actions={
          <div className="store-btns" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={() => setDialog('remind')}>
              <i className="bi bi-alarm" /> Send reminder
            </button>
            <button className="btn btn-ghost" onClick={() => setDialog('extend')}>
              <i className="bi bi-calendar-plus" /> Extend
            </button>
            <button className="btn btn-ghost" onClick={() => setDialog('change-plan')}>
              <i className="bi bi-arrow-left-right" /> Change plan
            </button>
            <button className="btn btn-danger" onClick={() => setDialog('cancel')} disabled={s.status === 'CANCELLED'}>
              <i className="bi bi-x-octagon" /> Cancel
            </button>
          </div>
        }
      />

      <div className="grid grid-2">
        <Card title="Deadline" action={<SubscriptionStatusPill status={s.status} />}>
          <div className="stack" style={{ gap: 16 }}>
            {s.status === 'GRACE' && s.graceEndsAt ? <Countdown to={s.graceEndsAt} label="Read-only from" /> : <Countdown to={s.endDate} label={inGraceOrOver ? 'Deadline' : 'Expires'} />}
            <dl className="facts">
              <dt>Days left</dt>
              <dd>
                <DaysLeftBadge row={s} />
              </dd>
              <dt>Started</dt>
              <dd>{formatIstDate(s.startDate)}</dd>
              {s.graceEndsAt && (
                <>
                  <dt>Grace ends</dt>
                  <dd>{formatIstDateTime(s.graceEndsAt)}</dd>
                </>
              )}
              <dt>Last paid</dt>
              <dd>{s.amountPaise ? formatMoney(s.amountPaise) : '—'}</dd>
              <dt>Auto-renew</dt>
              <dd>{s.autoRenew ? `On${s.gatewaySubscriptionId ? ` · ${s.gatewaySubscriptionId}` : ''}` : 'Off'}</dd>
              {s.cancelAtPeriodEnd && (
                <>
                  <dt>Cancelling</dt>
                  <dd>
                    At period end{s.cancelReason ? ` · ${CANCEL_REASON_LABELS[s.cancelReason]}` : ''}
                    {s.cancelDetails && <div className="muted">“{s.cancelDetails}”</div>}
                  </dd>
                </>
              )}
            </dl>
          </div>
        </Card>

        <Card title="Studio">
          <dl className="facts">
            <dt>Owner</dt>
            <dd>{s.owner.name || '—'}</dd>
            <dt>Email</dt>
            <dd>
              <a className="link" href={`mailto:${s.owner.email}`}>
                {s.owner.email}
              </a>
            </dd>
            <dt>Phone</dt>
            <dd>{s.owner.phone ? <a className="link" href={`tel:${s.owner.phone}`}>{s.owner.phone}</a> : '—'}</dd>
            <dt>Location</dt>
            <dd>{[s.studioProfile.city, stateName(s.studioProfile.stateCode)].filter(Boolean).join(', ') || '—'}</dd>
            <dt>GSTIN</dt>
            <dd>{s.studioProfile.gstin ?? '—'}</dd>
            <dt>Joined</dt>
            <dd>{formatIstDate(s.studioProfile.createdAt)}</dd>
            <dt>Website</dt>
            <dd>
              <a className="link" href={`/w/${s.studio.slug}`} target="_blank" rel="noreferrer">
                /w/{s.studio.slug}
              </a>
            </dd>
          </dl>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Usage vs plan limits">
          {s.usage.map((u) => (
            <div className="progress-row" key={u.key}>
              <div className="progress-meta">
                <strong>{u.label}</strong>
                <span>{usageText(u)}</span>
              </div>
              <Progress value={u.used} max={usageMax(u)} label={u.label} />
            </div>
          ))}
        </Card>

        <Card title="Payments & invoices" flush>
          {s.payments.length === 0 ? (
            <EmptyState icon="receipt" title="No plan payments" />
          ) : (
            <div className="table-wrap admin-table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Invoice</th>
                    <th className="num">Amount</th>
                    <th className="num">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {s.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{formatIstDate(p.paidAt ?? p.createdAt)}</td>
                      <td>{p.description}</td>
                      <td className="mono">
                        {p.invoiceNumber && p.status === 'SUCCESS' ? (
                          <Link to={`/admin/invoices/${p.id}`} className="link" title="Open the printable GST invoice">
                            {p.invoiceNumber}
                          </Link>
                        ) : (
                          <span className="muted">{p.status === 'SUCCESS' ? '—' : 'Not paid'}</span>
                        )}
                      </td>
                      <td className="num cell-main">{formatMoney(p.amountPaise - p.gstPaise)}</td>
                      <td className="num">
                        <StatusPill status={p.status === 'SUCCESS' ? 'Paid' : p.status === 'FAILED' ? 'Failed' : 'Pending'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Timeline" subtitle="Every change to this subscription">
          {s.events.length === 0 ? (
            <EmptyState icon="clock-history" title="No events yet" />
          ) : (
            <ol className="timeline">
              {s.events.map((e) => (
                <li key={e.id}>
                  <div className="t-head">
                    <strong>{EVENT_LABELS[e.type]}</strong>
                    {(e.fromPlan || e.toPlan) && (
                      <span className="t-meta">
                        {e.fromPlan && e.toPlan && e.fromPlan !== e.toPlan ? `${e.fromPlan} → ${e.toPlan}` : (e.toPlan ?? e.fromPlan)}
                      </span>
                    )}
                    {e.amountPaise !== null && <span className="t-meta">{formatMoney(e.amountPaise)}</span>}
                    <time>{formatIstDateTime(e.createdAt)}</time>
                  </div>
                  {(e.note || e.actorName) && (
                    <p>
                      {e.note}
                      {e.actorName && <span className="muted"> — {e.actorName}</span>}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Alerts sent" subtitle="Reminders and notices to the studio and to admins" flush>
          {s.notifications.length === 0 ? (
            <EmptyState icon="bell-slash" title="Nothing sent yet" />
          ) : (
            <div className="table-wrap admin-table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>To</th>
                    <th>Channel</th>
                    <th>Message</th>
                    <th>Delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAllAlerts ? s.notifications : s.notifications.slice(0, ALERTS_SHOWN)).map((n) => (
                    <tr key={n.id}>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                        {formatIstDateTime(n.createdAt)}
                      </td>
                      <td>{n.recipientType === 'ADMIN' ? 'Admins' : 'Studio'}</td>
                      <td>
                        <span className="channel-chip">
                          <i className={`bi bi-${CHANNEL_ICONS[n.channel]}`} /> {n.channel === 'IN_APP' ? 'In-app' : n.channel === 'EMAIL' ? 'Email' : 'WhatsApp'}
                        </span>
                      </td>
                      <td>
                        <strong>{n.title}</strong>
                        <div className="muted" style={{ fontSize: 13 }}>
                          {n.message}
                        </div>
                      </td>
                      <td title={n.error ?? undefined}>
                        <StatusPill status={deliveryLabel(n)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {s.notifications.length > ALERTS_SHOWN && (
            <div className="show-all-row">
              <button className="link" aria-expanded={showAllAlerts} onClick={() => setShowAllAlerts((v) => !v)}>
                {showAllAlerts ? `Show latest ${ALERTS_SHOWN}` : `Show all ${s.notifications.length}`}
              </button>
            </div>
          )}
        </Card>
      </div>

      {dialog &&<SubscriptionActionDialog action={dialog} row={s} onClose={() => setDialog(null)} />}
    </div>
  )
}
