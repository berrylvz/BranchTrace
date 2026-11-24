import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, KeyboardEvent, MouseEvent } from 'react'
import { api } from '../api'
import { DayDetailPanel, MonthReminderRow } from '../components/DayDetailPanel'
import {
  CheckIcon,
  ChevronDownIcon,
  ClockAlertIcon,
  MinusIcon,
  PlusIcon,
  ReminderIcon,
  TrendingUpIcon,
} from '../components/icons'
import { DateNavigator, SegmentedControl } from '../components/ui'
import type { ActionRunner } from '../components/ui'
import { STATUS_TEXT } from '../constants'
import { usePeriodNavigationShortcuts } from '../hooks/useGlobalShortcut'
import {
  computeCellReminderVisibility,
  computeMonthCellMetrics,
  computeOverdueStripLayout,
  getCellRemindersForDisplayMode,
  getMonthWeekCount,
} from '../monthly-layout'
import type { MonthCellMetrics } from '../monthly-layout'
import { loadMonthlyDisplayMode, saveMonthlyDisplayMode } from '../preferences'
import type { MonthlyDisplayMode } from '../preferences'
import { REMINDER_KEYS } from '../query-keys'
import type { ISODate, MonthCalendarDto, MonthDayDto, ReminderDailyItem } from '../types'
import {
  addDays,
  describeReminderCompletionTiming,
  formatFullDate,
  formatMonthDay,
  formatMonthLabel,
  formatShortDate,
  isWeekendDate,
  shiftMonth,
  WEEKDAYS,
} from '../ui-format'

const DISPLAY_MODE_OPTIONS: readonly { value: MonthlyDisplayMode; label: string; title: string }[] = [
  { value: 'both', label: 'Both', title: 'Show planned dates and actual completion dates' },
  { value: 'planned', label: 'Planned', title: 'Show reminders on their scheduled date only' },
  { value: 'actual', label: 'Actual', title: 'Show completed reminders on their actual completion date' },
]

export function MonthlyView({
  calendar,
  month,
  currentMonth,
  today,
  pendingKey,
  focusCreateTick,
  selectedDateRequest,
  onClearSelectedDateRequest,
  onMonthChange,
  onOpenWeeklyDay,
  onOpenProjectDetail,
  onAction,
}: {
  calendar: MonthCalendarDto | undefined
  month: string
  currentMonth: string
  today: ISODate
  pendingKey: string | null
  focusCreateTick: number
  selectedDateRequest: { date: ISODate; tick: number } | null
  onClearSelectedDateRequest: () => void
  onMonthChange: (month: string) => void
  onOpenWeeklyDay: (date: ISODate) => void
  onOpenProjectDetail: (projectId: string) => void
  onAction: ActionRunner
}) {
  const [quickTitle, setQuickTitle] = useState('')
  const [quickDate, setQuickDate] = useState(today)
  const [quickError, setQuickError] = useState<string | null>(null)
  const [displayMode, setDisplayMode] = useState<MonthlyDisplayMode>(() => loadMonthlyDisplayMode())
  const [activeDayDate, setActiveDayDate] = useState<ISODate | null>(null)
  const [overdueExpanded, setOverdueExpanded] = useState(false)
  const [gridSize, setGridSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [overdueStripWidth, setOverdueStripWidth] = useState(0)

  const quickInputRef = useRef<HTMLInputElement>(null)
  const monthGridRef = useRef<HTMLDivElement>(null)
  const overdueStripRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuickDate((current) => (!current || current < today ? today : current))
  }, [today])

  useEffect(() => {
    if (focusCreateTick > 0) quickInputRef.current?.focus({ preventScroll: true })
  }, [focusCreateTick])

  useEffect(() => {
    if (!selectedDateRequest) return
    setActiveDayDate(selectedDateRequest.date)
    if (selectedDateRequest.date >= today) setQuickDate(selectedDateRequest.date)
    onClearSelectedDateRequest()
  }, [selectedDateRequest, today, onClearSelectedDateRequest])

  const hasCalendar = Boolean(calendar)
  const overdueCount = calendar?.overdueReminders.length ?? 0

  useEffect(() => {
    if (overdueCount === 0) setOverdueExpanded(false)
  }, [overdueCount])

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
  }, [hasCalendar, Boolean(activeDayDate)])

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
  }, [overdueCount > 0, overdueExpanded])

  const activeDay = useMemo(
    () => (activeDayDate && calendar ? calendar.days.find((day) => day.date === activeDayDate) ?? null : null),
    [activeDayDate, calendar],
  )

  const selectDay = useCallback((date: ISODate) => {
    setActiveDayDate(date)
    const targetMonth = date.slice(0, 7)
    if (targetMonth && targetMonth !== month) {
      onMonthChange(targetMonth)
    }
    if (date >= today) {
      setQuickDate(date)
    }
  }, [month, onMonthChange, today])

  const stepActiveDay = useCallback((delta: number) => {
    if (!activeDayDate) return
    const nextDate = addDays(activeDayDate, delta)
    selectDay(nextDate)
  }, [activeDayDate, selectDay])

  const moveMonth = useCallback((delta: number) => {
    if (!month) return
    onMonthChange(shiftMonth(month, delta))
  }, [month, onMonthChange])

  const jumpToCurrentMonth = useCallback(() => {
    if (!currentMonth) return
    onMonthChange(currentMonth)
  }, [currentMonth, onMonthChange])

  usePeriodNavigationShortcuts(moveMonth, jumpToCurrentMonth)

  const handleDisplayModeChange = (next: MonthlyDisplayMode) => {
    setDisplayMode(next)
    saveMonthlyDisplayMode(next)
  }

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
    if (creatingQuick) return
    const trimmed = quickTitle.trim()
    if (!trimmed) {
      setQuickError('Enter a reminder title')
      quickInputRef.current?.focus({ preventScroll: true })
      return
    }
    if (!quickDate || quickDate < effectiveToday) {
      setQuickError('Choose today or a future date')
      return
    }
    setQuickError(null)
    const targetDate = quickDate
    const result = await onAction(
      () => api.createReminder(trimmed, targetDate),
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
    } else {
      setQuickError(result.message)
    }
  }

  return <section className="view-stack monthly-view" aria-label="Monthly">
    <div className="page-toolbar monthly-toolbar">
      <div className="page-title">
        <h1>Monthly</h1>
        {month && <span className="period-label">{formatMonthLabel(month)}</span>}
        <DateNavigator
          onPrev={() => moveMonth(-1)}
          onToday={jumpToCurrentMonth}
          onNext={() => moveMonth(1)}
          todayLabel="This Month"
          isCurrent={isCurrentMonth}
          prevLabel="Previous month"
          nextLabel="Next month"
          disabled={!month}
        />
      </div>

      <div className="monthly-toolbar-right">
        <SegmentedControl
          label="Calendar display mode"
          value={displayMode}
          options={DISPLAY_MODE_OPTIONS}
          onChange={handleDisplayModeChange}
        />

        <form className="monthly-create-bar" onSubmit={(event) => void submitQuickReminder(event)}>
          <input
            ref={quickInputRef}
            className="create-input monthly-create-input"
            value={quickTitle}
            readOnly={creatingQuick}
            aria-busy={creatingQuick}
            onChange={(event) => { setQuickTitle(event.target.value); if (quickError) setQuickError(null) }}
            onKeyDown={(event) => { if (event.key === 'Escape') { setQuickTitle(''); setQuickError(null) } }}
            placeholder="Add reminder… (N)"
            aria-label="New reminder title"
          />
          <input
            type="date"
            className="create-input monthly-create-date"
            value={quickDate}
            min={effectiveToday}
            disabled={creatingQuick}
            aria-label="Scheduled date"
            onChange={(event) => { setQuickDate(event.target.value); if (quickError) setQuickError(null) }}
          />
          <button type="submit" className="primary-button" disabled={creatingQuick || !quickTitle.trim() || !quickDate}>
            <PlusIcon size={14} /><span>{creatingQuick ? 'Adding…' : 'Add'}</span>
          </button>
        </form>
        {quickError && <span className="monthly-create-error" role="alert">{quickError}</span>}
      </div>
    </div>

    <div className="monthly-workspace">
      <div className="monthly-main">
        {calendar && overdueCount > 0 && <section className="monthly-overdue-card card" aria-label="Current overdue reminders">
          <div className="monthly-overdue-bar">
            <button
              type="button"
              className="monthly-overdue-trigger"
              aria-expanded={overdueExpanded}
              onClick={() => setOverdueExpanded((open) => !open)}
              title="Current unfinished reminders scheduled before today"
            >
              <ClockAlertIcon size={14} />
              <span className="monthly-overdue-title">Overdue Reminders</span>
              <span className="count-label overdue-count">{overdueCount}</span>
              <ChevronDownIcon size={13} style={{ transform: overdueExpanded ? 'rotate(180deg)' : undefined, transition: 'transform var(--transition-fast)' }} />
            </button>
            {!overdueExpanded && <div ref={overdueStripRef} className="monthly-overdue-strip">
              {visibleOverdue.map((item) => <MonthReminderRow
                key={`overdue-${item.reminder.id}`}
                item={item}
                today={effectiveToday}
                pendingKey={pendingKey}
                overdue
                onJumpToDate={selectDay}
                onAction={onAction}
              />)}
              {overdueLayout.hiddenCount > 0 && <button
                type="button"
                className={`overdue-more-btn ${visibleOverdue.length === 0 ? 'solo' : ''}`}
                onClick={() => setOverdueExpanded(true)}
                aria-label={visibleOverdue.length === 0
                  ? `Show all ${overdueCount} overdue reminders`
                  : `Show ${overdueLayout.hiddenCount} more overdue ${overdueLayout.hiddenCount === 1 ? 'reminder' : 'reminders'}`}
              >
                {visibleOverdue.length === 0 ? 'Show all' : `+${overdueLayout.hiddenCount} more`}
              </button>}
            </div>}
            {overdueExpanded && <button type="button" className="overdue-more-btn solo" onClick={() => setOverdueExpanded(false)}>Collapse</button>}
          </div>

          {overdueExpanded && <div className="monthly-overdue-drawer">
            {calendar.overdueReminders.map((item) => <MonthReminderRow
              key={`overdue-drawer-${item.reminder.id}`}
              item={item}
              today={effectiveToday}
              pendingKey={pendingKey}
              overdue
              inPanel
              showDeleteButton
              onJumpToDate={selectDay}
              onAction={onAction}
            />)}
          </div>}
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
                isSelected={activeDayDate === day.date}
                isLastRow={index >= (weekCount - 1) * 7}
                displayMode={displayMode}
                cellHeight={cellHeight}
                metrics={cellMetrics}
                pendingKey={pendingKey}
                onSelectDay={selectDay}
                onAction={onAction}
              />)}
            </div>
            <footer className="calendar-legend" aria-label="Calendar legend">
              <div className="calendar-legend-items">
                <span className="calendar-legend-item completed"><CheckIcon size={11} strokeWidth={2.4} />Completed Projects</span>
                <span className="calendar-legend-item progress"><TrendingUpIcon size={11} strokeWidth={2.1} />Project Progress</span>
                <span className="calendar-legend-item overdue"><ClockAlertIcon size={11} strokeWidth={2} />Overdue Reminders</span>
              </div>
              <span>
                {displayMode === 'both'
                  ? 'Showing planned & actual completion dates'
                  : displayMode === 'planned'
                    ? 'Showing scheduled dates only'
                    : 'Showing actual completions only · Switch to Planned/Both for active reminders'}
              </span>
            </footer>
          </div>}
        </div>
      </div>

      {activeDay && calendar && <DayDetailPanel
        day={activeDay}
        today={calendar.today}
        overdueReminders={activeDay.date === calendar.today ? calendar.overdueReminders : []}
        pendingKey={pendingKey}
        onStepDay={stepActiveDay}
        onSelectDate={selectDay}
        onOpenInWeekly={onOpenWeeklyDay}
        onOpenProjectDetail={onOpenProjectDetail}
        onAction={onAction}
        onClose={() => setActiveDayDate(null)}
      />}
    </div>
  </section>
}

function MonthDayCell({
  day,
  today,
  isSelected,
  isLastRow,
  displayMode,
  cellHeight,
  metrics,
  pendingKey,
  onSelectDay,
  onAction,
}: {
  day: MonthDayDto
  today: ISODate
  isSelected: boolean
  isLastRow: boolean
  displayMode: MonthlyDisplayMode
  cellHeight: number
  metrics: MonthCellMetrics
  pendingKey: string | null
  onSelectDay: (date: ISODate) => void
  onAction: ActionRunner
}) {
  const isToday = day.date === today
  const isPast = day.date < today
  const isWeekend = isWeekendDate(day.date)
  const dayNumber = Number(day.date.slice(-2))
  const dayLabel = dayNumber === 1 && !day.inCurrentMonth ? formatMonthDay(day.date) : String(dayNumber)
  const fullLabel = formatFullDate(day.date)
  const hasProjectStats = day.completedProjectCount > 0 || day.progressedProjectCount > 0
  const useInlineStats = metrics.inlineStats
  const hasSeparateStatsRow = hasProjectStats && !useInlineStats

  const allReminders = useMemo(
    () => getCellRemindersForDisplayMode(day, displayMode),
    [day, displayMode],
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
    onSelectDay(day.date)
  }

  const handleCellKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelectDay(day.date)
    }
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
      title={`${day.completedProjectCount} ${day.completedProjectCount === 1 ? 'project' : 'projects'} completed`}
    ><CheckIcon size={9} strokeWidth={2.5} />{day.completedProjectCount}</span>}
    {day.progressedProjectCount > 0 && <span
      className="month-stat progressed"
      title={`${day.progressedProjectCount} progress ${day.progressedProjectCount === 1 ? 'record' : 'records'}`}
    ><TrendingUpIcon size={9} strokeWidth={2.2} />{day.progressedProjectCount}</span>}
    {showReminderBadgeInStats && compactReminderBadge}
  </div> : null

  return <div
    role="gridcell"
    aria-selected={isSelected}
    className={`month-cell ${day.inCurrentMonth ? 'in-month' : 'outside-month'} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${isPast ? 'past' : ''} ${isWeekend ? 'weekend' : ''} ${isLastRow ? 'last-row' : ''}`}
    onClick={handleCellClick}
  >
    <div className="month-cell-header">
      <div className="month-cell-header-main">
        <button
          type="button"
          className="month-day-open"
          onClick={(event) => {
            event.stopPropagation()
            onSelectDay(day.date)
          }}
          onKeyDown={handleCellKeyDown}
          title={`Open details for ${fullLabel}`}
          aria-label={`Open details for ${fullLabel}${isToday ? ', today' : ''}`}
        >
          <time className="month-day-number" dateTime={day.date}>{dayLabel}</time>
        </button>
        {showReminderBadgeInHeader && compactReminderBadge}
      </div>
      {useInlineStats && projectStats}
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
          onSelectDay(day.date)
        }}
        aria-label={visibility.visibleCount === 0
          ? `Show ${allReminders.length} ${allReminders.length === 1 ? 'reminder' : 'reminders'} for ${fullLabel}`
          : `Show ${visibility.hiddenCount} more ${visibility.hiddenCount === 1 ? 'reminder' : 'reminders'} for ${fullLabel}`}
      >
        {visibility.visibleCount === 0
          ? `${allReminders.length} ${allReminders.length === 1 ? 'reminder' : 'reminders'}`
          : `+ ${visibility.hiddenCount} more`}
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
  today: ISODate
  showDateHint: boolean
  pendingKey: string | null
  onAction: ActionRunner
}) {
  const { reminder } = item
  const rowPrefix = `reminder:${reminder.id}:`
  const rowBusy = pendingKey?.startsWith(rowPrefix) ?? false
  const isOverdueItem = item.displayType === 'planned' && reminder.status === 'active' && reminder.scheduledDate < today

  const timing = describeReminderCompletionTiming(reminder)
  const dateHint = item.displayType === 'completed'
    ? (timing && timing.deltaDays !== 0 ? timing.shortLabel : `From ${formatShortDate(reminder.scheduledDate)}`)
    : item.displayType === 'planned' && reminder.status === 'completed' && !item.isPlannedAndCompletedSameDay && reminder.completedDate
      ? `Done ${formatShortDate(reminder.completedDate)}`
      : null

  const tooltip = timing
    ? `${reminder.title} — ${timing.label}`
    : reminder.title

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
    title={tooltip}
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
    {showDateHint && dateHint && <span className={`month-reminder-hint ${timing?.tone === 'early' ? 'tone-early' : ''}`}>{dateHint}</span>}
  </div>
}
