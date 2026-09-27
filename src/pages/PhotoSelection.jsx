import { PageHeader, Card, StatCard, StatusPill, Progress, Avatar } from '../components/ui'
import db from '../data'
import { formatDate, formatNumber } from '../utils/format'

function PhotoSelection() {
  const { selections } = db
  const active = selections.filter((s) => s.status !== 'Completed').length
  const completed = selections.filter((s) => s.status === 'Completed').length
  const picked = selections.reduce((sum, s) => sum + s.selected, 0)

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Services"
        title="Photo Selection"
        subtitle="Share a private gallery and let couples heart the photos they love. Selections sync live."
        actions={<button className="btn btn-primary"><i className="bi bi-plus-lg" />New Selection</button>}
      />

      <div className="grid grid-4">
        <StatCard icon="hourglass-split" label="Active selections" value={active} tone="gold" />
        <StatCard icon="check2-circle" label="Completed" value={completed} tone="green" />
        <StatCard icon="heart" label="Photos picked" value={formatNumber(picked)} tone="wine" />
        <StatCard icon="lightning-charge" label="Avg. turnaround" value="3.2 days" tone="blue" />
      </div>

      <Card title="All selections" subtitle="Track how far each client has got" flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Client</th>
                <th style={{ minWidth: 200 }}>Selected</th>
                <th>Deadline</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {selections.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="cell-main">{s.event}</div>
                    <div className="cell-sub mono">{s.id}</div>
                  </td>
                  <td><div className="person"><Avatar name={s.client} size={30} />{s.client}</div></td>
                  <td>
                    <div className="progress-meta" style={{ marginBottom: 6 }}>
                      <span>{formatNumber(s.selected)} / {formatNumber(s.total)}</span>
                    </div>
                    <Progress value={s.selected} max={s.total} label={`${s.event} selection progress`} />
                  </td>
                  <td>{formatDate(s.deadline)}</td>
                  <td><StatusPill status={s.status} /></td>
                  <td className="num">
                    <button className="btn btn-ghost btn-sm"><i className="bi bi-whatsapp" />Remind</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export default PhotoSelection
