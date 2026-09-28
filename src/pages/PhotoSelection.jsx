import { useState } from 'react'
import { PageHeader, Card, StatCard, StatusPill, Progress, Avatar, FeatureTooltip, FeatureBar } from '../components/ui'
import db from '../data'
import { formatDate, formatNumber } from '../utils/format'
import { featureInfo } from '../data/featureInfo'
import WhatsAppPreviewModal from '../components/WhatsAppPreviewModal'

const selectionFeatures = [
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

function PhotoSelection() {
  const { selections } = db
  const [remindedId, setRemindedId] = useState(null)
  const [previewClient, setPreviewClient] = useState(null)
  const active = selections.filter((s) => s.status !== 'Completed').length
  const completed = selections.filter((s) => s.status === 'Completed').length
  const picked = selections.reduce((sum, s) => sum + s.selected, 0)

  const handleRemind = (id) => {
    setRemindedId(id)
    setTimeout(() => setRemindedId(null), 2500)
  }

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
              <button
                className="btn btn-ghost"
                onClick={() => setPreviewClient({ name: 'Divya & Arvind', event: 'Madurai Wedding' })}
              >
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
              <button className="btn btn-primary">
                <i className="bi bi-plus-lg" />New Selection
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
          value={active}
          tone="gold"
          tooltip={{
            title: 'Galleries Awaiting Client Picks',
            badge: `${active} Active`,
            icon: 'hourglass-split',
            summary: 'Couples currently have access to their selection portal and are picking album favorites.',
            highlights: ['Real-time quota lock is active', 'Track who is actively viewing photos right now'],
            tip: 'Check in on selections that have been idle for more than 7 days.'
          }}
        />
        <StatCard
          icon="check2-circle"
          label="Completed"
          value={completed}
          tone="green"
          tooltip={{
            title: 'Finalized Client Selections',
            badge: `${completed} Ready`,
            icon: 'check2-circle',
            summary: 'Couples have locked their selections and submitted them for album design.',
            highlights: ['Ready for 1-click Lightroom XML export', 'Client receives confirmation notification'],
            tip: 'Move completed selections straight into 3D Digital Album layout.'
          }}
        />
        <StatCard
          icon="heart"
          label="Photos Picked"
          value={formatNumber(picked)}
          tone="wine"
          tooltip={{
            title: 'Total Photos Favorited',
            badge: `${formatNumber(picked)} Hearts`,
            icon: 'heart',
            summary: 'Cumulative number of photos favorited by clients across all active weddings.',
            highlights: ['Includes both high-res album candidates and web favorites', 'Live counter updates as couples heart photos']
          }}
        />
        <StatCard
          icon="lightning-charge"
          label="Avg. Turnaround"
          value="3.2 days"
          tone="blue"
          tooltip={{
            title: 'Average Selection Speed',
            badge: 'Industry Leading',
            icon: 'lightning-charge',
            summary: 'Time elapsed between gallery link delivery and client submission of final album picks.',
            highlights: ['Industry average is 21 days', 'Weddingz automated WhatsApp nudges cut this by 85%']
          }}
        />
      </div>

      <Card
        title="All Client Selections"
        subtitle="Point cursor at any client or progress bar to view details"
        feature={featureInfo.photoSelection}
        flush
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Event & ID</th>
                <th>Client</th>
                <th style={{ minWidth: 200 }}>
                  <FeatureTooltip
                    title="Selection Quota Progress"
                    summary="Number of photos chosen by the couple versus the allocated package limit."
                    position="top"
                    width={240}
                  >
                    <span className="table-th-interactive">Selection Progress <i className="bi bi-info-circle" /></span>
                  </FeatureTooltip>
                </th>
                <th>Deadline</th>
                <th>Status</th>
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {selections.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="cell-main">{s.event}</div>
                    <div className="cell-sub mono">{s.id}</div>
                  </td>
                  <td>
                    <div className="person"><Avatar name={s.client} size={30} />{s.client}</div>
                  </td>
                  <td>
                    <div className="progress-meta" style={{ marginBottom: 6 }}>
                      <span><strong>{formatNumber(s.selected)}</strong> / {formatNumber(s.total)} photos</span>
                      <small style={{ color: 'var(--gold)', fontWeight: 600 }}>
                        {s.selected === s.total ? 'Quota Complete' : `${s.total - s.selected} left`}
                      </small>
                    </div>
                    <Progress value={s.selected} max={s.total} label={`${s.event} selection progress`} />
                  </td>
                  <td>
                    <span style={{ fontWeight: 500 }}>{formatDate(s.deadline)}</span>
                  </td>
                  <td><StatusPill status={s.status} /></td>
                  <td className="num">
                    <FeatureTooltip
                      title="WhatsApp Nudge"
                      summary={`Send a reminder to ${s.client} to complete their selection before ${formatDate(s.deadline)}.`}
                      position="left"
                      width={240}
                    >
                      <button
                        className={`btn btn-sm ${remindedId === s.id ? 'btn-gold' : 'btn-ghost'}`}
                        onClick={() => handleRemind(s.id)}
                        disabled={s.status === 'Completed'}
                      >
                        <i className={`bi bi-${remindedId === s.id ? 'check2' : 'whatsapp'}`} />
                        {remindedId === s.id ? 'Nudge Sent!' : 'Remind'}
                      </button>
                    </FeatureTooltip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <WhatsAppPreviewModal
        isOpen={Boolean(previewClient)}
        onClose={() => setPreviewClient(null)}
        clientName={previewClient?.name}
        eventName={previewClient?.event}
      />
    </div>
  )
}

export default PhotoSelection
