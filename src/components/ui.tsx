import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type ActionResult = { ok: true } | { ok: false; message: string }
export type ActionRunner = (action: () => Promise<unknown>, success?: string) => Promise<ActionResult>

export function errorMessage(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : String(error)
}

interface MenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  separator?: boolean
}

export function ActionMenu({ label, items, disabled = false, active = false }: { label: string; items: MenuItem[]; disabled?: boolean; active?: boolean }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const firstFocus = useRef<'first' | 'last'>('first')
  const hasFocused = useRef(false)
  const id = useId()

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return
    hasFocused.current = false
    const reposition = (event?: Event) => {
      if (event?.target instanceof Node && menu.current?.contains(event.target)) return
      if (!trigger.current || !menu.current) return
      const anchor = trigger.current.getBoundingClientRect()
      if (anchor.bottom < 0 || anchor.top > window.innerHeight || anchor.right < 0 || anchor.left > window.innerWidth) {
        setOpen(false)
        return
      }
      const bounds = menu.current.getBoundingClientRect()
      const top = anchor.bottom + bounds.height + 6 <= window.innerHeight - 8
        ? anchor.bottom + 6
        : Math.max(8, anchor.top - bounds.height - 6)
      const left = Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8))
      setPosition((previous) => previous?.top === top && previous.left === left ? previous : { top, left })
    }
    reposition()

    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !position || hasFocused.current) return
    hasFocused.current = true
    const buttons = menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    if (buttons) buttons[firstFocus.current === 'last' ? buttons.length - 1 : 0]?.focus({ preventScroll: true })
  }, [open, position])

  const close = () => {
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }

  return <>
    <button
      ref={trigger}
      id={id}
      type="button"
      className={`more-button ${active ? 'selected' : ''}`}
      aria-label={label}
      title={label}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? `${id}-menu` : undefined}
      disabled={disabled}
      onClick={() => { firstFocus.current = 'first'; setPosition(null); setOpen(!open) }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          firstFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'
          setPosition(null)
          setOpen(true)
        }
      }}
    ><span aria-hidden="true">⋯</span></button>
    {open && createPortal(<div
      ref={menu}
      id={`${id}-menu`}
      className="action-menu"
      role="menu"
      aria-labelledby={id}
      style={{ top: position?.top ?? 0, left: position?.left ?? 0, visibility: position ? 'visible' : 'hidden' }}
      onKeyDown={(event) => {
        const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          buttons[next]?.focus()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          close()
        } else if (event.key === 'Tab') close()
      }}
    >{items.map((item) => <button
      key={item.label}
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={item.disabled}
      className={`${item.danger ? 'danger-text' : ''} ${item.separator ? 'menu-separator' : ''}`}
      onClick={() => { close(); item.onSelect() }}
    >{item.label}</button>)}</div>, document.body)}
  </>
}

const focusableSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

export function Modal({ title, description, children, onClose, busy = false, className = '' }: { title: string; description?: ReactNode; children: ReactNode; onClose: () => void; busy?: boolean; className?: string }) {
  const dialog = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  const id = useId()
  closeRef.current = onClose
  busyRef.current = busy

  useLayoutEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = document.getElementById('root')
    const wasInert = root?.hasAttribute('inert')
    const previousOverflow = document.body.style.overflow
    root?.setAttribute('inert', '')
    document.body.style.overflow = 'hidden'
    const initialFocus = dialog.current?.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.current
    initialFocus?.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!busyRef.current) closeRef.current()
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter((element) => element.getClientRects().length > 0)
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (!first) {
        event.preventDefault()
        dialog.current?.focus()
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (!wasInert) root?.removeAttribute('inert')
      document.body.style.overflow = previousOverflow
      const restoreFocus = () => {
        if (root?.hasAttribute('inert')) return true
        const target = previousFocus?.isConnected && !previousFocus.matches(':disabled') ? previousFocus : document.querySelector<HTMLElement>('[data-focus-fallback]:not(:disabled)')
        target?.focus({ preventScroll: true })
        return Boolean(target)
      }
      // A deleted row can unmount before the action unlocks the fallback control.
      if (!restoreFocus()) window.requestAnimationFrame(restoreFocus)
    }
  }, [])

  return createPortal(<div className="modal-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onClose()
  }}>
    <section ref={dialog} className={`modal-card ${className}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} aria-busy={busy} tabIndex={-1}>
      <div className="modal-heading"><h2 id={`${id}-title`}>{title}</h2><button type="button" className="icon-button modal-close" onClick={onClose} disabled={busy} aria-label="关闭弹窗">×</button></div>
      {description && <div id={`${id}-description`} className="modal-description">{description}</div>}
      {children}
    </section>
  </div>, document.body)
}

function useDialogSubmit(onClose: () => void) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const submit = async (task: () => Promise<ActionResult>) => {
    if (lock.current) return
    lock.current = true
    setSubmitting(true)
    setError(null)
    try {
      const result = await task()
      if (result.ok) onClose()
      else setError(result.message)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      lock.current = false
      setSubmitting(false)
    }
  }
  return { submitting, error, submit }
}

export function FormDialog({ title, label, initialValue, kind = 'text', options = [], min, max, description, submitLabel = '保存', onSubmit, onClose }: {
  title: string
  label: string
  initialValue: string
  kind?: 'text' | 'date' | 'select'
  options?: { value: string; label: string }[]
  min?: string
  max?: string
  description?: ReactNode
  submitLabel?: string
  onSubmit: (value: string) => Promise<ActionResult>
  onClose: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const { submitting, error, submit } = useDialogSubmit(onClose)
  const id = useId()
  return <Modal title={title} description={description} onClose={onClose} busy={submitting}>
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); if (kind === 'select' || value.trim()) void submit(() => onSubmit(value.trim())) }}>
      <label className="field-label" htmlFor={id}>{label}</label>
      {kind === 'select'
        ? <select id={id} className="form-input" data-autofocus value={value} onChange={(event) => setValue(event.target.value)} disabled={submitting}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : <input id={id} className="form-input" data-autofocus type={kind} required value={value} min={min} max={max} disabled={submitting} onChange={(event) => setValue(event.target.value)} onFocus={(event) => { if (kind === 'text') event.currentTarget.select() }} />}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary-button" disabled={submitting} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={submitting || (kind !== 'select' && !value.trim())}>{submitting ? '保存中…' : submitLabel}</button></div>
    </form>
  </Modal>
}

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose, disabled = false, children }: { title: string; description: ReactNode; confirmLabel: string; onConfirm: () => Promise<ActionResult>; onClose: () => void; disabled?: boolean; children?: ReactNode }) {
  const { submitting, error, submit } = useDialogSubmit(onClose)
  return <Modal title={title} description={description} onClose={onClose} busy={submitting}>
    <form onSubmit={(event) => { event.preventDefault(); if (!disabled) void submit(onConfirm) }}>
      {children}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary-button" data-autofocus disabled={submitting} onClick={onClose}>取消</button><button type="submit" className="danger-button" disabled={submitting || disabled}>{submitting ? '处理中…' : confirmLabel}</button></div>
    </form>
  </Modal>
}

export function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
  return <div className="load-error" role="alert"><span>{errorMessage(error)}</span><button type="button" className="text-button" onClick={retry}>重试</button></div>
}
