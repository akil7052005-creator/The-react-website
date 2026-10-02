import { useQuery } from '@tanstack/react-query'
import { CANCEL_REASON_LABELS, type AdminStatsDto } from '@weddyzone/shared'
import { Link } from 'react-router-dom'
import { Card, CardSkeleton, EmptyState, ErrorState, PageHeader, StatSkeletonRow } from '../../components/ui'
import { api } from '../../lib/api'
import { formatMoney, formatNumber } from '../../utils/format'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1]
const compactInr = (paise: number) => {
  const r = paise / 100
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(1)}Cr`
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(1)}L`
  if (r >= 1e3) return `₹${(r / 1e3).toFixed(1)}k`
  return `₹${Math.round(r)}`
}

function Kpi({ label, value, sub, to, tone }: { label: string; value: string; sub?: string; to?: string; tone?: 'warn' | 'bad' }) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </>
  )
  return to ? (
    <Link to={to} className={`kpi ${tone ?? ''}`}>
      {body}
    </Link>
  ) : (
    <div className={`kpi ${tone ?? ''}`}>{body}</div>
  )
}

/** Active paid subscriptions per plan, as horizontal bars. */
function PlanSplit({ data }: { data: AdminStatsDto['activeByPlan'] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  if (!data.some((d) => d.count)) return <EmptyState icon="pie-chart" title="No paid plans yet" text="Active paid subscriptions will show here." />
  return (
    <div className="split-rows" role="list">
      {data.map((d) => (
        <div className="split-row" role="listitem" key={d.code} aria-label={`${d.name}: ${d.count}`}>
          <span>{d.name}</span>
          <span className="split-track">
            <span style={{ width: `${(d.count / max) * 100}%` }} />
          </span>
          <strong>{d.count}</strong>
        </div>
      ))}
    </div>
  )
}

const W = 600
const H = 210
const PAD = { l: 44, r: 8, t: 30, b: 24 }

/** MRR at each month's end (the last point is now). Hover or focus a month for its new and churned counts. */
function MrrTrend({ mrr, flow }: { mrr: AdminStatsDto['mrrTrend']; flow: AdminStatsDto['newVsChurned'] }) {
  const max = Math.max(1, ...mrr.map((d) => d.mrrPaise))
  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const x = (i: number) => PAD.l + (mrr.length === 1 ? iw / 2 : (i / (mrr.length - 1)) * iw)
  const y = (v: number) => PAD.t + ih - (v / max) * ih
  const line = mrr.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.mrrPaise)}`).join(' ')
  const area = `${line} L${x(mrr.length - 1)},${PAD.t + ih} L${x(0)},${PAD.t + ih} Z`
  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`MRR over the last 12 months, now ${formatMoney(mrr.at(-1)?.mrrPaise ?? 0)}`}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line className="grid-line" x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} />
          <text x={PAD.l - 6} y={y(max * f) + 4} textAnchor="end">
            {compactInr(max * f)}
          </text>
        </g>
      ))}
      <path className="mrr-area" d={area} />
      <path className="mrr-line" d={line} />
      {mrr.map((d, i) => {
        const f = flow.find((m) => m.month === d.month)
        const tip = `${compactInr(d.mrrPaise)}${f && (f.new || f.churned) ? ` · +${f.new} new / −${f.churned} churned` : ''}`
        // Keep the first and last tooltips inside the chart.
        const anchor = i === 0 ? 'start' : i === mrr.length - 1 ? 'end' : 'middle'
        return (
          <g key={d.month} tabIndex={0} aria-label={`${d.month}: ${formatMoney(d.mrrPaise)}${f ? `, ${f.new} new, ${f.churned} churned` : ''}`}>
            <rect className="hit" x={x(i) - iw / mrr.length / 2} y={0} width={iw / mrr.length} height={H} />
            <circle className="mrr-dot" cx={x(i)} cy={y(d.mrrPaise)} r={3.5} />
            <text className="tip" x={x(i)} y={Math.max(12, y(d.mrrPaise) - 10)} textAnchor={anchor}>
              {tip}
            </text>
            <text x={x(i)} y={H - 6} textAnchor="middle">
              {monthLabel(d.month)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Platform admin home: revenue and what needs attention. */
export default function AdminDashboard() {
  const q = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api.get<AdminStatsDto>('/admin/stats'), refetchInterval: 60_000 })
  const s = q.data
  const active = s ? s.activeByPlan.reduce((n, p) => n + p.count, 0) : 0
  const reasons = s ? s.cancelReasons.filter((r) => r.count > 0).sort((a, b) => b.count - a.count) : []
  const attention = s
    ? [`${s.inGrace} in grace`, `${s.expiringIn7Days} expiring in 7 days`, `${s.paymentFailed} payment${s.paymentFailed === 1 ? '' : 's'} failed`].join(' · ')
    : ''

  return (
    <div className="stack">
      <PageHeader title="Subscriptions dashboard" subtitle="Revenue and the studios that need attention." />
      {q.isPending ? (
        <>
          <StatSkeletonRow count={4} />
          <div className="grid grid-2">
            <CardSkeleton rows={5} />
            <CardSkeleton rows={5} />
          </div>
        </>
      ) : q.isError ? (
        <div className="card">
          <ErrorState error={q.error} onRetry={() => q.refetch()} title="We could not load the dashboard" />
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            <Kpi label="MRR" value={formatMoney(s!.mrrPaise)} sub={`ARR ${formatMoney(s!.arrPaise)}`} />
            <Kpi label="Active paid" value={formatNumber(active)} sub={`${formatNumber(s!.trials)} on trial`} to="/admin/subscriptions" />
            <Kpi label="Needs attention" value={formatNumber(s!.needsAttention)} sub={attention} to="/admin/subscriptions?tab=attention" tone={s!.needsAttention ? 'warn' : undefined} />
            <Kpi label="Expired this month" value={formatNumber(s!.expiredThisMonth)} sub="Now read-only" to="/admin/subscriptions?tab=expired" tone={s!.expiredThisMonth ? 'bad' : undefined} />
          </div>

          <div className="grid grid-2">
            <Card title="MRR trend" subtitle="At each month's end; yearly plans count ÷ 12">
              <MrrTrend mrr={s!.mrrTrend} flow={s!.newVsChurned} />
            </Card>
            <Card title="Plan split" subtitle="Active paid subscriptions per plan">
              <PlanSplit data={s!.activeByPlan} />
            </Card>
          </div>

          {reasons.length > 0 && (
            <Card title="Why studios cancel" subtitle="Reasons given when cancelling">
              <div className="split-rows" role="list">
                {reasons.map((r) => (
                  <div className="split-row reason-row" role="listitem" key={r.reason}>
                    <span>{CANCEL_REASON_LABELS[r.reason]}</span>
                    <span className="split-track">
                      <span style={{ width: `${(r.count / reasons[0].count) * 100}%`, background: 'var(--gold)' }} />
                    </span>
                    <strong>{r.count}</strong>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
