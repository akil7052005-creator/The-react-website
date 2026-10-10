import { Link } from 'react-router-dom'
import { gbText, meterText, usePlanActions, useUsage } from '../lib/billing'

/**
 * The plan meter: "Events 7/10 · Uploads 320 GB of 500 GB · resets on 8 Nov". Amber from 80 % (8 of
 * 10 events) with "Upgrade" and, on Pro, "Buy +5 events"; red when a limit is reached.
 */
export function UsageMeter() {
  const q = useUsage()
  const { buyAddon } = usePlanActions()
  const m = q.data
  if (!m) return null
  const eventsFull = m.events.limit !== null && m.events.used >= m.events.limit
  const uploadsFull = m.uploads.limitBytes !== null && m.uploads.usedBytes >= m.uploads.limitBytes
  const tone = m.blocked || eventsFull || uploadsFull ? 'red' : m.warn ? 'amber' : 'ok'
  const pct = (used: number, limit: number | null) => (limit ? Math.min(100, Math.round((used / limit) * 100)) : 0)
  return (
    <section className={`usage-meter tone-${tone}`} aria-label="Plan usage" data-testid="usage-meter">
      <div className="um-head">
        <strong>{m.planName}</strong>
        <span className="um-text" data-testid="usage-meter-text">
          {meterText(m)}
        </span>
      </div>
      <div className="um-bars">
        {m.events.limit !== null && (
          <div className="um-bar" title={`Events ${m.events.used} of ${m.events.limit}`}>
            <span>Events</span>
            <div className="uf-track" role="progressbar" aria-label="Events used" aria-valuenow={m.events.used} aria-valuemin={0} aria-valuemax={m.events.limit}>
              <span style={{ width: `${pct(m.events.used, m.events.limit)}%` }} />
            </div>
          </div>
        )}
        {m.uploads.limitBytes !== null && (
          <div className="um-bar" title={`Uploads ${gbText(m.uploads.usedBytes)} of ${gbText(m.uploads.limitBytes)}`}>
            <span>Uploads</span>
            <div className="uf-track" role="progressbar" aria-label="Uploads used" aria-valuenow={pct(m.uploads.usedBytes, m.uploads.limitBytes)} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${pct(m.uploads.usedBytes, m.uploads.limitBytes)}%` }} />
            </div>
          </div>
        )}
      </div>
      {(tone !== 'ok' || m.isTrial) && (
        <div className="um-actions">
          <p className="um-note" role={tone === 'red' ? 'alert' : undefined}>
            {m.blocked
              ? 'Your plan has ended: renew to add events and upload photos.'
              : eventsFull
                ? `You've used all your events${m.lifetime ? ' on the Trial' : ' this month'}.`
                : uploadsFull
                  ? `You've used all your uploads${m.lifetime ? ' on the Trial' : ' this month'}.`
                  : m.warn
                    ? 'You are close to your plan limit.'
                    : 'You are on the free Trial.'}
          </p>
          <Link to="/subscriptions" className="btn btn-sm btn-primary">
            <i className="bi bi-arrow-up-circle" /> {m.blocked ? 'Renew' : 'Upgrade'}
          </Link>
          {m.addon && !m.blocked && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void buyAddon(m.addon!)} data-testid="buy-addon">
              <i className="bi bi-plus-circle" /> Buy +{m.addon.events} events
            </button>
          )}
        </div>
      )}
    </section>
  )
}
