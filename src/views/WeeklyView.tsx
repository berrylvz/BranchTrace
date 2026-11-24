import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockAlertIcon,
  ColumnsIcon,
  ListIcon,
  TrendingUpIcon,
} from '../components/icons'
import { Badge, DateNavigator, EmptyState, SegmentedControl, StatusIcon } from '../components/ui'
import { WeeklyOverview } from '../components/WeeklyOverview'
import { STATUS_TEXT } from '../constants'
import { usePeriodNavigationShortcuts } from '../hooks/useGlobalShortcut'
import {
  loadWeeklyHideEmpty,
  loadWeeklyViewMode,
  saveWeeklyHideEmpty,
  saveWeeklyViewMode,
} from '../preferences'
import type { WeeklyViewMode } from '../preferences'
import type { DailyDayDto, DailyWeekDto, ISODate, ProjectDailyItem, ReminderDailyItem } from '../types'
import {
  addDays,
  describeReminderCompletionTiming,
  formatFullDate,
  formatMonthDay,
  formatOverdueDuration,
  formatWeekdayShort,
  formatWeekRange,
  isWeekendDate,
} from '../ui-format'
import { extractWeeklyOverdue, formatProjectParentSummary } from '../weekly-summary'

const VIEW_MODE_OPTIONS: readonly { value: WeeklyViewMode; label: string; icon: ReactNode; title: string }[] = [
  { value: 'grid', label: 'Grid', icon: <ColumnsIcon size={13} />, title: '7-column week grid' },
  { value: 'timeline', label: 'Timeline', icon: <ListIcon size={13} />, title: 'Vertical daily timeline' },
]

function dayHasContent(day: DailyDayDto) {
  return day.completedProjects.length > 0
    || day.progressedProjects.length > 0
    || day.plannedReminders.length > 0
    || day.crossDayCompletedReminders.length > 0
}

export function WeeklyView({
  weekly,
  weekStart,
  currentWeekStart,
  focusedDate,
  focusDayTick,
  onWeekChange,
  onFocusDateChange,
  onOpenDetail,
  onOpenMonthlyDay,
}: {
  weekly: DailyWeekDto | undefined
  weekStart: ISODate
  currentWeekStart: ISODate
  focusedDate: ISODate | null
  focusDayTick: number
  onWeekChange: (value: ISODate) => void
  onFocusDateChange: (date: ISODate | null) => void
  onOpenDetail: (id: string) => void
  onOpenMonthlyDay: (date: ISODate) => void
}) {
  const [viewMode, setViewMode] = useState<WeeklyViewMode>(() => loadWeeklyViewMode())
  const [hideEmptyDays, setHideEmptyDays] = useState<boolean>(() => loadWeeklyHideEmpty())
  const [overdueExpanded, setOverdueExpanded] = useState(true)
  const [collapsedDays, setCollapsedDays] = useState<Record<string, boolean>>({})
  const containerRef = useRef<HTMLDivElement>(null)

  const overdueEntries = useMemo(() => (weekly ? extractWeeklyOverdue(weekly) : []), [weekly])

  useEffect(() => {
    if (!weekly) return
    const defaults: Record<string, boolean> = {}
    for (const day of weekly.days) {
      const isToday = day.date === weekly.today
      const isFocused = day.date === focusedDate
      defaults[day.date] = !(isToday || isFocused || dayHasContent(day))
    }
    setCollapsedDays(defaults)
  }, [weekly?.weekStart, focusedDate])

  const moveWeek = useCallback((amount: number) => {
    if (!weekStart) return
    onFocusDateChange(null)
    onWeekChange(addDays(weekStart, amount * 7))
  }, [weekStart, onWeekChange, onFocusDateChange])

  const jumpToCurrentWeek = useCallback(() => {
    if (!currentWeekStart) return
    onFocusDateChange(null)
    onWeekChange(currentWeekStart)
    window.requestAnimationFrame(() => {
      containerRef.current?.querySelector<HTMLElement>('.today')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
    })
  }, [currentWeekStart, onWeekChange, onFocusDateChange])

  const focusDay = useCallback((date: ISODate) => {
    onFocusDateChange(date)
    setCollapsedDays((prev) => ({ ...prev, [date]: false }))
    window.requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector<HTMLElement>(`[data-day-date="${date}"]`)
        ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
    })
  }, [onFocusDateChange])

  useEffect(() => {
    if (!weekly || !focusedDate) return
    if (!weekly.days.some((day) => day.date === focusedDate)) return
    const frame = window.requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector<HTMLElement>(`[data-day-date="${focusedDate}"]`)
        ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [weekly, focusedDate, focusDayTick, viewMode])

  usePeriodNavigationShortcuts(moveWeek, jumpToCurrentWeek)

  const handleViewModeChange = (next: WeeklyViewMode) => {
    setViewMode(next)
    saveWeeklyViewMode(next)
  }

  const handleHideEmptyChange = (checked: boolean) => {
    setHideEmptyDays(checked)
    saveWeeklyHideEmpty(checked)
  }

  const setAllTimelineCollapsed = (collapsed: boolean) => {
    if (!weekly) return
    const next: Record<string, boolean> = {}
    for (const day of weekly.days) next[day.date] = collapsed
    setCollapsedDays(next)
  }

  const weekEnd = weekStart ? addDays(weekStart, 6) : null
  const isCurrentWeek = Boolean(weekStart && currentWeekStart && weekStart === currentWeekStart)
  const timelineDays = useMemo(() => {
    if (!weekly) return []
    return hideEmptyDays ? weekly.days.filter((day) => dayHasContent(day) || day.date === weekly.today) : weekly.days
  }, [weekly, hideEmptyDays])
  const weekHasAnyActivity = useMemo(
    () => Boolean(weekly?.days.some(dayHasContent)),
    [weekly],
  )

  return <section className="view-stack daily-view" aria-label="Weekly">
    <div className="page-toolbar">
      <div className="page-title">
        <h1>Weekly</h1>
        {weekEnd && <span className="period-label">{formatWeekRange(weekStart, weekEnd)}</span>}
        <Badge tone="neutral">Read-only</Badge>
      </div>
      <div className="page-toolbar-actions">
        <SegmentedControl
          label="Weekly view mode"
          value={viewMode}
          options={VIEW_MODE_OPTIONS}
          onChange={handleViewModeChange}
        />
        <DateNavigator
          onPrev={() => moveWeek(-1)}
          onToday={jumpToCurrentWeek}
          onNext={() => moveWeek(1)}
          todayLabel="This Week"
          isCurrent={isCurrentWeek}
          prevLabel="Previous week"
          nextLabel="Next week"
          disabled={!weekStart}
        />
      </div>
    </div>

    {!weekly ? <div className="loading-state">Loading weekly overview…</div> : <>
      <WeeklyOverview weekly={weekly} onSelectDay={focusDay} />

      {overdueEntries.length > 0 && <section className="weekly-overdue-section" aria-label="Current overdue reminders">
        <button
          type="button"
          className="weekly-overdue-header"
          aria-expanded={overdueExpanded}
          onClick={() => setOverdueExpanded((open) => !open)}
        >
          <span className="weekly-overdue-header-left">
            <ClockAlertIcon size={15} />
            <span>Overdue Reminders</span>
            <span className="count-label overdue-count">{overdueEntries.length}</span>
          </span>
          <ChevronDownIcon size={14} style={{ transform: overdueExpanded ? 'rotate(180deg)' : undefined, transition: 'transform var(--transition-fast)' }} />
        </button>
        {overdueExpanded && <div className="weekly-overdue-list">
          {overdueEntries.map(({ item }) => <button
            key={`weekly-overdue-${item.reminder.id}`}
            type="button"
            className="weekly-overdue-item"
            title={`Planned for ${formatFullDate(item.reminder.scheduledDate)} · Open in Monthly view to manage`}
            onClick={() => onOpenMonthlyDay(item.reminder.scheduledDate)}
          >
            <span className="weekly-overdue-item-main">
              <StatusIcon status="active" overdue readOnly size="sm" label="Overdue reminder" />
              <span className="weekly-overdue-item-title">{item.reminder.title}</span>
            </span>
            <span className="weekly-overdue-item-meta">
              <span>Planned {formatMonthDay(item.reminder.scheduledDate)}</span>
              <Badge tone="overdue">{formatOverdueDuration(item.reminder.scheduledDate, weekly.today)}</Badge>
            </span>
          </button>)}
        </div>}
      </section>}

      {viewMode === 'grid' ? <div ref={containerRef} className="week-grid">
        {weekly.days.map((day) => <WeeklyGridColumn
          key={day.date}
          day={day}
          today={weekly.today}
          isSelected={focusedDate === day.date}
          onOpenDetail={onOpenDetail}
          onOpenMonthlyDay={onOpenMonthlyDay}
        />)}
      </div> : <div ref={containerRef} className="view-stack">
        <div className="timeline-controls-bar">
          <label className="timeline-toggle-label">
            <input type="checkbox" checked={hideEmptyDays} onChange={(event) => handleHideEmptyChange(event.target.checked)} />
            <span>Hide empty days</span>
          </label>
          <div className="tree-controls" role="group" aria-label="Timeline day controls">
            <button type="button" onClick={() => setAllTimelineCollapsed(false)}>Expand All</button>
            <button type="button" onClick={() => setAllTimelineCollapsed(true)}>Collapse All</button>
          </div>
        </div>

        {!weekHasAnyActivity && hideEmptyDays ? <div className="card">
          <EmptyState title="No activity recorded for this week." />
        </div> : <div className="weekly-timeline-list">
          {timelineDays.map((day) => <WeeklyTimelineDay
            key={day.date}
            day={day}
            today={weekly.today}
            isSelected={focusedDate === day.date}
            collapsed={Boolean(collapsedDays[day.date])}
            onToggle={() => setCollapsedDays((prev) => ({ ...prev, [day.date]: !prev[day.date] }))}
            onOpenDetail={onOpenDetail}
            onOpenMonthlyDay={onOpenMonthlyDay}
          />)}
        </div>}
      </div>}
    </>}
  </section>
}

function WeeklyGridColumn({
  day,
  today,
  isSelected,
  onOpenDetail,
  onOpenMonthlyDay,
}: {
  day: DailyDayDto
  today: ISODate
  isSelected: boolean
  onOpenDetail: (id: string) => void
  onOpenMonthlyDay: (date: ISODate) => void
}) {
  const plannedReminders = useMemo(
    () => [...day.plannedReminders].sort((a, b) => a.reminder.sortOrder - b.reminder.sortOrder || a.reminder.id.localeCompare(b.reminder.id)),
    [day.plannedReminders],
  )
  const isToday = day.date === today
  const isPast = day.date < today
  const isWeekend = isWeekendDate(day.date)
  const hasAny = dayHasContent(day)

  return <article
    data-day-date={day.date}
    className={`day-column ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${isPast ? 'past' : ''} ${isWeekend ? 'weekend' : ''}`}
    aria-label={formatFullDate(day.date)}
    aria-current={isSelected ? 'date' : undefined}
  >
    <header className="day-header">
      <div className="day-header-main">
        <span className="day-weekday">{formatWeekdayShort(day.date)}</span>
        <time dateTime={day.date}>{formatMonthDay(day.date)}</time>
      </div>
      <div className="day-header-badges">
        {isToday && <Badge tone="primary">Today</Badge>}
        {isSelected && !isToday && <Badge tone="completed">Selected</Badge>}
      </div>
    </header>
    <div className="day-body">
      <WeeklyDaySections
        day={day}
        today={today}
        plannedReminders={plannedReminders}
        onOpenDetail={onOpenDetail}
        onOpenMonthlyDay={onOpenMonthlyDay}
      />
      {!hasAny && <div className="day-empty-quiet" aria-label="No activity">—</div>}
    </div>
  </article>
}

function WeeklyTimelineDay({
  day,
  today,
  isSelected,
  collapsed,
  onToggle,
  onOpenDetail,
  onOpenMonthlyDay,
}: {
  day: DailyDayDto
  today: ISODate
  isSelected: boolean
  collapsed: boolean
  onToggle: () => void
  onOpenDetail: (id: string) => void
  onOpenMonthlyDay: (date: ISODate) => void
}) {
  const plannedReminders = useMemo(
    () => [...day.plannedReminders].sort((a, b) => a.reminder.sortOrder - b.reminder.sortOrder || a.reminder.id.localeCompare(b.reminder.id)),
    [day.plannedReminders],
  )
  const isToday = day.date === today
  const hasAny = dayHasContent(day)
  const reminderCount = plannedReminders.length + day.crossDayCompletedReminders.length

  return <article
    data-day-date={day.date}
    className={`timeline-day-card ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${!hasAny ? 'is-empty' : ''}`}
    aria-label={formatFullDate(day.date)}
    aria-current={isSelected ? 'date' : undefined}
  >
    <button
      type="button"
      className="timeline-day-header"
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      <div className="timeline-day-header-left">
        <ChevronRightIcon size={14} className={`tree-chevron ${!collapsed ? 'expanded' : ''}`} />
        <span className="timeline-day-date">{formatWeekdayShort(day.date)}, {formatMonthDay(day.date)}</span>
        {isToday && <Badge tone="primary">Today</Badge>}
        {isSelected && !isToday && <Badge tone="completed">Selected</Badge>}
      </div>
      <div className="timeline-day-summary">
        {day.completedProjects.length > 0 && <Badge tone="completed">{day.completedProjects.length} completed</Badge>}
        {day.progressedProjects.length > 0 && <Badge tone="progress">{day.progressedProjects.length} progress</Badge>}
        {reminderCount > 0 && <Badge tone="neutral">{reminderCount} {reminderCount === 1 ? 'reminder' : 'reminders'}</Badge>}
        {!hasAny && <span className="muted">No activity</span>}
      </div>
    </button>

    {!collapsed && <div className="timeline-day-body">
      {hasAny ? <WeeklyDaySections
        day={day}
        today={today}
        plannedReminders={plannedReminders}
        onOpenDetail={onOpenDetail}
        onOpenMonthlyDay={onOpenMonthlyDay}
      /> : <p className="muted">No activity recorded for this day.</p>}
    </div>}
  </article>
}

function WeeklyDaySections({
  day,
  today,
  plannedReminders,
  onOpenDetail,
  onOpenMonthlyDay,
}: {
  day: DailyDayDto
  today: ISODate
  plannedReminders: ReminderDailyItem[]
  onOpenDetail: (id: string) => void
  onOpenMonthlyDay: (date: ISODate) => void
}) {
  return <>
    {day.completedProjects.length > 0 && <section className="day-group tone-done">
      <h2 className="day-group-title"><CheckIcon size={11} strokeWidth={2.4} />Completed Projects</h2>
      {day.completedProjects.map((item) => <ProjectDailyRow key={item.projectId} item={item} onOpenDetail={onOpenDetail} completed />)}
    </section>}

    {day.progressedProjects.length > 0 && <section className="day-group tone-progress">
      <h2 className="day-group-title"><TrendingUpIcon size={11} strokeWidth={2.1} />Project Progress</h2>
      {day.progressedProjects.map((item) => <ProjectDailyRow key={item.projectId} item={item} onOpenDetail={onOpenDetail} />)}
    </section>}

    {plannedReminders.length > 0 && <section className="day-group tone-reminder">
      <h2 className="day-group-title">Scheduled Reminders</h2>
      {plannedReminders.map((item) => <ReadOnlyReminderRow
        key={`planned-${item.reminder.id}`}
        item={item}
        today={today}
        onOpenMonthlyDay={onOpenMonthlyDay}
      />)}
    </section>}

    {day.crossDayCompletedReminders.length > 0 && <section className="day-group tone-reminder">
      <h2 className="day-group-title">Completed from Other Dates</h2>
      {day.crossDayCompletedReminders.map((item) => <ReadOnlyReminderRow
        key={`cross-${item.reminder.id}`}
        item={item}
        today={today}
        onOpenMonthlyDay={onOpenMonthlyDay}
      />)}
    </section>}
  </>
}

function ProjectDailyRow({
  item,
  onOpenDetail,
  completed = false,
}: {
  item: ProjectDailyItem
  onOpenDetail: (id: string) => void
  completed?: boolean
}) {
  const parentSummary = formatProjectParentSummary(item.parentPath)
  const meta = [parentSummary, item.shortId].filter(Boolean).join(' · ')
  const fullPath = [...item.parentPath, item.title].join(' / ')

  return <button type="button" className="daily-item" onClick={() => onOpenDetail(item.projectId)} title={fullPath}>
    <span className="item-icon" aria-hidden="true">
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

function ReadOnlyReminderRow({
  item,
  today,
  onOpenMonthlyDay,
}: {
  item: ReminderDailyItem
  today: ISODate
  onOpenMonthlyDay: (date: ISODate) => void
}) {
  const { reminder } = item
  const isOverdueItem = item.displayType === 'planned' && reminder.status === 'active' && reminder.scheduledDate < today
  const timing = describeReminderCompletionTiming(reminder)

  const targetDate = item.displayType === 'completed' && reminder.completedDate
    ? reminder.completedDate
    : reminder.scheduledDate

  const meta = (() => {
    if (isOverdueItem) {
      return { text: formatOverdueDuration(reminder.scheduledDate, today), tone: 'overdue' as const }
    }
    if (reminder.status === 'canceled') {
      return { text: 'Canceled', tone: 'neutral' as const }
    }
    if (!timing) return null
    if (item.displayType === 'completed') {
      return {
        text: `Planned ${formatMonthDay(reminder.scheduledDate)} · ${timing.label}`,
        tone: timing.tone,
      }
    }
    if (item.displayType === 'planned' && !item.isPlannedAndCompletedSameDay && reminder.completedDate) {
      return {
        text: `Done ${formatMonthDay(reminder.completedDate)} · ${timing.label}`,
        tone: timing.tone,
      }
    }
    return { text: timing.label, tone: timing.tone }
  })()

  return <button
    type="button"
    className={`weekly-reminder-item ${reminder.status}`}
    title={`${reminder.title} — Open in Monthly view to edit`}
    onClick={() => onOpenMonthlyDay(targetDate)}
  >
    <StatusIcon
      status={reminder.status}
      overdue={isOverdueItem}
      readOnly
      size="sm"
      label={`Read-only status: ${isOverdueItem ? 'Overdue' : STATUS_TEXT[reminder.status]}`}
    />
    <span className="weekly-reminder-content">
      <span className="weekly-reminder-title">{reminder.title}</span>
      {meta && (meta.tone === 'overdue'
        ? <Badge tone="overdue">{meta.text}</Badge>
        : <span className={`weekly-reminder-meta ${meta.tone === 'early' ? 'tone-early' : ''}`}>{meta.text}</span>)}
    </span>
  </button>
}
