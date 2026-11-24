import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { STATUS_TEXT } from '../constants'
import type { DropPosition } from '../constants'
import { computeReorderedIds } from '../project-tree'
import { REMINDER_KEYS, TRASH_KEYS } from '../query-keys'
import type { ISODate, MonthDayDto, ProjectDailyItem, ReminderDailyItem } from '../types'
import {
  describeReminderCompletionTiming,
  formatFullDate,
  formatMonthDay,
  formatOverdueDuration,
  formatShortDate,
  formatWeekdayShort,
  getWeekStart,
} from '../ui-format'
import { formatProjectParentSummary } from '../weekly-summary'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ClockAlertIcon,
  CloseIcon,
  ExternalLinkIcon,
  GripIcon,
  MinusIcon,
  TrashIcon,
  TrendingUpIcon,
} from './icons'
import { ActionMenu, Badge, ConfirmDialog, FormDialog, isEditableElement, SidePanel } from './ui'
import type { ActionRunner } from './ui'

type ReminderDialog = 'schedule' | 'completedDate' | 'trash'

export function MonthReminderRow({
  item,
  today,
  overdue = false,
  inPanel = false,
  showDeleteButton = false,
  pendingKey,
  dragId = null,
  dropPosition = null,
  onJumpToDate,
  onDragStart,
  onDragEnd,
  onDragHover,
  onDragLeave,
  onReorder,
  onAction,
}: {
  item: ReminderDailyItem
  today: ISODate
  overdue?: boolean
  inPanel?: boolean
  showDeleteButton?: boolean
  pendingKey: string | null
  dragId?: string | null
  dropPosition?: DropPosition | null
  onJumpToDate?: (date: ISODate) => void
  onDragStart?: (id: string) => void
  onDragEnd?: () => void
  onDragHover?: (id: string, position: DropPosition) => void
  onDragLeave?: (id: string) => void
  onReorder?: (fromId: string, targetId: string, position: DropPosition) => Promise<void>
  onAction: ActionRunner
}) {
  const { reminder } = item
  const [dialog, setDialog] = useState<ReminderDialog | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [renameDraft, setRenameDraft] = useState(reminder.title)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [contextAnchor, setContextAnchor] = useState<{ x: number; y: number } | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editingTitle) return
    renameInputRef.current?.focus({ preventScroll: true })
    renameInputRef.current?.select()
  }, [editingTitle])

  const closeDialog = () => setDialog(null)
  const closeContext = useCallback(() => setContextAnchor(null), [])
  const rowPrefix = `reminder:${reminder.id}:`
  const rowBusy = pendingKey?.startsWith(rowPrefix) ?? false
  const renamePending = pendingKey === `${rowPrefix}rename`
  const isOverdueItem = overdue || (item.displayType === 'planned' && reminder.status === 'active' && reminder.scheduledDate < today)
  const isDragging = Boolean(onReorder && dragId === reminder.id)
  const canDropHere = Boolean(onReorder && dragId && dragId !== reminder.id && pendingKey === null)

  const startRename = () => {
    if (rowBusy) return
    setRenameDraft(reminder.title)
    setRenameError(null)
    setEditingTitle(true)
  }

  const cancelRename = () => {
    setEditingTitle(false)
    setRenameError(null)
  }

  const commitRename = async (event?: FormEvent) => {
    event?.preventDefault()
    if (renamePending) return
    const trimmed = renameDraft.trim()
    if (!trimmed) {
      setRenameError('Reminder title cannot be empty')
      renameInputRef.current?.focus({ preventScroll: true })
      return
    }
    if (trimmed === reminder.title) {
      cancelRename()
      return
    }
    setRenameError(null)
    const result = await onAction(
      () => api.renameReminder(reminder.id, trimmed, reminder.version),
      'Reminder renamed',
      { key: `${rowPrefix}rename`, invalidate: REMINDER_KEYS },
    )
    if (result.ok) setEditingTitle(false)
    else {
      setRenameError(result.message)
      renameInputRef.current?.focus({ preventScroll: true })
    }
  }

  const toggle = () => void onAction(
    () => reminder.status === 'completed'
      ? api.restoreReminder(reminder.id, reminder.version)
      : api.completeReminder(reminder.id, reminder.version),
    reminder.status === 'completed' ? 'Reminder restored' : 'Reminder completed',
    { key: `${rowPrefix}toggle`, invalidate: REMINDER_KEYS },
  )

  const menuItems = [
    { label: 'Rename', onSelect: startRename },
    { label: 'Reschedule', onSelect: () => setDialog('schedule') },
    ...(reminder.status === 'completed' ? [{ label: 'Edit Completed Date', onSelect: () => setDialog('completedDate') }] : []),
    ...(reminder.status === 'active'
      ? [{ label: 'Cancel Reminder', onSelect: () => void onAction(() => api.cancelReminder(reminder.id, reminder.version), 'Reminder canceled', { key: `${rowPrefix}status`, invalidate: REMINDER_KEYS }) }]
      : [{ label: 'Restore to Active', onSelect: () => void onAction(() => api.restoreReminder(reminder.id, reminder.version), 'Reminder restored', { key: `${rowPrefix}status`, invalidate: REMINDER_KEYS }) }]),
    { label: 'Move to Trash', separator: true, danger: true, onSelect: () => setDialog('trash') },
  ]

  const timing = describeReminderCompletionTiming(reminder)
  const timingHint = (() => {
    if (overdue) return null
    if (reminder.status === 'canceled') {
      return {
        text: reminder.canceledDate ? `Canceled ${formatMonthDay(reminder.canceledDate)}` : 'Canceled',
        title: reminder.canceledDate ? `Canceled on ${formatFullDate(reminder.canceledDate)}` : 'Canceled',
        tone: 'neutral' as const,
      }
    }
    if (!timing) return null
    if (item.displayType === 'completed') {
      return {
        text: `Planned ${formatMonthDay(reminder.scheduledDate)} · ${timing.label}`,
        title: `Planned for ${formatFullDate(reminder.scheduledDate)}, completed on ${formatFullDate(reminder.completedDate!)}`,
        tone: timing.tone,
      }
    }
    if (item.displayType === 'planned' && !item.isPlannedAndCompletedSameDay && reminder.completedDate) {
      return {
        text: `Done ${formatMonthDay(reminder.completedDate)} · ${timing.label}`,
        title: `Planned for ${formatFullDate(reminder.scheduledDate)}, completed on ${formatFullDate(reminder.completedDate)}`,
        tone: timing.tone,
      }
    }
    return {
      text: timing.label,
      title: `Completed on ${formatFullDate(reminder.completedDate!)}`,
      tone: timing.tone,
    }
  })()

  return <>
    <div
      data-month-stop
      className={`month-reminder-row ${inPanel ? 'in-panel' : 'in-overdue-bar'} ${reminder.status} ${isOverdueItem ? 'overdue' : ''} ${isDragging ? 'is-dragging' : ''} ${dropPosition ? `drop-${dropPosition}` : ''} ${rowBusy ? 'is-pending' : ''}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'F2' && !editingTitle && !isEditableElement(event.target)) {
          event.preventDefault()
          startRename()
        }
      }}
      onContextMenu={(event) => {
        if (editingTitle || rowBusy || isEditableElement(event.target)) return
        event.preventDefault()
        setContextAnchor({ x: event.clientX, y: event.clientY })
      }}
      onDragOver={(event) => {
        if (!canDropHere) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const rect = event.currentTarget.getBoundingClientRect()
        onDragHover?.(reminder.id, event.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragLeave?.(reminder.id)
      }}
      onDrop={(event) => {
        if (!canDropHere || !onReorder) return
        event.preventDefault()
        const fromId = event.dataTransfer.getData('text/branchtrace-reminder') || dragId
        const rect = event.currentTarget.getBoundingClientRect()
        const position: DropPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
        onDragEnd?.()
        if (fromId) void onReorder(fromId, reminder.id, position)
      }}
    >
      {onReorder && <button
        type="button"
        className="drag-handle modal-drag-handle"
        aria-label={`Drag to reorder ${reminder.title}`}
        title="Drag to reorder"
        draggable={pendingKey === null && !editingTitle}
        disabled={rowBusy || editingTitle}
        onDragStart={(event) => {
          event.stopPropagation()
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/branchtrace-reminder', reminder.id)
          onDragStart?.(reminder.id)
        }}
        onDragEnd={onDragEnd}
      ><GripIcon size={12} /></button>}

      <button
        type="button"
        role="checkbox"
        aria-checked={reminder.status === 'completed'}
        aria-label={`${reminder.title}, ${STATUS_TEXT[reminder.status]}`}
        className="reminder-check month-reminder-check"
        disabled={rowBusy || reminder.status === 'canceled'}
        onClick={toggle}
      >
        {reminder.status === 'completed' && <CheckIcon size={10} strokeWidth={2.5} />}
        {reminder.status === 'canceled' && <MinusIcon size={10} strokeWidth={2.3} />}
      </button>

      <div className="month-reminder-content">
        {editingTitle ? <form className="inline-rename-form compact" onSubmit={(event) => void commitRename(event)}>
          <div className="inline-rename-controls">
            <input
              ref={renameInputRef}
              className="inline-edit-input compact"
              value={renameDraft}
              readOnly={renamePending}
              aria-busy={renamePending}
              aria-label="Rename reminder"
              onChange={(event) => { setRenameDraft(event.target.value); if (renameError) setRenameError(null) }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  cancelRename()
                }
              }}
            />
            <button type="submit" className="icon-button inline-confirm-btn compact" disabled={renamePending} aria-label="Save reminder title" title="Save (Enter)" onMouseDown={(event) => event.preventDefault()}><CheckIcon size={12} strokeWidth={2.3} /></button>
            <button type="button" className="icon-button inline-cancel-btn compact" disabled={renamePending} aria-label="Cancel rename" title="Cancel (Esc)" onMouseDown={(event) => event.preventDefault()} onClick={cancelRename}><CloseIcon size={12} /></button>
          </div>
          {renameError && <p className="inline-error" role="alert">{renameError}</p>}
        </form> : <>
          <span className="month-reminder-title" title={`${reminder.title} (Double-click or F2 to rename)`} onDoubleClick={startRename}>{reminder.title}</span>
          <div className="month-reminder-meta">
            {overdue && onJumpToDate && <button
              type="button"
              className="overdue-date-link"
              title={`Planned for ${formatFullDate(reminder.scheduledDate)} · ${formatOverdueDuration(reminder.scheduledDate, today)} · Open day details`}
              onClick={() => onJumpToDate(reminder.scheduledDate)}
            >{inPanel ? `${formatMonthDay(reminder.scheduledDate)} · ${formatOverdueDuration(reminder.scheduledDate, today)}` : formatMonthDay(reminder.scheduledDate)}</button>}
            {overdue && !onJumpToDate && <Badge tone="overdue">{formatShortDate(reminder.scheduledDate)} · {formatOverdueDuration(reminder.scheduledDate, today)}</Badge>}
            {!overdue && isOverdueItem && <Badge tone="overdue">{formatOverdueDuration(reminder.scheduledDate, today)}</Badge>}
            {timingHint && <span className={`month-reminder-hint ${timingHint.tone === 'early' ? 'tone-early' : ''}`} title={timingHint.title}>{timingHint.text}</span>}
          </div>
        </>}
      </div>

      {!editingTitle && <div className="month-reminder-actions">
        {showDeleteButton && <button
          type="button"
          className="icon-button reminder-delete-btn"
          disabled={rowBusy}
          aria-label={`Delete reminder ${reminder.title}`}
          title="Move to Trash"
          onClick={() => setDialog('trash')}
        ><TrashIcon size={13} /></button>}
        <ActionMenu label={`More actions for ${reminder.title}`} items={menuItems} disabled={rowBusy} contextAnchor={contextAnchor} onContextClose={closeContext} />
      </div>}
    </div>

    {dialog === 'schedule' && <FormDialog title="Reschedule Reminder" description={reminder.title} label="Scheduled Date" kind="date" initialValue={reminder.scheduledDate} min={today} onClose={closeDialog} onSubmit={(value) => onAction(() => api.updateReminderSchedule(reminder.id, value, reminder.version), 'Schedule updated', { key: `${rowPrefix}schedule`, invalidate: REMINDER_KEYS })} />}
    {dialog === 'completedDate' && <FormDialog title="Edit Completed Date" description={reminder.title} label="Completed Date" kind="date" initialValue={reminder.completedDate ?? today} max={today} onClose={closeDialog} onSubmit={(value) => onAction(() => api.updateReminderCompletedDate(reminder.id, value, reminder.version), 'Completed date updated', { key: `${rowPrefix}completedDate`, invalidate: REMINDER_KEYS })} />}
    {dialog === 'trash' && <ConfirmDialog title="Move to Trash" description={`Move reminder "${reminder.title}" to Trash? You can restore it later.`} confirmLabel="Move to Trash" onClose={closeDialog} onConfirm={() => onAction(() => api.trashReminder(reminder.id), 'Reminder moved to Trash', { key: `${rowPrefix}trash`, invalidate: TRASH_KEYS })} />}
  </>
}

export function DayDetailPanel({
  day,
  today,
  overdueReminders,
  pendingKey,
  onStepDay,
  onSelectDate,
  onOpenInWeekly,
  onOpenProjectDetail,
  onAction,
  onClose,
}: {
  day: MonthDayDto
  today: ISODate
  overdueReminders: ReminderDailyItem[]
  pendingKey: string | null
  onStepDay: (delta: number) => void
  onSelectDate: (date: ISODate) => void
  onOpenInWeekly: (date: ISODate) => void
  onOpenProjectDetail: (projectId: string) => void
  onAction: ActionRunner
  onClose: () => void
}) {
  const [newTitle, setNewTitle] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const weekStart = useMemo(() => getWeekStart(day.date), [day.date])
  const weekQuery = useQuery({
    queryKey: ['dailyWeek', weekStart],
    queryFn: () => api.getDailyWeek(weekStart),
    staleTime: 15_000,
  })
  const dayProjects = useMemo(
    () => weekQuery.data?.days.find((entry) => entry.date === day.date),
    [weekQuery.data, day.date],
  )

  useEffect(() => {
    setNewTitle('')
    setCreateError(null)
  }, [day.date])

  const canAdd = day.date >= today
  const isToday = day.date === today
  const creating = pendingKey === `monthly:${day.date}:create`

  const plannedReminders = useMemo(
    () => [...day.plannedReminders].sort((a, b) => a.reminder.sortOrder - b.reminder.sortOrder || a.reminder.id.localeCompare(b.reminder.id)),
    [day.plannedReminders],
  )

  const addReminder = async (event: FormEvent) => {
    event.preventDefault()
    if (creating) return
    const trimmed = newTitle.trim()
    if (!trimmed) {
      setCreateError('Enter a reminder title first')
      inputRef.current?.focus({ preventScroll: true })
      return
    }
    setCreateError(null)
    const result = await onAction(
      () => api.createReminder(trimmed, day.date),
      'Reminder added',
      { key: `monthly:${day.date}:create`, invalidate: REMINDER_KEYS },
    )
    if (result.ok) {
      setNewTitle('')
      inputRef.current?.focus({ preventScroll: true })
    } else {
      setCreateError(result.message)
    }
  }

  const reorderReminders = async (fromId: string, targetId: string, position: DropPosition) => {
    if (pendingKey !== null) return
    const ordered = plannedReminders.map((item) => item.reminder.id)
    const nextIds = computeReorderedIds(ordered, fromId, targetId, position)
    if (!nextIds) return
    await onAction(
      () => api.reorderReminders(day.date, nextIds),
      'Reminder order saved',
      { key: `reminder:${fromId}:reorder`, invalidate: REMINDER_KEYS },
    )
  }

  const clearDrag = useCallback(() => {
    setDragId(null)
    setDropTarget(null)
  }, [])

  const handleDragHover = useCallback((id: string, position: DropPosition) => {
    setDropTarget((prev) => prev?.id === id && prev.position === position ? prev : { id, position })
  }, [])

  const handleDragLeave = useCallback((id: string) => {
    setDropTarget((prev) => prev?.id === id ? null : prev)
  }, [])

  const completedProjects = dayProjects?.completedProjects ?? []
  const progressedProjects = dayProjects?.progressedProjects ?? []

  return <SidePanel
    title={`${formatWeekdayShort(day.date)}, ${formatFullDate(day.date)}`}
    badge={isToday ? <Badge tone="primary">Today</Badge> : undefined}
    headerActions={<>
      <button type="button" className="icon-button" onClick={() => onStepDay(-1)} aria-label="Previous day" title="Previous day"><ArrowLeftIcon size={14} /></button>
      <button type="button" className="icon-button" onClick={() => onStepDay(1)} aria-label="Next day" title="Next day"><ArrowRightIcon size={14} /></button>
      <button type="button" className="icon-button" onClick={() => onOpenInWeekly(day.date)} aria-label="Open this day in Weekly view" title="Open in Weekly view"><ExternalLinkIcon size={14} /></button>
    </>}
    onClose={onClose}
  >
    <section className="day-panel-section">
      <div className="day-panel-section-title">
        <span>Reminders</span>
        <span className="count-label">{plannedReminders.length}</span>
      </div>

      {canAdd ? <form className="day-panel-create" onSubmit={(event) => void addReminder(event)}>
        <input
          ref={inputRef}
          className="form-input"
          value={newTitle}
          readOnly={creating}
          aria-busy={creating}
          onChange={(event) => { setNewTitle(event.target.value); if (createError) setCreateError(null) }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && newTitle) {
              event.preventDefault()
              event.stopPropagation()
              setNewTitle('')
            }
          }}
          placeholder="Add reminder for this day…"
          aria-label={`Add reminder for ${formatFullDate(day.date)}`}
        />
        <button type="submit" className="primary-button btn-sm" disabled={creating || !newTitle.trim()}>
          {creating ? 'Adding…' : 'Add'}
        </button>
      </form> : <p className="day-panel-past-note">Past date — new reminders can only be scheduled for today or future dates.</p>}
      {createError && <p className="inline-error" role="alert">{createError}</p>}

      {plannedReminders.length > 0 ? <div className="day-panel-items">
        {plannedReminders.map((item) => <MonthReminderRow
          key={`panel-planned-${item.reminder.id}`}
          item={item}
          today={today}
          pendingKey={pendingKey}
          inPanel
          showDeleteButton
          dragId={dragId}
          dropPosition={dropTarget?.id === item.reminder.id ? dropTarget.position : null}
          onDragStart={setDragId}
          onDragEnd={clearDrag}
          onDragHover={handleDragHover}
          onDragLeave={handleDragLeave}
          onReorder={plannedReminders.length > 1 ? reorderReminders : undefined}
          onAction={onAction}
        />)}
      </div> : <div className="day-panel-empty">No reminders scheduled for this day.</div>}
    </section>

    {day.crossDayCompletedReminders.length > 0 && <section className="day-panel-section">
      <div className="day-panel-section-title">
        <span>Completed from Other Dates</span>
        <span className="count-label">{day.crossDayCompletedReminders.length}</span>
      </div>
      <div className="day-panel-items">
        {day.crossDayCompletedReminders.map((item) => <MonthReminderRow
          key={`panel-cross-${item.reminder.id}`}
          item={item}
          today={today}
          pendingKey={pendingKey}
          inPanel
          showDeleteButton
          onAction={onAction}
        />)}
      </div>
    </section>}

    {isToday && overdueReminders.length > 0 && <section className="day-panel-section">
      <div className="day-panel-section-title tone-overdue">
        <ClockAlertIcon size={13} />
        <span>Current Overdue Reminders</span>
        <span className="count-label overdue-count">{overdueReminders.length}</span>
      </div>
      <div className="day-panel-items">
        {overdueReminders.map((item) => <MonthReminderRow
          key={`panel-overdue-${item.reminder.id}`}
          item={item}
          today={today}
          pendingKey={pendingKey}
          overdue
          inPanel
          showDeleteButton
          onJumpToDate={onSelectDate}
          onAction={onAction}
        />)}
      </div>
    </section>}

    {(day.completedProjectCount > 0 || completedProjects.length > 0) && <section className="day-panel-section">
      <div className="day-panel-section-title tone-completed">
        <CheckIcon size={13} strokeWidth={2.3} />
        <span>Completed Projects</span>
        <span className="count-label">{day.completedProjectCount}</span>
      </div>
      {weekQuery.isLoading && !dayProjects ? <p className="muted">Loading projects…</p> : <div className="day-panel-items">
        {completedProjects.map((item) => <DayProjectRow key={item.projectId} item={item} completed onOpenProjectDetail={onOpenProjectDetail} />)}
      </div>}
    </section>}

    {(day.progressedProjectCount > 0 || progressedProjects.length > 0) && <section className="day-panel-section">
      <div className="day-panel-section-title tone-progress">
        <TrendingUpIcon size={13} strokeWidth={2} />
        <span>Project Progress</span>
        <span className="count-label">{day.progressedProjectCount}</span>
      </div>
      {weekQuery.isLoading && !dayProjects ? <p className="muted">Loading progress records…</p> : <div className="day-panel-items">
        {progressedProjects.map((item) => <DayProjectRow key={item.projectId} item={item} onOpenProjectDetail={onOpenProjectDetail} />)}
      </div>}
    </section>}
  </SidePanel>
}

function DayProjectRow({
  item,
  completed = false,
  onOpenProjectDetail,
}: {
  item: ProjectDailyItem
  completed?: boolean
  onOpenProjectDetail: (projectId: string) => void
}) {
  const parentSummary = formatProjectParentSummary(item.parentPath)
  const meta = [parentSummary, item.shortId].filter(Boolean).join(' · ')
  const fullPath = [...item.parentPath, item.title].join(' / ')

  return <button type="button" className="daily-item" onClick={() => onOpenProjectDetail(item.projectId)} title={fullPath}>
    <span className="item-icon" style={{ color: completed ? 'var(--color-completed)' : 'var(--color-progress)' }} aria-hidden="true">
      {completed ? <CheckIcon size={13} strokeWidth={2.3} /> : <TrendingUpIcon size={13} strokeWidth={2} />}
    </span>
    <span className="item-text">
      <span className="item-heading">
        <strong>{item.title}</strong>
        {completed && item.progressedSameDay && <Badge tone="progress">Progressed same day</Badge>}
      </span>
      {meta && <small>{meta}</small>}
    </span>
  </button>
}
