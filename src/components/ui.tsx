import { Component, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ProjectStatus } from '../types'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BranchNodeIcon,
  CheckIcon,
  ClockAlertIcon,
  CloseIcon,
  MinusIcon,
  MoreHorizontalIcon,
} from './icons'

export interface NoticeAction {
  label: string
  onClick: () => void
}

export interface NoticeConfig {
  message: string
  error?: boolean
  durationMs?: number
  action?: NoticeAction
}

export interface ActionOptions {
  key?: string
  invalidate?: readonly string[]
  keepNotice?: boolean
}

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; message: string }
export type ActionRunner = <T = unknown>(
  action: () => Promise<T>,
  success?: string | ((data: T) => NoticeConfig | string | null),
  options?: ActionOptions,
) => Promise<ActionResult<T>>

export function errorMessage(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : String(error)
}

export function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: unknown | null }> {
  state: { error: unknown | null } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  render() {
    if (this.state.error !== null) {
      return <div className="fatal-shell" role="alert">
        <section className="fatal-card card">
          <div className="brand-block"><span className="brand-mark" aria-hidden="true"><BranchNodeIcon size={15} /></span><span className="brand-name">BranchTrace</span></div>
          <h1>Something went wrong</h1>
          <p className="fatal-message">{errorMessage(this.state.error)}</p>
          <p className="muted">Your local database file is not affected by this rendering error.</p>
          <div className="dialog-actions"><button type="button" className="primary-button" onClick={() => window.location.reload()}>Reload Interface</button></div>
        </section>
      </div>
    }
    return this.props.children
  }
}

export interface MenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  separator?: boolean
}

export function ActionMenu({
  label,
  items,
  disabled = false,
  active = false,
  contextAnchor = null,
  onContextClose,
}: {
  label: string
  items: MenuItem[]
  disabled?: boolean
  active?: boolean
  contextAnchor?: { x: number; y: number } | null
  onContextClose?: () => void
}) {
  const [triggerOpen, setTriggerOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const firstFocus = useRef<'first' | 'last'>('first')
  const hasFocused = useRef(false)
  const id = useId()
  const open = triggerOpen || Boolean(contextAnchor)

  useEffect(() => {
    if (disabled) {
      setTriggerOpen(false)
      onContextClose?.()
    }
  }, [disabled, onContextClose])

  useEffect(() => {
    if (contextAnchor) {
      firstFocus.current = 'first'
      setTriggerOpen(false)
      setPosition(null)
    }
  }, [contextAnchor])

  useLayoutEffect(() => {
    if (!open || !menu.current) return
    hasFocused.current = false
    const reposition = (event?: Event) => {
      if (event?.target instanceof Node && menu.current?.contains(event.target)) return
      if (!menu.current) return
      const bounds = menu.current.getBoundingClientRect()
      if (contextAnchor) {
        const top = contextAnchor.y + bounds.height <= window.innerHeight - 8
          ? contextAnchor.y
          : Math.max(8, contextAnchor.y - bounds.height)
        const left = contextAnchor.x + bounds.width <= window.innerWidth - 8
          ? contextAnchor.x
          : Math.max(8, window.innerWidth - bounds.width - 8)
        setPosition((previous) => previous?.top === top && previous.left === left ? previous : { top, left })
        return
      }
      if (!trigger.current) return
      const anchor = trigger.current.getBoundingClientRect()
      if (anchor.bottom < 0 || anchor.top > window.innerHeight || anchor.right < 0 || anchor.left > window.innerWidth) {
        setTriggerOpen(false)
        return
      }
      const top = anchor.bottom + bounds.height + 6 <= window.innerHeight - 8
        ? anchor.bottom + 6
        : Math.max(8, anchor.top - bounds.height - 6)
      const left = Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8))
      setPosition((previous) => previous?.top === top && previous.left === left ? previous : { top, left })
    }
    reposition()

    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && (contextAnchor || !trigger.current?.contains(target))) {
        setTriggerOpen(false)
        onContextClose?.()
      }
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, contextAnchor, onContextClose])

  useLayoutEffect(() => {
    if (!open || !position || hasFocused.current) return
    hasFocused.current = true
    const buttons = menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    if (buttons) buttons[firstFocus.current === 'last' ? buttons.length - 1 : 0]?.focus({ preventScroll: true })
  }, [open, position])

  const close = (restoreTriggerFocus = true) => {
    const wasContext = Boolean(contextAnchor)
    setTriggerOpen(false)
    onContextClose?.()
    if (restoreTriggerFocus && !wasContext) {
      trigger.current?.focus({ preventScroll: true })
    }
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
      onClick={() => {
        firstFocus.current = 'first'
        setPosition(null)
        if (contextAnchor) {
          onContextClose?.()
          setTriggerOpen(true)
        } else {
          setTriggerOpen(!triggerOpen)
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          firstFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'
          setPosition(null)
          onContextClose?.()
          setTriggerOpen(true)
        }
      }}
    ><MoreHorizontalIcon size={16} /></button>
    {open && createPortal(<div
      ref={menu}
      id={`${id}-menu`}
      className="action-menu"
      role="menu"
      aria-labelledby={id}
      style={{ top: position?.top ?? 0, left: position?.left ?? 0, visibility: position ? 'visible' : 'hidden' }}
      onContextMenu={(event) => event.preventDefault()}
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
          close(true)
        } else if (event.key === 'Tab') close(true)
      }}
    >{items.map((item) => <button
      key={item.label}
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={item.disabled}
      className={`${item.danger ? 'danger-text' : ''} ${item.separator ? 'menu-separator' : ''}`}
      onClick={() => { close(false); item.onSelect() }}
    >{item.label}</button>)}</div>, document.body)}
  </>
}

const focusableSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
const modalStack: HTMLElement[] = []

export function Modal({ title, description, children, onClose, busy = false, className = '' }: { title: string; description?: ReactNode; children: ReactNode; onClose: () => void; busy?: boolean; className?: string }) {
  const dialog = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  const id = useId()
  closeRef.current = onClose
  busyRef.current = busy

  useLayoutEffect(() => {
    const currentDialog = dialog.current
    if (currentDialog) modalStack.push(currentDialog)
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = document.getElementById('root')
    const wasInert = root?.hasAttribute('inert')
    const previousOverflow = document.body.style.overflow
    root?.setAttribute('inert', '')
    document.body.style.overflow = 'hidden'
    const initialFocus = currentDialog?.querySelector<HTMLElement>('[data-autofocus]') ?? currentDialog
    initialFocus?.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (currentDialog && modalStack[modalStack.length - 1] !== currentDialog) return
      if (event.key === 'Escape') {
        if (document.querySelector('[role="menu"]')) return
        event.preventDefault()
        event.stopPropagation()
        if (!busyRef.current) closeRef.current()
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(currentDialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter((element) => element.getClientRects().length > 0)
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (!first) {
        event.preventDefault()
        currentDialog?.focus()
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === currentDialog)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !currentDialog?.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      const stackIndex = currentDialog ? modalStack.lastIndexOf(currentDialog) : -1
      if (stackIndex >= 0) modalStack.splice(stackIndex, 1)
      document.removeEventListener('keydown', onKeyDown, true)
      if (!wasInert) root?.removeAttribute('inert')
      document.body.style.overflow = previousOverflow
      const restoreFocus = () => {
        const topModal = modalStack[modalStack.length - 1]
        if (topModal) {
          const target = previousFocus?.isConnected && !previousFocus.matches(':disabled') && topModal.contains(previousFocus)
            ? previousFocus
            : topModal
          target.focus({ preventScroll: true })
          return true
        }
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
      <div className="modal-heading"><h2 id={`${id}-title`}>{title}</h2><button type="button" className="icon-button modal-close" onClick={onClose} disabled={busy} aria-label="Close dialog"><CloseIcon size={15} /></button></div>
      {description && <div id={`${id}-description`} className="modal-description">{description}</div>}
      {children}
    </section>
  </div>, document.body)
}

export function useDialogSubmit(onClose: () => void) {
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

export function FormDialog({ title, label, initialValue, kind = 'text', options = [], min, max, description, submitLabel = 'Save', onSubmit, onClose }: {
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
      <div className="dialog-actions"><button type="button" className="secondary-button" disabled={submitting} onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={submitting || (kind !== 'select' && !value.trim())}>{submitting ? 'Saving…' : submitLabel}</button></div>
    </form>
  </Modal>
}

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose, disabled = false, children }: { title: string; description: ReactNode; confirmLabel: string; onConfirm: () => Promise<ActionResult>; onClose: () => void; disabled?: boolean; children?: ReactNode }) {
  const { submitting, error, submit } = useDialogSubmit(onClose)
  return <Modal title={title} description={description} onClose={onClose} busy={submitting}>
    <form onSubmit={(event) => { event.preventDefault(); if (!disabled) void submit(onConfirm) }}>
      {children}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary-button" data-autofocus disabled={submitting} onClick={onClose}>Cancel</button><button type="submit" className="danger-button" disabled={submitting || disabled}>{submitting ? 'Working…' : confirmLabel}</button></div>
    </form>
  </Modal>
}

export function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
  return <div className="load-error" role="alert"><span>{errorMessage(error)}</span><button type="button" className="text-button" onClick={retry}>Retry</button></div>
}

export function EmptyState({
  title,
  description,
  action,
  children,
}: {
  title?: string
  description?: string
  action?: ReactNode
  children?: ReactNode
}) {
  return <div className="empty-state">
    {title && <p className="empty-state-title">{title}</p>}
    {description && <p className="empty-state-desc">{description}</p>}
    {children}
    {action && <div className="empty-state-action">{action}</div>}
  </div>
}

export type BadgeTone = 'neutral' | 'primary' | 'completed' | 'progress' | 'overdue' | 'canceled' | 'danger'

export function Badge({
  tone = 'neutral',
  title,
  className = '',
  children,
}: {
  tone?: BadgeTone
  title?: string
  className?: string
  children: ReactNode
}) {
  return <span className={`ui-badge tone-${tone} ${className}`.trim()} title={title}>{children}</span>
}

export function StatusIcon({
  status,
  overdue = false,
  readOnly = false,
  size = 'md',
  label,
}: {
  status: ProjectStatus
  overdue?: boolean
  readOnly?: boolean
  size?: 'sm' | 'md'
  label?: string
}) {
  const iconSize = size === 'sm' ? 9 : 10
  if (overdue && status === 'active') {
    return <span
      className={`status-icon status-overdue ${size === 'sm' ? 'sm' : ''}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
    >
      <ClockAlertIcon size={size === 'sm' ? 14 : 15} strokeWidth={1.85} />
    </span>
  }
  return <span
    className={`status-icon status-${status} ${readOnly ? 'is-readonly' : ''} ${size === 'sm' ? 'sm' : ''}`}
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
    title={label}
  >
    {status === 'completed' && <CheckIcon size={iconSize} strokeWidth={2.4} />}
    {status === 'canceled' && <MinusIcon size={iconSize} strokeWidth={2.3} />}
  </span>
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string; icon?: ReactNode; title?: string }[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return <div className="segmented" role="group" aria-label={label}>
    {options.map((option) => <button
      key={option.value}
      type="button"
      aria-pressed={value === option.value}
      disabled={disabled}
      title={option.title}
      onClick={() => onChange(option.value)}
    >
      {option.icon}
      <span>{option.label}</span>
    </button>)}
  </div>
}

export function DateNavigator({
  onPrev,
  onToday,
  onNext,
  todayLabel,
  isCurrent,
  prevLabel,
  nextLabel,
  disabled = false,
}: {
  onPrev: () => void
  onToday: () => void
  onNext: () => void
  todayLabel: string
  isCurrent: boolean
  prevLabel: string
  nextLabel: string
  disabled?: boolean
}) {
  return <div className="date-navigator" role="group" aria-label="Date navigation">
    <button type="button" disabled={disabled} onClick={onPrev} aria-label={prevLabel} title={`${prevLabel} (←)`}><ArrowLeftIcon size={15} /></button>
    <button type="button" className={isCurrent ? 'is-current' : ''} disabled={disabled} onClick={onToday} title={`Jump to ${todayLabel.toLowerCase()} (T)`}>{todayLabel}</button>
    <button type="button" disabled={disabled} onClick={onNext} aria-label={nextLabel} title={`${nextLabel} (→)`}><ArrowRightIcon size={15} /></button>
  </div>
}

export function SidePanel({
  title,
  badge,
  headerActions,
  ariaLabel,
  overlay = false,
  onClose,
  children,
}: {
  title: string
  badge?: ReactNode
  headerActions?: ReactNode
  ariaLabel?: string
  overlay?: boolean
  onClose: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector('[role="dialog"]') || document.querySelector('[role="menu"]')) return
      if (isEditableElement(event.target)) return
      const panels = document.querySelectorAll('.side-panel')
      if (panels.length > 0 && panels[panels.length - 1] !== panelRef.current) return
      event.preventDefault()
      closeRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return <>
    <div className={`side-panel-backdrop ${overlay ? 'is-overlay' : ''}`} onClick={onClose} aria-hidden="true" />
    <aside ref={panelRef} className={`side-panel ${overlay ? 'is-overlay' : ''}`} role="complementary" aria-label={ariaLabel ?? title}>
      <header className="side-panel-header">
        <div className="side-panel-heading">
          <h2 title={title}>{title}</h2>
          {badge}
        </div>
        <div className="side-panel-header-actions">
          {headerActions}
          <button type="button" className="icon-button" onClick={onClose} aria-label={`Close ${title}`} title="Close (Esc)">
            <CloseIcon size={15} />
          </button>
        </div>
      </header>
      <div className="side-panel-body">
        {children}
      </div>
    </aside>
  </>
}
