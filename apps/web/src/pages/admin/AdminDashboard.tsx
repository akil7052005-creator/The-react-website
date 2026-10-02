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

/** Active subscriptions per plan, as horizontal bars. */
function PlanSplit({ data }: { data: AdminStatsDto['activeByPlan'] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  const total = data.reduce((s, d) => s + d.count, 0)
  if (!total) return <EmptyState icon="pie-chart" title="No paid plans yet" text="Active paid subscriptions will show here." />
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
const H = 200
const PAD = { l: 44, r: 8, t: 16, b: 24 }

function MrrTrend({ data }: { data: AdminStatsDto['mrrTrend'] }) {
  const max = Math.max(1, ...data.map((d) => d.mrrPaise))
  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const x = (i: number) => PAD.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw)
  const y = (v: number) => PAD.t + ih - (v / max) * ih
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.mrrPaise)}`).join(' ')
  const area = `${line} L${x(data.length - 1)},${PAD.t + ih} L${x(0)},${PAD.t + ih} Z`
  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`MRR over the last 12 months, now ${formatMoney(data.at(-1)?.mrrPaise ?? 0)}`}>
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
      {data.map((d, i) => (
        <g key={d.month} tabIndex={0} aria-label={`${d.month}: ${formatMoney(d.mrrPaise)}`}>
          <rect className="hit" x={x(i) - iw / data.length / 2} y={PAD.t} width={iw / data.length} height={ih} />
          <circle className="mrr-dot" cx={x(i)} cy={y(d.mrrPaise)} r={3.5} />
          <text className="tip" x={x(i)} y={y(d.mrrPaise) - 10} textAnchor="middle">
            {compactInr(d.mrrPaise)}
          </text>
          <text x={x(i)} y={H - 6} textAnchor="middle">
            {monthLabel(d.month)}
          </text>
        </g>
      ))}
    </svg>
  )
}

function NewVsChurned({ data }: { data: AdminStatsDto['newVsChurned'] }) {
  // Even, so the middle grid line is a whole number.
  const peak = Math.max(2, ...data.flatMap((d) => [d.new, d.churned]))
  const max = peak + (peak % 2)
  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const slot = iw / data.length
  const bw = Math.min(14, slot / 2 - 3)
  const y = (v: number) => PAD.t + ih - (v / max) * ih
  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="New and churned subscriptions per month">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line className="grid-line" x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} />
          <text x={PAD.l - 6} y={y(max * f) + 4} textAnchor="end">
            {Math.round(max * f)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx = PAD.l + slot * i + slot / 2
        return (
          <g key={d.month} tabIndex={0} aria-label={`${d.month}: ${d.new} new, ${d.churned} churned`}>
            <rect className="hit" x={cx - slot / 2} y={PAD.t} width={slot} height={ih} />
            <rect className="bar-new" x={cx - bw - 1} y={y(d.new)} width={bw} height={Math.max(0, PAD.t + ih - y(d.new))} rx={3} />
            <rect className="bar-churn" x={cx + 1} y={y(d.churned)} width={bw} height={Math.max(0, PAD.t + ih - y(d.churned))} rx={3} />
            <text className="tip" x={cx} y={Math.min(y(d.new), y(d.churned)) - 6} textAnchor="middle">
              +{d.new} / −{d.churned}
            </text>
            <text x={cx} y={H - 6} textAnchor="middle">
              {monthLabel(d.month)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Platform admin home: revenue, deadlines and churn at a glance. */
export default function AdminDashboard() {
  const q = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api.get<AdminStatsDto>('/admin/stats'), refetchInterval: 60_000 })
  const s = q.data
  const active = s ? s.activeByPlan.reduce((n, p) => n + p.count, 0) : 0
  const reasons = s ? s.cancelReasons.filter((r) => r.count > 0).sort((a, b) => b.count - a.count) : []

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Platform admin"
        title="Subscriptions dashboard"
        subtitle="Revenue, upcoming deadlines and churn across every studio. Amounts exclude GST."
        actions={
          <Link to="/admin/subscriptions?tab=expiring" className="btn btn-primary">
            <i className="bi bi-alarm" /> Expiring soon
          </Link>
        }
      />
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
            <Kpi label="Active paid subscriptions" value={formatNumber(active)} sub={`${formatNumber(s!.trials)} on trial`} to="/admin/subscriptions" />
            <Kpi label="New this month" value={formatNumber(s!.newThisMonth)} sub="First paid plans" />
            <Kpi label="Expiring in 7 days" value={formatNumber(s!.expiringIn7Days)} to="/admin/subscriptions?tab=expiring" tone={s!.expiringIn7Days ? 'warn' : undefined} />
            <Kpi label="In grace" value={formatNumber(s!.inGrace)} sub="Past deadline, full access" to="/admin/subscriptions?tab=grace" tone={s!.inGrace ? 'warn' : undefined} />
            <Kpi label="Expired this month" value={formatNumber(s!.expiredThisMonth)} sub="Now read-only" to="/admin/subscriptions?tab=expired" tone={s!.expiredThisMonth ? 'bad' : undefined} />
            <Kpi label="Failed payments" value={formatNumber(s!.failedPayments)} sub="This month" to="/admin/subscriptions?tab=failed" tone={s!.failedPayments ? 'bad' : undefined} />
            <Kpi label="Cancellations" value={formatNumber(s!.cancelReasons.reduce((n, r) => n + r.count, 0))} sub="With a reason given" to="/admin/subscriptions?tab=cancelled" />
          </div>

          <div className="grid grid-2">
            <Card title="MRR trend" subtitle="Monthly recurring revenue at each month's end (yearly plans ÷ 12)">
              <MrrTrend data={s!.mrrTrend} />
            </Card>
            <Card title="New vs churned" subtitle="First paid plans vs plans that expired or were cancelled">
              <div className="chart-legend">
                <span>
                  <i style={{ background: 'var(--wine-700)' }} />
                  New
                </span>
                <span>
                  <i style={{ background: 'var(--gold)' }} />
                  Churned
                </span>
              </div>
              <NewVsChurned data={s!.newVsChurned} />
            </Card>
          </div>

          <div className="grid grid-2">
            <Card title="Plan split" subtitle="Active paid subscriptions per plan">
              <PlanSplit data={s!.activeByPlan} />
            </Card>
            <Card title="Why studios cancel" subtitle="Reasons given when cancelling">
              {reasons.length === 0 ? (
                <EmptyState icon="emoji-smile" title="No cancellations" text="Reasons appear here when a studio cancels." />
              ) : (
                <div className="split-rows" role="list">
                  {reasons.map((r) => (
                    <div className="split-row" role="listitem" key={r.reason} style={{ gridTemplateColumns: '1fr 1fr 44px' }}>
                      <span>{CANCEL_REASON_LABELS[r.reason]}</span>
                      <span className="split-track">
                        <span style={{ width: `${(r.count / reasons[0].count) * 100}%`, background: 'var(--gold)' }} />
                      </span>
                      <strong>{r.count}</strong>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
