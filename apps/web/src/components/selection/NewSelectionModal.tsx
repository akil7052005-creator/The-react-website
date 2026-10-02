import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createSelectionSchema, todayIST, type EventDto, type SelectionDto, type SendResultDto } from '@weddyzone/shared'
import { useState } from 'react'
import { useFieldArray } from 'react-hook-form'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { toastError } from '../../lib/query'
import { copyText, publicLink, sendViaWhatsApp } from '../../lib/whatsapp'
import { EventModal } from '../EventModal'
import { EventSelectField } from '../EventSelect'
import { applyApiErrors, SubmitButton, TextField, useGuardedClose, useZodForm } from '../form/form'
import { Modal, useConfirm } from '../Modal'
import { PhotoUploader } from '../PhotoUploader'

function inDays(n: number) {
  const d = new Date(`${todayIST()}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function NewSelectionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [created, setCreated] = useState<SelectionDto | null>(null)
  const [uploaded, setUploaded] = useState(0)
  // Creating the project's event right here, so a new client can be set up in one go.
  const [newEventOpen, setNewEventOpen] = useState(false)
  const [newEvent, setNewEvent] = useState<EventDto | null>(null)
  const form = useZodForm(createSelectionSchema, {
    defaultValues: { eventId: '', quota: 100, deadline: inDays(14), members: [] },
  })
  const members = useFieldArray({ control: form.control, name: 'members' })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['selections'] })
    qc.invalidateQueries({ queryKey: ['selections-summary'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const create = useMutation({
    mutationFn: (body: object) => api.post<SelectionDto>('/selections', body),
    onSuccess: (s) => {
      toast.success(`Selection ${s.code} created — now add the photos`)
      setCreated(s)
      refresh()
    },
    onError: (e) => applyApiErrors(form, e),
  })

  const reset = () => {
    setCreated(null)
    setUploaded(0)
    setNewEvent(null)
    form.reset()
    onClose()
  }
  const guardedClose = useGuardedClose(!created && form.formState.isDirty, reset)

  const sendInvite = () =>
    confirm({
      title: 'Send the selection link?',
      message: (
        <>
          We'll open WhatsApp with a personalised message and the private link for <strong>{created!.client.name}</strong>. This uses <strong>1 credit</strong>.
        </>
      ),
      confirmLabel: 'Send on WhatsApp',
      icon: 'whatsapp',
      onConfirm: () =>
        sendViaWhatsApp(() => api.post<SendResultDto>(`/selections/${created!.id}/send`), qc, `Selection ${created!.code} sent to ${created!.client.name}`)
          .then(() => {
            refresh()
            reset()
          })
          .catch((e) => {
            toastError(e)
            throw e
          }),
    })

  const copyLink = async () => {
    try {
      await api.post(`/selections/${created!.id}/mark-shared`)
      await copyText(publicLink('selection', created!.publicToken), 'Selection link')
      refresh()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <>
    <Modal
      open={open}
      onClose={created ? reset : guardedClose}
      title={created ? `Add photos to ${created.code}` : 'New Selection'}
      subtitle={created ? `${created.event.title} · quota ${created.quota} photos` : 'Share a private gallery where the couple picks their favourites'}
      icon={created ? 'cloud-arrow-up' : 'images'}
      size="lg"
      busy={create.isPending}
      footer={
        created ? (
          <>
            <button className="btn btn-ghost" onClick={reset}>
              {uploaded ? 'Done' : 'Skip for now'}
            </button>
            <button className="btn btn-ghost" onClick={copyLink} disabled={!uploaded}>
              <i className="bi bi-link-45deg" /> Copy link
            </button>
            <button className="btn btn-primary" onClick={sendInvite} disabled={!uploaded}>
              <i className="bi bi-whatsapp" /> Send to client
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={guardedClose} disabled={create.isPending}>
              Cancel
            </button>
            <SubmitButton busy={create.isPending} form="selection-form" icon="arrow-right">
              Create & add photos
            </SubmitButton>
          </>
        )
      }
    >
      {created ? (
        <PhotoUploader
          endpoint={`/selections/${created.id}/photos`}
          onUploaded={() => {
            setUploaded((n) => n + 1)
            qc.invalidateQueries({ queryKey: ['selections'] })
          }}
        />
      ) : (
        <form id="selection-form" onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate data-testid="selection-form">
          <div className="form-grid">
            <EventSelectField
              key={newEvent?.id ?? 'pick'}
              form={form}
              name="eventId"
              full
              initial={newEvent ? { id: newEvent.id, code: newEvent.code, title: newEvent.title, type: newEvent.type } : null}
              onCreateNew={() => setNewEventOpen(true)}
            />
            <TextField form={form} name="quota" label="Selection quota (photos)" type="number" required min={1} inputMode="numeric" hint="The couple can pick up to this many photos" />
            <TextField form={form} name="deadline" label="Deadline" type="date" required min={todayIST()} />
          </div>

          <div className="members-block">
            <div className="row-between" style={{ alignItems: 'center' }}>
              <div>
                <strong>Family members</strong>
                <p className="muted">Each member gets their own hearts. Leave empty to use the client's name.</p>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => members.append({ name: '', phone: '' })}
                disabled={members.fields.length >= 10}
              >
                <i className="bi bi-person-plus" /> Add member
              </button>
            </div>
            {members.fields.map((m, i) => (
              <div className="member-row" key={m.id}>
                <TextField form={form} name={`members.${i}.name`} label={`Member ${i + 1} name`} required placeholder="Bride, Groom, Mom…" maxLength={60} />
                <TextField form={form} name={`members.${i}.phone`} label="Mobile (optional)" type="tel" placeholder="98400 12345" />
                <button type="button" className="icon-btn" aria-label={`Remove member ${i + 1}`} onClick={() => members.remove(i)}>
                  <i className="bi bi-trash" />
                </button>
              </div>
            ))}
          </div>
        </form>
      )}
    </Modal>
    <EventModal
      open={newEventOpen}
      onClose={() => setNewEventOpen(false)}
      onCreated={(e) => {
        setNewEvent(e)
        form.setValue('eventId', e.id, { shouldDirty: true, shouldValidate: true })
      }}
    />
    </>
  )
}
