import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  changePasswordSchema,
  INDIAN_STATES,
  POPULAR_CITIES,
  profileSchema,
  stateName,
  type ProfileInput,
  type StudioDto,
} from '@weddyzone/shared'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ME_KEY, useMe } from '../auth/AuthProvider'
import {
  applyApiErrors,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
  useUnsavedChangesWarning,
  useZodForm,
} from '../components/form/form'
import { useConfirm } from '../components/Modal'
import { Avatar, Card, CardSkeleton, ErrorState, PageHeader, Spinner } from '../components/ui'
import { api, upload } from '../lib/api'
import { toastError } from '../lib/query'
import { PasswordField } from './auth/AuthLayout'

const stateOptions = INDIAN_STATES.map((s) => ({ value: s.code, label: s.name, sub: `GST code ${s.code}` }))
const cityOptions = POPULAR_CITIES.map((c) => ({ value: c, label: c }))

function toFormValues(s: StudioDto): ProfileInput {
  return {
    ownerName: s.ownerName,
    studioName: s.name,
    email: s.email ?? '',
    phone: s.phone ?? '',
    city: s.city ?? '',
    stateCode: s.stateCode ?? '',
    addressLine1: s.addressLine1 ?? '',
    addressLine2: s.addressLine2 ?? '',
    pincode: s.pincode ?? '',
    gstin: s.gstin ?? '',
    pan: s.pan ?? '',
    website: s.website ?? '',
    bio: s.bio ?? '',
  }
}

function ProfileForm({ studio }: { studio: StudioDto }) {
  const qc = useQueryClient()
  const [saved, setSaved] = useState(() => toFormValues(studio))
  const form = useZodForm(profileSchema, { defaultValues: saved, mode: 'onChange' })
  const { isDirty, isValid } = form.formState
  useUnsavedChangesWarning(isDirty)

  const save = useMutation({
    mutationFn: (body: object) => api.patch<StudioDto>('/studio/profile', body),
    onSuccess: (s) => {
      const values = toFormValues(s)
      setSaved(values)
      form.reset(values)
      qc.setQueryData(['studio-profile'], s)
      qc.invalidateQueries({ queryKey: ME_KEY })
      toast.success('Profile saved')
    },
    onError: (e) => applyApiErrors(form, e),
  })

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate data-testid="profile-form">
      <div className="form-grid">
        <TextField form={form} name="ownerName" label="Your name" required maxLength={80} />
        <TextField form={form} name="studioName" label="Studio name" required maxLength={80} />
        <TextField form={form} name="email" label="Email" type="email" required />
        <TextField form={form} name="phone" label="Phone" type="tel" required hint="10-digit Indian mobile" />
        <SelectField form={form} name="city" label="City" required kind="creatable" options={cityOptions} placeholder="Select or type a city" />
        <SelectField form={form} name="stateCode" label="State" required options={stateOptions} placeholder="Select state" hint="Decides CGST+SGST vs IGST on invoices" />
        <TextField form={form} name="gstin" label="GSTIN" placeholder="33ABCDE1234F1Z5" style={{ textTransform: 'uppercase' }} hint="Optional — must match your state" />
        <TextField form={form} name="pan" label="PAN" placeholder="ABCDE1234F" style={{ textTransform: 'uppercase' }} />
        <TextField form={form} name="addressLine1" label="Address line 1" maxLength={120} />
        <TextField form={form} name="addressLine2" label="Address line 2" maxLength={120} />
        <TextField form={form} name="pincode" label="PIN code" inputMode="numeric" placeholder="600006" />
        <TextField form={form} name="website" label="Website" placeholder="goldenhour.weddingz.com" maxLength={120} />
        <TextAreaField form={form} name="bio" label="About your studio" maxLength={500} />
      </div>
      <div className="form-foot">
        {isDirty && <span className="muted">Unsaved changes</span>}
        <button type="button" className="btn btn-ghost" disabled={!isDirty || save.isPending} onClick={() => form.reset(saved)}>
          Reset
        </button>
        <SubmitButton busy={save.isPending} disabled={!isDirty || !isValid}>
          Save changes
        </SubmitButton>
      </div>
    </form>
  )
}

function ChangePassword() {
  const form = useZodForm(changePasswordSchema, { defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' } })
  const change = useMutation({
    mutationFn: (body: object) => api.post('/auth/change-password', body),
    onSuccess: () => {
      form.reset()
      toast.success('Password changed')
    },
    onError: (e) => applyApiErrors(form, e),
  })
  return (
    <Card title="Change password" subtitle="Use at least 8 characters with a letter and a number">
      <form method="post" onSubmit={form.handleSubmit((v) => change.mutate(v))} noValidate>
        <div className="form-grid-3">
          <PasswordField form={form} name="currentPassword" label="Current password" autoComplete="current-password" />
          <PasswordField form={form} name="newPassword" label="New password" autoComplete="new-password" />
          <PasswordField form={form} name="confirmPassword" label="Confirm new password" autoComplete="new-password" />
        </div>
        <div className="form-foot">
          <SubmitButton busy={change.isPending} icon="shield-lock">
            Update password
          </SubmitButton>
        </div>
      </form>
    </Card>
  )
}

function LogoControls({ studio }: { studio: StudioDto }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return toast.error('Logo must be a JPEG, PNG or WebP image')
    if (file.size > 2 * 1024 * 1024) return toast.error('Logo must be 2 MB or smaller')
    const fd = new FormData()
    fd.append('file', file)
    setProgress(0)
    try {
      const s = await upload<StudioDto>('/studio/logo', fd, setProgress)
      qc.setQueryData(['studio-profile'], s)
      qc.invalidateQueries({ queryKey: ME_KEY })
      toast.success('Logo updated')
    } catch (e) {
      toastError(e)
    } finally {
      setProgress(null)
      if (input.current) input.current.value = ''
    }
  }

  const remove = () =>
    confirm({
      title: 'Remove logo?',
      message: 'Your invoices and galleries will show your initials instead.',
      confirmLabel: 'Remove logo',
      tone: 'danger',
      onConfirm: async () => {
        try {
          const s = await api.delete<StudioDto>('/studio/logo')
          qc.setQueryData(['studio-profile'], s)
          qc.invalidateQueries({ queryKey: ME_KEY })
          toast.success('Logo removed')
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  return (
    <div className="logo-controls">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => onFile(e.target.files?.[0])} aria-label="Upload logo" />
      <button className="btn btn-sm btn-ghost" onClick={() => input.current?.click()} disabled={progress !== null}>
        {progress !== null ? <Spinner size={12} /> : <i className="bi bi-upload" />}
        {progress !== null ? `Uploading ${progress}%` : studio.logoUrl ? 'Change logo' : 'Upload logo'}
      </button>
      {studio.logoUrl && (
        <button className="btn btn-sm btn-ghost" onClick={remove}>
          <i className="bi bi-trash" /> Remove
        </button>
      )}
    </div>
  )
}

function MyProfile() {
  const me = useMe()
  const profile = useQuery({
    queryKey: ['studio-profile'],
    queryFn: () => api.get<StudioDto>('/studio/profile'),
    initialData: me.studio,
  })
  const studio = profile.data

  return (
    <div className="stack">
      <PageHeader eyebrow="Account" title="My Profile" subtitle="How your studio appears on invoices, galleries and your website." />

      {profile.isError ? (
        <div className="card">
          <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
        </div>
      ) : !studio ? (
        <CardSkeleton rows={8} />
      ) : (
        <div className="grid grid-1-2">
          <Card className="profile-card">
            <Avatar name={studio.ownerName} size={88} src={studio.logoUrl} />
            <h3>{studio.ownerName}</h3>
            <p className="muted">{studio.name}</p>
            <p style={{ marginTop: 10 }}>
              <span className="pill pill-warning">{studio.plan.name} plan</span>
            </p>
            <LogoControls studio={studio} />
            <ul className="info-list">
              <li>
                <i className="bi bi-envelope" />
                {studio.email || '—'}
              </li>
              <li>
                <i className="bi bi-telephone" />
                {studio.phone || '—'}
              </li>
              <li>
                <i className="bi bi-geo-alt" />
                {[studio.city, stateName(studio.stateCode)].filter(Boolean).join(', ') || '—'}
              </li>
              <li>
                <i className="bi bi-globe2" />
                {studio.website || '—'}
              </li>
            </ul>
          </Card>

          <Card title="Studio details">
            <ProfileForm key={studio.id} studio={studio} />
          </Card>
        </div>
      )}

      <ChangePassword />
    </div>
  )
}

export default MyProfile
