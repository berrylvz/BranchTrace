import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react'
import { api } from '../api'
import { STATUS_TEXT } from '../constants'
import {
  computeCellReminderVisibility,
  computeMonthCellMetrics,
  getCellRemindersForDisplayMode,
  getMonthWeekCount,
} from '../monthly-layout'
import type { MonthCellMetrics } from '../monthly-layout'
import type { CalendarDisplayMode } from '../preferences'
import { REMINDER_KEYS } from '../query-keys'
import type { ISODate, MonthCalendarDto, MonthDayDto, ReminderDailyItem } from '../types'
import {
  describeReminderCompletionTiming,
  formatFullDate,
  formatMonthDay,
  formatMonthLabel,
  formatShortDate,
  isWeekendDate,
  WEEKDAYS,
} from '../ui-format'
import {
  CheckIcon,
  ClockAlertIcon,
  MinusIcon,
  ReminderIcon,
  TrendingUpIcon,
} from './icons'
import type { ActionRunner } from './ui'

export function CalendarMonthGrid({
  calendar,
  activeDayDate,
  displayMode,
  pendingKey,
  onSelectDay,
  onAction,
}: {
  calendar: MonthCalendarDto | undefined
  activeDayDate: ISODate | null
  displayMode: CalendarDisplayMode
  pendingKey: string | null
  onSelectDay: (date: ISODate, options?: { shiftKey?: boolean }) => void
  onAction: ActionRunner
}) {
  const [gridSize, setGridSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const monthGridRef = useRef<HTMLDivElement>(null)
  const hasCalendar = Boolean(calendar)

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

  const weekCount = getMonthWeekCount(calendar?.days.length ?? 0)
  const cellWidth = gridSize.width > 0 ? gridSize.width / 7 : 0
  const cellHeight = gridSize.height > 0 ? gridSize.height / weekCount : 0
  const cellMetrics = useMemo(() => computeMonthCellMetrics(cellWidth, cellHeight), [cellWidth, cellHeight])

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

  return <div className="month-calendar-card card">
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
          onSelectDay={onSelectDay}
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
            ? 'Shift+click two days for range summary · Showing planned & actual dates'
            : displayMode === 'planned'
              ? 'Shift+click two days for range summary · Showing scheduled dates only'
              : 'Showing actual completions only · Switch to Planned/Both for active reminders'}
        </span>
      </footer>
    </div>}
  </div>
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
  displayMode: CalendarDisplayMode
  cellHeight: number
  metrics: MonthCellMetrics
  pendingKey: string | null
  onSelectDay: (date: ISODate, options?: { shiftKey?: boolean }) => void
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
    onSelectDay(day.date, { shiftKey: event.shiftKey })
  }

  const handleCellKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelectDay(day.date, { shiftKey: event.shiftKey })
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
            onSelectDay(day.date, { shiftKey: event.shiftKey })
          }}
          onKeyDown={handleCellKeyDown}
          title={`Open details for ${fullLabel} (Shift+click to summarize range)`}
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
