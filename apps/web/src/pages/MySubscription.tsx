import { SUBSCRIPTION_STATUS_LABELS, type UsageItem } from '@weddyzone/shared'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CancelPlanDialog, PlanBanner } from '../components/PlanBanner'
import { PageHeader, Card, ComingSoonTag, Progress, StatusPill, FeatureTooltip, EmptyState, ErrorState, CardSkeleton, Toggle, type FeatureInfo } from '../components/ui'
import { formatDate, formatMoney, formatNumber } from '../utils/format'
import { featureInfo } from '../data/featureInfo'
import { usePlanActions, useSubscription } from '../lib/billing'

const usageTips: Record<UsageItem['key'], { title: string; tip: string }> = {
  storage: { title: 'High-Speed Cloud Storage', tip: 'Upgrade to All-Access for 5 TB of storage.' },
  events: { title: 'Monthly Event Creation Quota', tip: 'Resets on the 1st of every month.' },
  albums: { title: 'Digital Album Quota', tip: 'Delete old drafts to free up album slots.' },
  credits: { title: 'WhatsApp Credits Used', tip: 'Top up anytime from WhatsApp Credit — credits never expire.' },
}

function usageSummary(u: UsageItem) {
  const unit = u.unit ? ` ${u.unit}` : ''
  if (u.limit === null) return `${formatNumber(u.used)}${unit} used — unlimited on your plan.`
  if (u.key === 'credits') return `${formatNumber(u.used)} credits used this month, ${formatNumber(u.limit - u.used)} left in your balance.`
  return `Used ${formatNumber(u.used)}${unit} of ${formatNumber(u.limit)}${unit} on your plan.`
}

function MySubscription() {
  const q = useSubscription()
  const { resume, setAutoRenew } = usePlanActions()
  const [cancelling, setCancelling] = useState(false)

  if (q.isPending) {
    return (
      <div className="stack">
        <PageHeader eyebrow="Plans & Usage" title="My Studio Subscription" subtitle="Manage your current tier, track real-time quota usage, and review billing statements." />
        <div className="grid grid-1-2">
          <CardSkeleton rows={4} />
          <CardSkeleton rows={4} />
        </div>
      </div>
    )
  }
  if (q.isError) {
    return (
      <div className="stack">
        <PageHeader eyebrow="Plans & Usage" title="My Studio Subscription" />
        <div className="card">
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </div>
      </div>
    )
  }

  const { subscription: sub, usage, recentPayments } = q.data
  const plan = sub.plan
  const yearly = sub.cycle === 'YEARLY'
  const ended = sub.readOnly
  const dateText = (iso: string) => <strong>{formatDate(iso)}</strong>

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Plans & Usage"
        featureBadge={`${SUBSCRIPTION_STATUS_LABELS[sub.status]}: ${plan.name}`}
        title="My Studio Subscription"
        subtitle="Manage your current tier, track real-time quota usage, and review billing statements."
      />
      <PlanBanner always />

      <div className="grid grid-1-2">
        <div className="lux lux-catchy">
          <p className="eyebrow">
            <i className="bi bi-patch-check-fill" />{' '}
            {sub.isTrial ? 'Free Trial' : ended ? 'Ended — read-only' : sub.status === 'GRACE' ? 'Grace period' : sub.cancelAtPeriodEnd ? 'Cancelled Membership' : 'Active Membership'}
          </p>
          <h2>
            <em>{plan.name}</em> Studio Plan
          </h2>
          <p className="big-number">
            {sub.isTrial ? formatMoney(0) : formatMoney(sub.pricePaise)}
            <small style={{ fontSize: 16, fontWeight: 500, opacity: 0.8 }}> / {yearly ? 'year' : 'month'}</small>
          </p>
          <p style={{ marginTop: 10, color: 'rgba(255, 255, 255, 0.85)' }}>
            {sub.isTrial && !ended ? (
              <>Trial ends on {dateText(sub.currentPeriodEnd)} · choose a plan to keep going</>
            ) : ended ? (
              <>Ended on {dateText(sub.currentPeriodEnd)} · renew to add events and uploads again</>
            ) : sub.status === 'GRACE' ? (
              <>Expired on {dateText(sub.currentPeriodEnd)} · full access until {sub.graceEndsAt ? dateText(sub.graceEndsAt) : 'the grace period ends'}</>
            ) : sub.cancelAtPeriodEnd ? (
              <>Ends on {dateText(sub.currentPeriodEnd)} · then your studio becomes read-only</>
            ) : sub.autoRenew ? (
              <>Renews automatically on {dateText(sub.currentPeriodEnd)} · Billed {yearly ? 'yearly' : 'monthly'}</>
            ) : (
              <>Expires on {dateText(sub.currentPeriodEnd)} · Billed {yearly ? 'yearly' : 'monthly'}</>
            )}
          </p>
          <div className="store-btns" style={{ marginTop: 20 }}>
            <Link to="/subscriptions" className="btn btn-gold">
              <i className="bi bi-arrow-up-circle-fill" /> Upgrade Plan
            </Link>
            <Link to="/all-access" className="store-btn">
              <i className="bi bi-stars" /> See All-Access
            </Link>
          </div>
          {!sub.isTrial && !ended && (
            <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
              {!sub.cancelAtPeriodEnd && sub.status !== 'GRACE' && (
                <div className="auto-renew-light">
                  <Toggle checked={sub.autoRenew} onChange={() => setAutoRenew(!sub.autoRenew)} label="Auto-renew at the end of each period" />
                </div>
              )}
              <p style={{ margin: 0 }}>
                {sub.cancelAtPeriodEnd ? (
                  <button className="link link-light" onClick={() => resume(sub)}>
                    Resume my plan
                  </button>
                ) : (
                  <button className="link link-light" onClick={() => setCancelling(true)}>
                    Cancel plan
                  </button>
                )}
              </p>
            </div>
          )}
        </div>

        <Card title="Usage This Billing Cycle" subtitle="Point cursor at any meter to inspect usage breakdown" feature={featureInfo.mySubscription}>
          {usage.map((u) => {
            const tip = usageTips[u.key]
            const pct = u.limit ? Math.round((u.used / u.limit) * 100) : 0
            return (
              <FeatureTooltip key={u.key} title={tip.title} badge={u.limit === null ? 'Unlimited' : `${pct}% Used`} summary={usageSummary(u)} tip={tip.tip} position="top" width={280}>
                <div className="progress-row" style={{ cursor: 'help' }}>
                  <div className="progress-meta">
                    <strong>
                      {u.label} <i className="bi bi-info-circle plan-feat-info" />
                    </strong>
                    <span>
                      {formatNumber(u.used)}
                      {u.limit === null ? ` ${u.unit} · Unlimited` : ` / ${formatNumber(u.limit)} ${u.unit} (${pct}%)`}
                    </span>
                  </div>
                  <Progress value={u.used} max={u.limit ?? Math.max(u.used, 1) * 4} label={u.label} />
                </div>
              </FeatureTooltip>
            )
          })}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Included in Your Plan" subtitle="Point cursor at any feature to view specifications">
          <ul className="checklist checklist-catchy" style={{ marginBottom: 0 }}>
            {plan.features.map((f) => {
              const feat = (featureInfo.features as Record<string, FeatureInfo>)?.[f]
              const li = (
                <li key={f} className={`plan-feature-item${plan.comingSoon.includes(f) ? ' is-coming-soon' : ''}`}>
                  {plan.comingSoon.includes(f) ? <i className="bi bi-clock" /> : <i className="bi bi-check-circle-fill" />}
                  <span>{f}</span>
                  {plan.comingSoon.includes(f) && <ComingSoonTag />}
                  <i className="bi bi-info-circle plan-feat-info" />
                </li>
              )
              return feat ? (
                <FeatureTooltip key={f} title={feat.title || f} summary={feat.description} position="top" width={280}>
                  {li}
                </FeatureTooltip>
              ) : (
                li
              )
            })}
          </ul>
        </Card>

        <Card
          title="Recent Payment Statements"
          flush
          action={
            <Link to="/billing" className="link">
              Billing Center <i className="bi bi-arrow-right" />
            </Link>
          }
        >
          {recentPayments.length === 0 ? (
            <EmptyState
              icon="receipt"
              title="No payments yet"
              text="Plan and credit purchases will appear here."
              action={
                <Link to="/subscriptions" className="btn btn-primary">
                  Choose a plan
                </Link>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Billing Date</th>
                    <th>Plan Cycle</th>
                    <th className="num">Amount</th>
                    <th className="num">Status</th>
                    <th className="num">Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((p) => (
                    <tr key={p.id}>
                      <td>{formatDate(p.createdAt)}</td>
                      <td>{p.description}</td>
                      <td className="num cell-main">{formatMoney(p.amountPaise)}</td>
                      <td className="num">
                        <StatusPill status={p.status === 'SUCCESS' ? 'Paid' : p.status === 'FAILED' ? 'Failed' : 'Pending'} />
                      </td>
                      <td className="num">
                        {p.invoiceNumber ? (
                          <Link to={`/my-subscription/invoices/${p.id}`} className="link" title={p.invoiceNumber}>
                            <i className="bi bi-receipt" /> View
                          </Link>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {cancelling && <CancelPlanDialog sub={sub} onClose={() => setCancelling(false)} />}
    </div>
  )
}

export default MySubscription
