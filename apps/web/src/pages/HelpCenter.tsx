import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FaqDto } from '@weddyzone/shared'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader, Card, EmptyState, ErrorState, FeatureTooltip, Skeleton } from '../components/ui'
import { featureInfo } from '../data/featureInfo'
import { useDebouncedUrlSearch, useUrlState } from '../hooks/useUrlState'
import { api } from '../lib/api'
import { features } from '../lib/env'
import { toastError } from '../lib/query'

const allTopics = [
  {
    icon: 'rocket-takeoff',
    title: 'Getting started',
    text: 'Set up your studio in 10 minutes',
    summary: 'Set up your studio profile, website design, and upload your first wedding event.',
    category: 'Getting started',
  },
  {
    icon: 'images',
    title: 'Selections & albums',
    text: 'Share, select and deliver',
    summary: 'Master the client selection proofing workflow, flipbook albums, and Lightroom filename exports.',
    category: 'Selections & albums',
  },
  {
    icon: 'person-bounding-box',
    title: 'Face recognition',
    text: 'Guest links, QR codes, privacy',
    summary: 'Learn how to generate printable table stands, configure watermark overlays, and batch index wedding attendee faces.',
    category: 'Face recognition',
    flag: 'faceRecognition' as const,
  },
  {
    icon: 'receipt',
    title: 'Billing & GST',
    text: 'Invoices, payments, refunds',
    summary: 'Generate GST-compliant tax invoices (SAC 9983), track advance deposits, and record UPI, cash and bank payments.',
    category: 'Billing & GST',
  },
]
const topics = allTopics.filter((t) => !t.flag || features[t.flag])

function FaqItem({ faq }: { faq: FaqDto }) {
  const qc = useQueryClient()
  const vote = useMutation({
    mutationFn: (helpful: boolean) => api.post(`/faqs/${faq.id}/feedback`, { helpful }),
    onSuccess: (_d, helpful) => {
      qc.setQueriesData<FaqDto[]>({ queryKey: ['faqs'] }, (list) => list?.map((f) => (f.id === faq.id ? { ...f, myVote: helpful } : f)))
      toast.success(helpful ? 'Thanks — glad it helped!' : 'Thanks — we’ll improve this answer.', { id: `faq-${faq.id}` })
    },
    onError: (e) => toastError(e),
  })
  return (
    <details>
      <summary>{faq.question}</summary>
      <p>{faq.answer}</p>
      <div className="faq-vote">
        <span className="muted">Was this helpful?</span>
        <button className={`chip${faq.myVote === true ? ' on' : ''}`} onClick={() => vote.mutate(true)} disabled={vote.isPending} aria-pressed={faq.myVote === true}>
          <i className="bi bi-hand-thumbs-up" /> Yes
        </button>
        <button className={`chip${faq.myVote === false ? ' on' : ''}`} onClick={() => vote.mutate(false)} disabled={vote.isPending} aria-pressed={faq.myVote === false}>
          <i className="bi bi-hand-thumbs-down" /> No
        </button>
      </div>
    </details>
  )
}

function HelpCenter() {
  const [url, setUrl] = useUrlState({ q: '', category: '' })
  const [query, setQuery] = useDebouncedUrlSearch(url.q, (v) => setUrl({ q: v }))
  const faqs = useQuery({
    queryKey: ['faqs', { search: url.q, category: url.category }],
    queryFn: () => api.get<FaqDto[]>('/faqs', { search: url.q, category: url.category }),
    placeholderData: (p) => p,
  })
  const list = faqs.data ?? []
  const categories = [...new Set(list.map((f) => f.category))]

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Account & Support"
        featureBadge="Knowledge Base"
        title="Studio Help Center"
        subtitle="Answers and guides for running your wedding photography studio on Wedmanage."
      />

      {/* Feature Capabilities Ribbon */}

      <label className="search" style={{ maxWidth: 560, height: 50 }}>
        <i className="bi bi-search" />
        <input
          type="search"
          placeholder="Search help articles, guides, presets… (e.g. Lightroom, QR code)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search help articles"
        />
      </label>

      <div className="grid grid-4">
        {topics.map((t) => (
          <FeatureTooltip key={t.title} title={t.title} summary={t.summary} position="top" width={270}>
            <a
              href="#faq"
              className={`topic${url.category === t.category ? ' is-active' : ''}`}
              style={{ height: '100%' }}
              onClick={() => setUrl({ category: url.category === t.category ? '' : t.category })}
              aria-pressed={url.category === t.category}
            >
              <span className="stat-icon tone-gold">
                <i className={`bi bi-${t.icon}`} />
              </span>
              <div>
                <strong>{t.title}</strong>
                <p>{t.text}</p>
                <span className="action-hover-hint" style={{ marginTop: 6 }}>
                  Point cursor for overview
                </span>
              </div>
            </a>
          </FeatureTooltip>
        ))}
      </div>

      <Card
        title="Frequently Asked Questions"
        subtitle={url.category ? `Showing: ${url.category}` : 'Click any question to view the detailed guide'}
        className="faq"
        feature={featureInfo.help}
        action={
          url.category ? (
            <button className="link" onClick={() => setUrl({ category: '' })}>
              Show all <i className="bi bi-x" />
            </button>
          ) : undefined
        }
      >
        <div id="faq">
          {faqs.isPending ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={20} style={{ margin: '16px 0' }} />)
          ) : faqs.isError ? (
            <ErrorState error={faqs.error} onRetry={() => faqs.refetch()} />
          ) : list.length > 0 ? (
            categories.map((c) => (
              <div key={c} className="faq-group">
                {!url.category && <p className="faq-category">{c}</p>}
                {list
                  .filter((f) => f.category === c)
                  .map((f) => (
                    <FaqItem key={f.id} faq={f} />
                  ))}
              </div>
            ))
          ) : (
            <EmptyState
              icon="search"
              title="No matching answers"
              text="Try different keywords, or connect directly with our studio support team."
              action={
                <Link to="/support?new=1" className="btn btn-primary">
                  Raise a ticket
                </Link>
              }
            />
          )}
        </div>
      </Card>
    </div>
  )
}

export default HelpCenter
