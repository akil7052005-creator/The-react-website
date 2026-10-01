import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ApiError } from '../lib/api'
import { onGlobalError } from '../lib/query'
import { Modal } from './Modal'

const resourceLabel: Record<string, string> = {
  events: 'events this month',
  albums: 'digital albums',
  storage: 'storage',
}

/** Upgrade (PLAN_LIMIT) and top-up (INSUFFICIENT_CREDITS) dialogs, opened by any API call. */
export function GlobalDialogs() {
  const [limit, setLimit] = useState<ApiError | null>(null)
  const [credits, setCredits] = useState<ApiError | null>(null)
  const navigate = useNavigate()

  useEffect(() => onGlobalError('PLAN_LIMIT', setLimit), [])
  useEffect(() => onGlobalError('INSUFFICIENT_CREDITS', setCredits), [])

  const details = (limit?.details ?? {}) as { resource?: string; limit?: number; used?: number }
  const creditDetails = (credits?.details ?? {}) as { needed?: number; balance?: number }

  return (
    <>
      <Modal
        open={Boolean(limit)}
        onClose={() => setLimit(null)}
        title="Upgrade to keep going"
        subtitle="You've reached a limit on your current plan"
        icon="arrow-up-circle"
        size="sm"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setLimit(null)}>
              Not now
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setLimit(null)
                navigate('/subscriptions')
              }}
            >
              <i className="bi bi-arrow-up-circle-fill" /> See plans
            </button>
          </>
        }
      >
        <p className="confirm-message">{limit?.message}</p>
        {details.resource && details.limit !== undefined && (
          <p className="muted" style={{ marginTop: 10 }}>
            Used {details.used} of {details.limit} {resourceLabel[details.resource] ?? details.resource}.
          </p>
        )}
      </Modal>

      <Modal
        open={Boolean(credits)}
        onClose={() => setCredits(null)}
        title="Not enough WhatsApp credits"
        icon="whatsapp"
        size="sm"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setCredits(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setCredits(null)
                navigate('/whatsapp-credit')
              }}
            >
              <i className="bi bi-lightning-charge-fill" /> Top up credits
            </button>
          </>
        }
      >
        <p className="confirm-message">
          This message needs <strong>{creditDetails.needed ?? 1}</strong> credit{creditDetails.needed === 1 ? '' : 's'} and you have{' '}
          <strong>{creditDetails.balance ?? 0}</strong>. Top up to continue sending.
        </p>
      </Modal>
    </>
  )
}
