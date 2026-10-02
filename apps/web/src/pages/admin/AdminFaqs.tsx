import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FAQ_CATEGORIES, faqSchema, type AdminFaqDto, type FaqInput } from '@weddyzone/shared'
import { toast } from 'sonner'
import { applyApiErrors, FieldShell, SubmitButton, TextAreaField, TextField, useGuardedClose, useZodForm } from '../../components/form/form'
import { Modal, useConfirm } from '../../components/Modal'
import { Card, CardSkeleton, EmptyState, ErrorState, PageHeader, StatusPill } from '../../components/ui'
import { useUrlState } from '../../hooks/useUrlState'
import { api } from '../../lib/api'
import { toastError } from '../../lib/query'
import { formatDate } from '../../utils/format'

const FAQS_KEY = ['admin', 'faqs'] as const

function FaqForm({ faq, onClose }: { faq: AdminFaqDto | null; onClose: () => void }) {
  const qc = useQueryClient()
  const form = useZodForm(faqSchema, {
    defaultValues: faq
      ? { category: faq.category as FaqInput['category'], question: faq.question, answer: faq.answer, position: faq.position, isPublished: faq.isPublished }
      : { category: FAQ_CATEGORIES[0], question: '', answer: '', position: 0, isPublished: true },
  })
  const save = useMutation({
    mutationFn: (body: object) => (faq ? api.patch(`/admin/faqs/${faq.id}`, body) : api.post('/admin/faqs', body)),
    onSuccess: async () => {
      toast.success(faq ? 'FAQ updated' : 'FAQ added')
      await qc.invalidateQueries({ queryKey: FAQS_KEY })
      // Studios see the change in their Help Center straight away.
      await qc.invalidateQueries({ queryKey: ['faqs'] })
      onClose()
    },
    onError: (e) => applyApiErrors(form, e),
  })
  const close = useGuardedClose(form.formState.isDirty, onClose)
  const categoryError = form.formState.errors.category?.message

  return (
    <Modal
      open
      onClose={close}
      title={faq ? 'Edit FAQ' : 'Add an FAQ'}
      subtitle="Shown to every studio in the Help Center"
      icon="question-circle"
      busy={save.isPending}
      footer={
        <>
          <button className="btn btn-ghost" onClick={close} disabled={save.isPending}>
            Cancel
          </button>
          <SubmitButton busy={save.isPending} form="faq-form" icon="check2">
            {faq ? 'Save changes' : 'Add FAQ'}
          </SubmitButton>
        </>
      }
    >
      <form id="faq-form" className="form-grid" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <FieldShell label="Category" htmlFor="f-category" required error={categoryError}>
          <select id="f-category" {...form.register('category')}>
            {FAQ_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FieldShell>
        <TextField form={form} name="position" label="Order in its category" type="number" min={0} hint="Lower numbers show first" />
        <TextField form={form} name="question" label="Question" required maxLength={200} showCounter full />
        <TextAreaField form={form} name="answer" label="Answer" required maxLength={3000} rows={6} />
        <label className="check-row full">
          <input type="checkbox" {...form.register('isPublished')} /> Published (visible to studios)
        </label>
      </form>
    </Modal>
  )
}

/** Platform admin: the Help Center's questions and answers. */
export default function AdminFaqs() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [url, setUrl] = useUrlState({ edit: '' })
  const q = useQuery({ queryKey: FAQS_KEY, queryFn: () => api.get<AdminFaqDto[]>('/admin/faqs') })
  const faqs = q.data ?? []

  const update = useMutation({
    mutationFn: (f: AdminFaqDto & { isPublished: boolean }) =>
      api.patch(`/admin/faqs/${f.id}`, { category: f.category, question: f.question, answer: f.answer, position: f.position, isPublished: f.isPublished }),
    onSuccess: async (_d, f) => {
      toast.success(f.isPublished ? 'Published' : 'Hidden from studios')
      await qc.invalidateQueries({ queryKey: FAQS_KEY })
    },
    onError: (e) => toastError(e),
  })
  const remove = useMutation({
    mutationFn: (f: AdminFaqDto) => api.delete(`/admin/faqs/${f.id}`),
    onSuccess: async () => {
      toast.success('FAQ deleted')
      await qc.invalidateQueries({ queryKey: FAQS_KEY })
    },
    onError: (e) => toastError(e),
  })
  const askDelete = async (f: AdminFaqDto) => {
    const ok = await confirm({
      title: 'Delete this FAQ?',
      message: `"${f.question}" will be removed from every studio's Help Center. This can't be undone.`,
      confirmLabel: 'Delete FAQ',
      tone: 'danger',
    })
    if (ok) remove.mutate(f)
  }

  const editing = url.edit === 'new' ? null : faqs.find((f) => f.id === url.edit)

  return (
    <div className="stack">
      <PageHeader
        title="Help Center"
        subtitle="The questions and answers every studio sees. Hidden FAQs stay here as drafts."
        actions={
          <button className="btn btn-primary" onClick={() => setUrl({ edit: 'new' })}>
            <i className="bi bi-plus-lg" /> Add FAQ
          </button>
        }
      />
      {q.isPending ? (
        <CardSkeleton rows={6} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : faqs.length === 0 ? (
        <Card>
          <EmptyState icon="question-circle" title="No FAQs yet" text="Add the first question studios ask most." />
        </Card>
      ) : (
        FAQ_CATEGORIES.filter((c) => faqs.some((f) => f.category === c)).map((category) => (
          <Card key={category} title={category} flush>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>Order</th>
                    <th>Question</th>
                    <th>Status</th>
                    <th title="Studios who answered 'Was this helpful?'">Helpful</th>
                    <th>Updated</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {faqs
                    .filter((f) => f.category === category)
                    .map((f) => (
                      <tr key={f.id}>
                        <td className="muted">{f.position}</td>
                        <td className="cell-main">{f.question}</td>
                        <td>
                          <StatusPill status={f.isPublished ? 'Published' : 'Draft'} />
                        </td>
                        <td className="muted">
                          <i className="bi bi-hand-thumbs-up" /> {f.helpfulYes} · <i className="bi bi-hand-thumbs-down" /> {f.helpfulNo}
                        </td>
                        <td className="muted">{formatDate(f.updatedAt)}</td>
                        <td>
                          <div className="row-actions">
                            <button className="btn btn-sm btn-ghost" onClick={() => setUrl({ edit: f.id })} aria-label={`Edit "${f.question}"`}>
                              <i className="bi bi-pencil" /> Edit
                            </button>
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={() => update.mutate({ ...f, isPublished: !f.isPublished })}
                              disabled={update.isPending}
                              aria-label={`${f.isPublished ? 'Hide' : 'Publish'} "${f.question}"`}
                            >
                              <i className={`bi bi-${f.isPublished ? 'eye-slash' : 'eye'}`} /> {f.isPublished ? 'Hide' : 'Publish'}
                            </button>
                            <button className="btn btn-sm btn-ghost row-danger" onClick={() => askDelete(f)} aria-label={`Delete "${f.question}"`}>
                              <i className="bi bi-trash" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}
      {(url.edit === 'new' || editing) && <FaqForm key={url.edit} faq={editing ?? null} onClose={() => setUrl({ edit: '' })} />}
    </div>
  )
}
