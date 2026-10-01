import type { QueryClient } from '@tanstack/react-query'
import type { MeDto, SendResultDto } from '@weddyzone/shared'
import { toast } from 'sonner'
import { ME_KEY } from '../auth/AuthProvider'

/**
 * Runs a "send on WhatsApp" API call and opens the returned wa.me link.
 * The tab is opened synchronously (inside the click) so popup blockers allow it,
 * then pointed at WhatsApp once the API has logged the message and charged the credit.
 */
export async function sendViaWhatsApp(
  run: () => Promise<SendResultDto>,
  qc: QueryClient,
  successMessage: string,
): Promise<SendResultDto> {
  const win = typeof window !== 'undefined' ? window.open('', '_blank') : null
  try {
    const result = await run()
    if (win) {
      win.opener = null
      win.location.href = result.waLink
    }
    syncCredits(qc, result.creditBalance)
    toast.success(successMessage, {
      description: `1 credit used · ${result.creditBalance.toLocaleString('en-IN')} left`,
      action: win ? undefined : { label: 'Open WhatsApp', onClick: () => window.open(result.waLink, '_blank', 'noopener') },
    })
    qc.invalidateQueries({ queryKey: ['whatsapp-messages'] })
    return result
  } catch (e) {
    win?.close()
    throw e
  }
}

/** Updates the credit chip in the top bar without refetching /auth/me. */
export function syncCredits(qc: QueryClient, creditBalance: number) {
  qc.setQueryData<MeDto>(ME_KEY, (me) => (me?.studio ? { ...me, studio: { ...me.studio, creditBalance } } : me))
}

export function publicLink(kind: 'selection' | 'album', token: string) {
  return `${window.location.origin}/${kind === 'selection' ? 's' : 'a'}/${token}`
}

export async function copyText(text: string, what = 'Link') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
    return true
  } catch {
    toast.error('Could not copy — select the link and copy it manually')
    return false
  }
}
