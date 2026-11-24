import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, MouseEvent } from 'react'
import { api } from '../api'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CloseIcon,
  GripIcon,
  MinusIcon,
  ProgressArrowIcon,
  ReminderIcon,
  TrashIcon,
} from '../components/icons'
import { ActionMenu, ConfirmDialog, FormDialog, isEditableElement, Modal } from '../components/ui'
import type { ActionRunner } from '../components/ui'
import { STATUS_TEXT } from '../constants'
import type { DropPosition } from '../constants'
import { usePeriodNavigationShortcuts } from '../hooks/useGlobalShortcut'
import {
  computeCellReminderVisibility,
  computeMonthCellMetrics,
  computeOverdueStripLayout,
  getMonthWeekCount,
} from '../monthly-layout'
import type { MonthCellMetrics } from '../monthly-layout'
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
  const [overdueModalOpen, setOverdueModalOpen] = useState(false)
  const [gridSize, setGridSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [overdueStripWidth, setOverdueStripWidth] = useState(0)
  const quickInputRef = useRef<HTMLInputElement>(null)
  const monthGridRef = useRef<HTMLDivElement>(null)
  const overdueStripRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuickDate((current) => (!current || current < today ? today : current))
  }, [today])

  const hasCalendar = Boolean(calendar)
  const overdueCount = calendar?.overdueReminders.length ?? 0

  useLayoutEffect(() => {
    const element = monthGridRef.current
    if (!element) return
    const update = (width: number, height: number) => {
      const nextWidth = Math.round(width)
      const nextHeight = Math.round(height)
      setGridSize((prev) => (prev.width === nextWidth && prev.height === nextHeight ? prev : { width: nextWidth, height: nextHeight }))
    }
    const rect = element.getBoundingClientRect()
    update(rect.width, rect.height)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      update(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasCalendar])

  useLayoutEffect(() => {
    const element = overdueStripRef.current
    if (!element) return
    const update = (width: number) => {
      const nextWidth = Math.round(width)
      setOverdueStripWidth((prev) => (prev === nextWidth ? prev : nextWidth))
    }
    update(element.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      update(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [overdueCount > 0])

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

  const weekCount = getMonthWeekCount(calendar?.days.length ?? 0)
  const cellWidth = gridSize.width > 0 ? gridSize.width / 7 : 0
  const cellHeight = gridSize.height > 0 ? gridSize.height / weekCount : 0
  const cellMetrics = useMemo(() => computeMonthCellMetrics(cellWidth, cellHeight), [cellWidth, cellHeight])

  const overdueLayout = useMemo(
    () => computeOverdueStripLayout(overdueCount, overdueStripWidth),
    [overdueCount, overdueStripWidth],
  )
  const visibleOverdue = useMemo(
    () => (calendar ? calendar.overdueReminders.slice(0, overdueLayout.visibleCount) : []),
    [calendar, overdueLayout.visibleCount],
  )

  const gridStyle = useMemo(() => ({
    '--month-rows': weekCount,
    '--cell-pad-y': `${cellMetrics.padY}px`,
    '--cell-pad-x': `${cellMetrics.padX}px`,
    '--cell-gap': `${cellMetrics.cellGap}px`,
    '--cell-header-h': `${cellMetrics.headerHeight}px`,
    '--cell-stats-h': `${cellMetrics.statsHeight}px`,
    '--cell-item-h': `${cellMetrics.itemHeight}px`,
    '--cell-item-gap': `${cellMetrics.itemGap}px`,
    '--cell-more-h': `${cellMetrics.moreHeight}px`,
  }) as CSSProperties, [weekCount, cellMetrics])

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

    {calendar && overdueCount > 0 && <section className="monthly-overdue-card card" aria-label="Overdue reminders">
      <button
        type="button"
        className="monthly-overdue-trigger"
        onClick={() => setOverdueModalOpen(true)}
        aria-label={`View all ${overdueCount} overdue ${overdueCount === 1 ? 'reminder' : 'reminders'}`}
        title="View all overdue reminders"
      >
        <span className="monthly-overdue-title">Overdue Reminders</span>
        <span className="count-label overdue-count">{overdueCount}</span>
      </button>
      <div ref={overdueStripRef} className="monthly-overdue-strip">
        {visibleOverdue.map((item) => <MonthReminderRow
          key={`overdue-${item.reminder.id}`}
          item={item}
          today={effectiveToday}
          pendingKey={pendingKey}
          overdue
          onSelectDay={onSelectDay}
          onAction={onAction}
        />)}
        {overdueLayout.hiddenCount > 0 && <button
          type="button"
          className={`overdue-more-btn ${visibleOverdue.length === 0 ? 'solo' : ''}`}
          onClick={() => setOverdueModalOpen(true)}
          aria-label={visibleOverdue.length === 0
            ? `View all ${overdueCount} overdue reminders`
            : `Show ${overdueLayout.hiddenCount} more overdue ${overdueLayout.hiddenCount === 1 ? 'reminder' : 'reminders'}`}
        >
          {visibleOverdue.length === 0 ? 'View all' : `+${overdueLayout.hiddenCount} more`}
        </button>}
      </div>
    </section>}

    <div className="month-calendar-card card">
      {!calendar ? <div className="loading-state">Loading monthly calendar…</div> : <div className="month-calendar-body">
        <div className="month-weekdays" aria-hidden="true">
          {WEEKDAYS.map((day, index) => <span key={day} className={index >= 5 ? 'weekend' : ''}>{day}</span>)}
        </div>
        <div
          ref={monthGridRef}
          className={`month-grid density-${cellMetrics.density}`}
          style={gridStyle}
          role="grid"
          aria-label={formatMonthLabel(calendar.month)}
        >
          {calendar.days.map((day, index) => <MonthDayCell
            key={day.date}
            day={day}
            today={calendar.today}
            isLastRow={index >= (weekCount - 1) * 7}
            cellHeight={cellHeight}
            metrics={cellMetrics}
            pendingKey={pendingKey}
            onOpenDay={setActiveDayDate}
            onOpenDetails={onSelectDay}
            onAction={onAction}
          />)}
        </div>
      </div>}
    </div>

    {overdueModalOpen && calendar && <OverdueRemindersModal
      reminders={calendar.overdueReminders}
      today={calendar.today}
      pendingKey={pendingKey}
      onClose={() => setOverdueModalOpen(false)}
      onSelectDay={(date) => {
        setOverdueModalOpen(false)
        onSelectDay(date)
      }}
      onAction={onAction}
    />}

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
  isLastRow,
  cellHeight,
  metrics,
  pendingKey,
  onOpenDay,
  onOpenDetails,
  onAction,
}: {
  day: MonthDayDto
  today: string
  isLastRow: boolean
  cellHeight: number
  metrics: MonthCellMetrics
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
  const hasProjectStats = day.completedProjectCount > 0 || day.progressedProjectCount > 0
  const useInlineStats = isToday ? metrics.inlineStatsWithToday : metrics.inlineStats
  const hasSeparateStatsRow = hasProjectStats && !useInlineStats

  const allReminders = useMemo(
    () => [
      ...day.plannedReminders.map((item) => ({ key: `planned-${item.reminder.id}`, item })),
      ...day.crossDayCompletedReminders.map((item) => ({ key: `completed-${item.reminder.id}`, item })),
    ],
    [day.plannedReminders, day.crossDayCompletedReminders],
  )

  const visibility = useMemo(
    () => computeCellReminderVisibility(allReminders.length, cellHeight, hasSeparateStatsRow, metrics),
    [allReminders.length, cellHeight, hasSeparateStatsRow, metrics],
  )

  const visibleReminders = allReminders.slice(0, visibility.visibleCount)

  const handleCellClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (!event.currentTarget.contains(target)) return
    if (target.closest('[data-month-stop]')) return
    onOpenDay(day.date)
  }

  const showReminderBadgeInStats = visibility.showHeaderReminderCount && hasSeparateStatsRow
  const showReminderBadgeInHeader = visibility.showHeaderReminderCount && !hasSeparateStatsRow
  const compactReminderBadge = <span
    className="month-stat reminders"
    title={`${allReminders.length} ${allReminders.length === 1 ? 'reminder' : 'reminders'}`}
  ><ReminderIcon size={9} strokeWidth={2.2} />{allReminders.length}</span>

  const projectStats = hasProjectStats ? <div className={`month-project-stats ${useInlineStats ? 'inline' : ''}`}>
    {day.completedProjectCount > 0 && <span
      className="month-stat completed"
      title={`${day.completedProjectCount} completed ${day.completedProjectCount === 1 ? 'project' : 'projects'}`}
    ><CheckIcon size={9} strokeWidth={2.5} />{day.completedProjectCount}</span>}
    {day.progressedProjectCount > 0 && <span
      className="month-stat progressed"
      title={`${day.progressedProjectCount} progressed ${day.progressedProjectCount === 1 ? 'project' : 'projects'}`}
    ><ProgressArrowIcon size={9} strokeWidth={2.3} />{day.progressedProjectCount}</span>}
    {showReminderBadgeInStats && compactReminderBadge}
  </div> : null

  return <div
    role="gridcell"
    className={`month-cell ${day.inCurrentMonth ? 'in-month' : 'outside-month'} ${isToday ? 'today' : ''} ${isPast ? 'past' : ''} ${isWeekend ? 'weekend' : ''} ${isLastRow ? 'last-row' : ''}`}
    onClick={handleCellClick}
  >
    <div className="month-cell-header">
      <div className="month-cell-header-main">
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
        {useInlineStats && projectStats}
        {showReminderBadgeInHeader && compactReminderBadge}
      </div>
      <button
        type="button"
        data-month-stop
        className={`month-details-btn ${metrics.compactDetails ? 'icon-only' : ''}`}
        aria-label={`View details for ${fullLabel} in Weekly view`}
        title={`View ${fullLabel} in Weekly view`}
        onClick={(event) => {
          event.stopPropagation()
          onOpenDetails(day.date)
        }}
      >{metrics.compactDetails ? <ProgressArrowIcon size={11} strokeWidth={2.1} /> : 'Details'}</button>
    </div>

    {hasSeparateStatsRow && projectStats}

    {(visibleReminders.length > 0 || visibility.showMoreRow) && <div className="month-cell-reminders">
      {visibleReminders.map(({ key, item }) => <MonthCellReminderPreview
        key={key}
        item={item}
        today={today}
        showDateHint={metrics.showDateHint}
        pendingKey={pendingKey}
        onAction={onAction}
      />)}
      {visibility.showMoreRow && <button
        type="button"
        className="month-more-btn"
        onClick={(event) => {
          event.stopPropagation()
          onOpenDay(day.date)
        }}
        aria-label={visibility.visibleCount === 0
          ? `Show ${allReminders.length} ${allReminders.length === 1 ? 'reminder' : 'reminders'} for ${fullLabel}`
          : `Show ${visibility.hiddenCount} more ${visibility.hiddenCount === 1 ? 'reminder' : 'reminders'} for ${fullLabel}`}
      >
        {visibility.visibleCount === 0
          ? `${allReminders.length} ${allReminders.length === 1 ? 'reminder' : 'reminders'}`
          : `+${visibility.hiddenCount} more`}
      </button>}
    </div>}
  </div>
}

function MonthCellReminderPreview({
  item,
  today,
  showDateHint,
  pendingKey,
  onAction,
}: {
  item: ReminderDailyItem
  today: string
  showDateHint: boolean
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

  return <div
    className={`month-reminder-row preview ${reminder.status} ${isOverdueItem ? 'overdue' : ''} ${rowBusy ? 'is-pending' : ''}`}
    title={dateHint ? `${reminder.title} (${dateHint})` : reminder.title}
  >
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
      {reminder.status === 'completed' && <CheckIcon size={9} strokeWidth={2.6} />}
      {reminder.status === 'canceled' && <MinusIcon size={9} strokeWidth={2.4} />}
    </button>
    <span className="month-reminder-title">{reminder.title}</span>
    {showDateHint && dateHint && <span className="month-reminder-hint">{dateHint}</span>}
  </div>
}

function OverdueRemindersModal({
  reminders,
  today,
  pendingKey,
  onClose,
  onSelectDay,
  onAction,
}: {
  reminders: ReminderDailyItem[]
  today: string
  pendingKey: string | null
  onClose: () => void
  onSelectDay: (date: string) => void
  onAction: ActionRunner
}) {
  return <Modal
    title="Overdue Reminders"
    description={reminders.length > 0
      ? `${reminders.length} unfinished ${reminders.length === 1 ? 'reminder' : 'reminders'} scheduled before today.`
      : 'All overdue reminders have been resolved.'}
    onClose={onClose}
    className="day-reminders-modal"
  >
    {reminders.length > 0 ? <div className="day-modal-items">
      {reminders.map((item) => <MonthReminderRow
        key={`overdue-modal-${item.reminder.id}`}
        item={item}
        today={today}
        pendingKey={pendingKey}
        overdue
        inModal
        showDeleteButton
        onSelectDay={onSelectDay}
        onAction={onAction}
      />)}
    </div> : <div className="day-modal-empty">All caught up — no overdue reminders left.</div>}
  </Modal>
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
              title={`Overdue from ${formatFullDate(reminder.scheduledDate)} — view in Weekly view`}
              onClick={() => onSelectDay(reminder.scheduledDate)}
            >{inModal ? `Overdue · ${formatMonthDay(reminder.scheduledDate)}` : formatMonthDay(reminder.scheduledDate)}</button>}
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
