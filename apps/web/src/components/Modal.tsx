import * as Dialog from '@radix-ui/react-dialog'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Spinner } from './ui'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  icon?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Prevent closing (Esc / outside click) while something is saving. */
  busy?: boolean
}

/** Studio-styled dialog (Radix handles focus trap, Esc and aria). */
export function Modal({ open, onClose, title, subtitle, icon, children, footer, size = 'md', busy }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="wz-modal-overlay">
          <Dialog.Content
          className={`wz-modal wz-modal-${size}`}
          onPointerDownOutside={(e) => busy && e.preventDefault()}
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
          aria-describedby={subtitle ? undefined : undefined}
        >
          <header className="wz-modal-head">
            <div className="wz-modal-titles">
              {icon && (
                <span className="stat-icon tone-wine wz-modal-icon">
                  <i className={`bi bi-${icon}`} />
                </span>
              )}
              <div>
                <Dialog.Title className="wz-modal-title">{title}</Dialog.Title>
                {subtitle ? (
                  <Dialog.Description className="wz-modal-subtitle">{subtitle}</Dialog.Description>
                ) : (
                  <Dialog.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</Dialog.Description>
                )}
              </div>
            </div>
            <Dialog.Close asChild>
              <button className="icon-btn" aria-label="Close" disabled={busy}>
                <i className="bi bi-x-lg" />
              </button>
            </Dialog.Close>
          </header>
          <div className="wz-modal-body">{children}</div>
          {footer && <footer className="wz-modal-foot">{footer}</footer>}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ---------------------------------------------------------------------------
// Confirm dialogs: `const confirm = useConfirm(); if (await confirm({...})) …`

export interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  icon?: string
  /** Runs while the dialog shows a spinner; the dialog closes when it resolves. Throwing keeps it open. */
  onConfirm?: () => Promise<unknown>
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>
const ConfirmContext = createContext<ConfirmFn | null>(null)

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext)
  if (!fn) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return fn
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const [busy, setBusy] = useState(false)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const close = (result: boolean) => {
    resolver.current?.(result)
    resolver.current = null
    setOpts(null)
    setBusy(false)
  }

  const onConfirm = async () => {
    if (!opts?.onConfirm) return close(true)
    setBusy(true)
    try {
      await opts.onConfirm()
      close(true)
    } catch {
      // The action reported its own error (toast); keep the dialog open so the user can retry or cancel.
      setBusy(false)
    }
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={Boolean(opts)}
        onClose={() => close(false)}
        title={opts?.title ?? ''}
        icon={opts?.icon ?? (opts?.tone === 'danger' ? 'exclamation-triangle' : 'question-circle')}
        size="sm"
        busy={busy}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => close(false)} disabled={busy}>
              {opts?.cancelLabel ?? 'Cancel'}
            </button>
            <button
              className={`btn ${opts?.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
              onClick={onConfirm}
              disabled={busy}
              data-testid="confirm-ok"
              autoFocus
            >
              {busy && <Spinner size={14} />}
              {opts?.confirmLabel ?? 'Confirm'}
            </button>
          </>
        }
      >
        <div className="confirm-message">{opts?.message}</div>
      </Modal>
    </ConfirmContext.Provider>
  )
}
