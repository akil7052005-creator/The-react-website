import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface RowMenuItem {
  label: string
  icon: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
}

const MENU_W = 200
const ITEM_H = 40

/** Under the button (or above it when there's no room below), kept on screen. Null when the button is off screen. */
function placeMenu(button: HTMLElement, itemCount: number): { top: number; left: number } | null {
  const r = button.getBoundingClientRect()
  if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return null
  const h = itemCount * ITEM_H + 12
  const below = r.bottom + 4 + h <= window.innerHeight
  return {
    top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - h),
    left: Math.min(Math.max(8, r.right - MENU_W), window.innerWidth - MENU_W - 8),
  }
}

/**
 * "⋯" button with a small action menu. The menu is rendered into <body> with fixed positioning, so
 * a table's own scroll container can't clip it (and it can't widen the page). It follows its button
 * when the page or table scrolls. Esc and outside clicks close it; arrow keys move between items.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  const close = (focusButton = false) => {
    setOpen(false)
    if (focusButton) button.current?.focus()
  }

  const toggle = () => {
    if (open) return close()
    setPos(placeMenu(button.current!, items.length))
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false)
    }
    // Scrolling the page or the table (or resizing) moves the menu with its button; it closes only
    // when the button leaves the screen.
    const follow = () => {
      const next = button.current ? placeMenu(button.current, items.length) : null
      if (next) setPos(next)
      else setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', follow)
    window.addEventListener('scroll', follow, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', follow)
      window.removeEventListener('scroll', follow, true)
    }
  }, [open, items.length])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      close(true)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      buttons[(i + 1) % buttons.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      buttons[(i - 1 + buttons.length) % buttons.length]?.focus()
    }
  }

  return (
    <>
      <button ref={button} className="icon-btn row-menu-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        <i className="bi bi-three-dots" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menu}
            className="menu row-menu"
            role="menu"
            aria-label={label}
            style={{ position: 'fixed', width: MENU_W, top: pos.top, left: pos.left }}
            onKeyDown={onKeyDown}
          >
            {items.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                className={item.danger ? 'row-menu-item danger' : 'row-menu-item'}
                disabled={item.disabled}
                onClick={() => {
                  close()
                  item.onSelect()
                }}
              >
                <i className={`bi bi-${item.icon}`} aria-hidden="true" /> {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
