import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, MouseEvent } from 'react'
import { api } from '../api'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CloseIcon,
  GripIcon,
  MinusIcon,
  ProgressArrowIcon,
  TrashIcon,
} from '../components/icons'
import { ActionMenu, ConfirmDialog, FormDialog, isEditableElement, Modal } from '../components/ui'
import type { ActionRunner } from '../components/ui'
import { STATUS_TEXT } from '../constants'
import type { DropPosition } from '../constants'
import { usePeriodNavigationShortcuts } from '../hooks/useGlobalShortcut'
import { computeReorderedIds } from '../project-tree'
import { REMINDER_KEYS, TRASH_KEYS } from '../query-keys'
import type { MonthCalendarDto, MonthDayDto, ReminderDailyItem } from '../types'
import {
  formatFullDate,
  formatMonthDay,
  formatMonthLabel,
  formatShortDate,
  formatWeekdayShort,
  isWeekendDate,
  shiftMonth,
  WEEKDAYS,
} from '../ui-format'

export function MonthlyView({
  calendar,
  month,
  currentMonth,
  today,
  pendingKey,
  onMonthChange,
  onSelectDay,
  onAction,
}: {
  calendar: MonthCalendarDto | undefined
  month: string
  currentMonth: string
  today: string
  pendingKey: string | null
  onMonthChange: (month: string) => void
  onSelectDay: (date: string) => void
  onAction: ActionRunner
}) {
  const [quickTitle, setQuickTitle] = useState('')
  const [quickDate, setQuickDate] = useState(today)
  const [activeDayDate, setActiveDayDate] = useState<string | null>(null)
  const quickInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setQuickDate((current) => (!current || current < today ? today : current))
  }, [today])

  const activeDay = useMemo(
    () => (activeDayDate && calendar ? calendar.days.find((day) => day.date === activeDayDate) ?? null : null),
    [activeDayDate, calendar],
  )

  const moveMonth = useCallback((delta: number) => {
    if (!month) return
    setActiveDayDate(null)
    onMonthChange(shiftMonth(month, delta))
  }, [month, onMonthChange])

  const jumpToCurrentMonth = useCallback(() => {
    if (!currentMonth) return
    setActiveDayDate(null)
    onMonthChange(currentMonth)
  }, [currentMonth, onMonthChange])

  usePeriodNavigationShortcuts(moveMonth, jumpToCurrentMonth)

  const creatingQuick = pendingKey === 'monthly:quick-create'
  const effectiveToday = calendar?.today ?? today
  const isCurrentMonth = Boolean(month && currentMonth && month === currentMonth)

  const submitQuickReminder = async (event: FormEvent) => {
    event.preventDefault()
    if (creatingQuick || !quickTitle.trim() || !quickDate) return
    const targetDate = quickDate
    const result = await onAction(
      () => api.createReminder(quickTitle.trim(), targetDate),
      'Reminder added',
      { key: 'monthly:quick-create', invalidate: REMINDER_KEYS },
    )
    if (result.ok) {
      setQuickTitle('')
      const targetMonth = targetDate.slice(0, 7)
      if (targetMonth && targetMonth !== month) {
        onMonthChange(targetMonth)
      }
      quickInputRef.current?.focus({ preventScroll: true })
    }
  }

  return <section className="view-stack monthly-view" aria-label="Monthly">
    <div className="page-toolbar monthly-toolbar">
      <div className="page-title monthly-title-group">
        <h1>Monthly</h1>
        {month && <span className="week-range">{formatMonthLabel(month)}</span>}
        <div className="week-controls">
          <button type="button" disabled={!month} onClick={() => moveMonth(-1)} aria-label="Previous month" title="Previous month (←)"><ArrowLeftIcon size={15} /></button>
          <button type="button" className={isCurrentMonth ? 'current-week' : ''} disabled={!currentMonth} onClick={jumpToCurrentMonth} title="Jump to current month (T)">This Month</button>
          <button type="button" disabled={!month} onClick={() => moveMonth(1)} aria-label="Next month" title="Next month (→)"><ArrowRightIcon size={15} /></button>
        </div>
      </div>
      <form className="monthly-create-bar" onSubmit={(event) => void submitQuickReminder(event)}>
        <input
          ref={quickInputRef}
          className="monthly-create-input"
          value={quickTitle}
          readOnly={creatingQuick}
          aria-busy={creatingQuick}
          onChange={(event) => setQuickTitle(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape') setQuickTitle('') }}
          placeholder="Add reminder…"
          aria-label="New reminder title"
        />
        <input
          type="date"
          className="monthly-create-date"
          value={quickDate}
          min={effectiveToday}
          disabled={creatingQuick}
          aria-label="Scheduled date"
          onChange={(event) => setQuickDate(event.target.value)}
        />
        <button type="submit" className="primary-button" disabled={creatingQuick || !quickTitle.trim() || !quickDate}>
          {creatingQuick ? 'Adding…' : 'Add'}
        </button>
      </form>
    </div>

    {calendar && calendar.overdueReminders.length > 0 && <section className="monthly-overdue-card card" aria-label="Overdue reminders">
      <div className="monthly-overdue-header">
        <h2>Overdue Reminders</h2>
        <span className="count-label overdue-count">{calendar.overdueReminders.length}</span>
      </div>
      <div className="monthly-overdue-list">
        {calendar.overdueReminders.map((item) => <MonthReminderRow
          key={`overdue-${item.reminder.id}`}
          item={item}
          today={effectiveToday}
          pendingKey={pendingKey}
          overdue
          onSelectDay={onSelectDay}
          onAction={onAction}
        />)}
      </div>
    </section>}

    <div className="month-calendar-card card">
      {!calendar ? <div className="loading-state">Loading monthly calendar…</div> : <div className="month-calendar-scroll">
        <div className="month-weekdays" aria-hidden="true">
          {WEEKDAYS.map((day, index) => <span key={day} className={index >= 5 ? 'weekend' : ''}>{day}</span>)}
        </div>
        <div className="month-grid" role="grid" aria-label={formatMonthLabel(calendar.month)}>
          {calendar.days.map((day) => <MonthDayCell
            key={day.date}
            day={day}
            today={calendar.today}
            pendingKey={pendingKey}
            onOpenDay={setActiveDayDate}
            onOpenDetails={onSelectDay}
            onAction={onAction}
          />)}
        </div>
      </div>}
    </div>

    {activeDay && calendar && <DayRemindersModal
      day={activeDay}
      today={calendar.today}
      overdueReminders={activeDay.date === calendar.today ? calendar.overdueReminders : []}
      pendingKey={pendingKey}
      onClose={() => setActiveDayDate(null)}
      onOpenDetails={(date) => {
        setActiveDayDate(null)
        onSelectDay(date)
      }}
      onAction={onAction}
    />}
  </section>
}

function MonthDayCell({
  day,
  today,
  pendingKey,
  onOpenDay,
  onOpenDetails,
  onAction,
}: {
  day: MonthDayDto
  today: string
  pendingKey: string | null
  onOpenDay: (date: string) => void
  onOpenDetails: (date: string) => void
  onAction: ActionRunner
}) {
  const isToday = day.date === today
  const isPast = day.date < today
  const isWeekend = isWeekendDate(day.date)
  const dayNumber = Number(day.date.slice(-2))
  const dayLabel = dayNumber === 1 && !day.inCurrentMonth ? formatMonthDay(day.date) : String(dayNumber)
  const fullLabel = formatFullDate(day.date)
  const hasReminders = day.plannedReminders.length > 0 || day.crossDayCompletedReminders.length > 0
  const hasProjectStats = day.completedProjectCount > 0 || day.progressedProjectCount > 0

  const handleCellClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (!event.currentTarget.contains(target)) return
    if (target.closest('[data-month-stop]')) return
    onOpenDay(day.date)
  }

  return <div
    role="gridcell"
    className={`month-cell ${day.inCurrentMonth ? 'in-month' : 'outside-month'} ${isToday ? 'today' : ''} ${isPast ? 'past' : ''} ${isWeekend ? 'weekend' : ''}`}
    onClick={handleCellClick}
  >
    <div className="month-cell-header">
      <button
        type="button"
        className="month-day-open"
        onClick={(event) => {
          event.stopPropagation()
          onOpenDay(day.date)
        }}
        title={`Manage reminders for ${fullLabel}`}
        aria-label={`Manage reminders for ${fullLabel}`}
      >
        <time className="month-day-number" dateTime={day.date}>{dayLabel}</time>
        {isToday && <span className="month-today-pill">Today</span>}
      </button>
      <button
        type="button"
        data-month-stop
        className="month-details-btn"
        aria-label={`View details for ${fullLabel} in Weekly view`}
        title={`View ${fullLabel} in Weekly view`}
        onClick={(event) => {
          event.stopPropagation()
          onOpenDetails(day.date)
        }}
      >Details</button>
    </div>

    {hasProjectStats && <div className="month-project-stats">
      {day.completedProjectCount > 0 && <span
        className="month-stat completed"
        title={`${day.completedProjectCount} completed ${day.completedProjectCount === 1 ? 'project' : 'projects'}`}
      ><CheckIcon size={10} strokeWidth={2.4} />{day.completedProjectCount}</span>}
      {day.progressedProjectCount > 0 && <span
        className="month-stat progressed"
        title={`${day.progressedProjectCount} progressed ${day.progressedProjectCount === 1 ? 'project' : 'projects'}`}
      ><ProgressArrowIcon size={10} strokeWidth={2.2} />{day.progressedProjectCount}</span>}
    </div>}

    {hasReminders && <div className="month-cell-reminders">
      {day.plannedReminders.map((item) => <MonthCellReminderPreview
        key={`planned-${item.reminder.id}`}
        item={item}
        today={today}
        pendingKey={pendingKey}
        onAction={onAction}
      />)}
      {day.crossDayCompletedReminders.map((item) => <MonthCellReminderPreview
        key={`completed-${item.reminder.id}`}
        item={item}
        today={today}
        pendingKey={pendingKey}
        onAction={onAction}
      />)}
    </div>}
  </div>
}

function MonthCellReminderPreview({
  item,
  today,
  pendingKey,
  onAction,
}: {
  item: ReminderDailyItem
  today: string
  pendingKey: string | null
  onAction: ActionRunner
}) {
  const { reminder } = item
  const rowPrefix = `reminder:${reminder.id}:`
  const rowBusy = pendingKey?.startsWith(rowPrefix) ?? false
  const isOverdueItem = item.displayType === 'planned' && reminder.status === 'active' && reminder.scheduledDate < today

  const dateHint = item.displayType === 'completed'
    ? `From ${formatShortDate(reminder.scheduledDate)}`
    : item.displayType === 'planned' && reminder.status === 'completed' && !item.isPlannedAndCompletedSameDay && reminder.completedDate
      ? `Done ${formatShortDate(reminder.completedDate)}`
      : null

  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    void onAction(
      () => reminder.status === 'completed'
        ? api.restoreReminder(reminder.id, reminder.version)
        : api.completeReminder(reminder.id, reminder.version),
      reminder.status === 'completed' ? 'Reminder restored' : 'Reminder completed',
      { key: `${rowPrefix}toggle`, invalidate: REMINDER_KEYS },
    )
  }

  return <div className={`month-reminder-row preview ${reminder.status} ${isOverdueItem ? 'overdue' : ''} ${rowBusy ? 'is-pending' : ''}`}>
    <button
      type="button"
      data-month-stop
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
      <span className="month-reminder-title" title={reminder.title}>{reminder.title}</span>
      {dateHint && <span className="month-reminder-hint">{dateHint}</span>}
    </div>
  </div>
}

function DayRemindersModal({
  day,
  today,
  overdueReminders,
  pendingKey,
  onClose,
  onOpenDetails,
  onAction,
}: {
  day: MonthDayDto
  today: string
  overdueReminders: ReminderDailyItem[]
  pendingKey: string | null
  onClose: () => void
  onOpenDetails: (date: string) => void
  onAction: ActionRunner
}) {
  const [newTitle, setNewTitle] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const canAdd = day.date >= today
  const isToday = day.date === today
  const creating = pendingKey === `monthly:${day.date}:create`
  const plannedReminders = useMemo(
    () => [...day.plannedReminders].sort((a, b) => a.reminder.sortOrder - b.reminder.sortOrder || a.reminder.id.localeCompare(b.reminder.id)),
    [day.plannedReminders],
  )
  const hasAnyReminders = plannedReminders.length > 0 || overdueReminders.length > 0 || day.crossDayCompletedReminders.length > 0

  const addReminder = async (event: FormEvent) => {
    event.preventDefault()
    if (creating || !newTitle.trim()) return
    const result = await onAction(
      () => api.createReminder(newTitle.trim(), day.date),
      'Reminder added',
      { key: `monthly:${day.date}:create`, invalidate: REMINDER_KEYS },
    )
    if (result.ok) {
      setNewTitle('')
      inputRef.current?.focus({ preventScroll: true })
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

  const summaryParts: string[] = []
  if (day.completedProjectCount > 0) {
    summaryParts.push(`${day.completedProjectCount} completed ${day.completedProjectCount === 1 ? 'project' : 'projects'}`)
  }
  if (day.progressedProjectCount > 0) {
    summaryParts.push(`${day.progressedProjectCount} progressed ${day.progressedProjectCount === 1 ? 'project' : 'projects'}`)
  }

  return <Modal
    title={`${formatWeekdayShort(day.date)}, ${formatFullDate(day.date)}`}
    onClose={onClose}
    className="day-reminders-modal"
  >
    <div className="day-modal-meta">
      <div className="day-modal-badges">
        {isToday && <span className="today-pill">Today</span>}
        <span className="muted">
          {summaryParts.length > 0 ? summaryParts.join(' · ') : 'Manage reminders for this day'}
        </span>
      </div>
      <button
        type="button"
        className="secondary-button day-modal-details-btn"
        onClick={() => onOpenDetails(day.date)}
      >Details</button>
    </div>

    {canAdd ? <form className="day-modal-create" onSubmit={(event) => void addReminder(event)}>
      <input
        ref={inputRef}
        data-autofocus
        className="form-input"
        value={newTitle}
        readOnly={creating}
        aria-busy={creating}
        onChange={(event) => setNewTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && newTitle) {
            event.preventDefault()
            event.stopPropagation()
            setNewTitle('')
          }
        }}
        placeholder="Add a reminder for this day…"
        aria-label={`Add a reminder for ${formatFullDate(day.date)}`}
      />
      <button type="submit" className="primary-button" disabled={creating || !newTitle.trim()}>
        {creating ? 'Adding…' : 'Add'}
      </button>
    </form> : <p className="day-modal-past-note">Past date — new reminders can only be scheduled for today or future dates.</p>}

    <div className="day-modal-list">
      {plannedReminders.length > 0 && <div className="day-modal-section">
        <h3>Scheduled Reminders <span className="count-label">{plannedReminders.length}</span></h3>
        <div className="day-modal-items">
          {plannedReminders.map((item) => <MonthReminderRow
            key={`modal-planned-${item.reminder.id}`}
            item={item}
            today={today}
            pendingKey={pendingKey}
            inModal
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
        </div>
      </div>}

      {overdueReminders.length > 0 && <div className="day-modal-section">
        <h3 className="overdue-heading">Overdue Reminders <span className="count-label overdue-count">{overdueReminders.length}</span></h3>
        <div className="day-modal-items">
          {overdueReminders.map((item) => <MonthReminderRow
            key={`modal-overdue-${item.reminder.id}`}
            item={item}
            today={today}
            pendingKey={pendingKey}
            overdue
            inModal
            showDeleteButton
            onSelectDay={(date) => {
              onClose()
              onOpenDetails(date)
            }}
            onAction={onAction}
          />)}
        </div>
      </div>}

      {day.crossDayCompletedReminders.length > 0 && <div className="day-modal-section">
        <h3>Completed from Earlier <span className="count-label">{day.crossDayCompletedReminders.length}</span></h3>
        <div className="day-modal-items">
          {day.crossDayCompletedReminders.map((item) => <MonthReminderRow
            key={`modal-completed-${item.reminder.id}`}
            item={item}
            today={today}
            pendingKey={pendingKey}
            inModal
            showDeleteButton
            onAction={onAction}
          />)}
        </div>
      </div>}

      {!hasAnyReminders && <div className="day-modal-empty">No reminders for this day yet.</div>}
    </div>
  </Modal>
}

type ReminderDialog = 'schedule' | 'completedDate' | 'trash'

function MonthReminderRow({
  item,
  today,
  overdue = false,
  inModal = false,
  showDeleteButton = false,
  pendingKey,
  dragId = null,
  dropPosition = null,
  onSelectDay,
  onDragStart,
  onDragEnd,
  onDragHover,
  onDragLeave,
  onReorder,
  onAction,
}: {
  item: ReminderDailyItem
  today: string
  overdue?: boolean
  inModal?: boolean
  showDeleteButton?: boolean
  pendingKey: string | null
  dragId?: string | null
  dropPosition?: DropPosition | null
  onSelectDay?: (date: string) => void
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

  const dateHint = overdue
    ? null
    : item.displayType === 'completed'
      ? { text: `From ${formatShortDate(reminder.scheduledDate)}`, title: `Scheduled for ${reminder.scheduledDate}` }
      : item.displayType === 'planned' && reminder.status === 'completed' && !item.isPlannedAndCompletedSameDay && reminder.completedDate
        ? { text: `Done ${formatShortDate(reminder.completedDate)}`, title: `Completed on ${reminder.completedDate}` }
        : reminder.status === 'canceled'
          ? { text: 'Canceled', title: reminder.canceledDate ? `Canceled on ${reminder.canceledDate}` : 'Canceled' }
          : null

  return <>
    <div
      data-month-stop
      className={`month-reminder-row ${inModal ? 'in-modal' : 'in-overdue-bar'} ${reminder.status} ${isOverdueItem ? 'overdue' : ''} ${isDragging ? 'is-dragging' : ''} ${dropPosition ? `drop-${dropPosition}` : ''} ${rowBusy ? 'is-pending' : ''}`}
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
            {overdue && onSelectDay && <button
              type="button"
              className="overdue-date-link"
              title={`View ${formatFullDate(reminder.scheduledDate)} in Weekly view`}
              onClick={() => onSelectDay(reminder.scheduledDate)}
            >Overdue · {formatMonthDay(reminder.scheduledDate)}</button>}
            {overdue && !onSelectDay && <span className="overdue-label">Overdue · {formatShortDate(reminder.scheduledDate)}</span>}
            {!overdue && isOverdueItem && <span className="overdue-label">Overdue</span>}
            {dateHint && <span className="month-reminder-hint" title={dateHint.title}>{dateHint.text}</span>}
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
