import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  loadRangeBreakdownMode,
  loadRangeHideEmpty,
  saveRangeBreakdownMode,
  saveRangeHideEmpty,
} from '../preferences'
import type { RangeBreakdownMode } from '../preferences'
import {
  computeRangeSummary,
  detectRangePreset,
  formatProjectParentSummary,
  MAX_RANGE_DAYS,
} from '../range-summary'
import type { RangePresetId, RangeProjectBreakdownItem, RangeSummaryStats } from '../range-summary'
import type { DailyDayDto, DailyRangeDto, ISODate } from '../types'
import {
  daysBetween,
  formatFullDate,
  formatMonthDay,
  formatWeekdayShort,
} from '../ui-format'
import { MonthReminderRow } from './DayDetailPanel'
import {
  BranchNodeIcon,
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  ListIcon,
  ReminderIcon,
  TrendingUpIcon,
} from './icons'
import { ProjectDailyRow } from './ProjectDailyRow'
import { Badge, EmptyState, SegmentedControl, StatusIcon } from './ui'
import type { ActionRunner } from './ui'

const PRESETS: readonly { id: RangePresetId; label: string }[] = [
  { id: 'this-week', label: 'This Week' },
  { id: 'last-7', label: 'Last 7d' },
  { id: 'last-14', label: 'Last 14d' },
  { id: 'last-30', label: 'Last 30d' },
]

const BREAKDOWN_OPTIONS: readonly { value: RangeBreakdownMode; label: string; icon: ReactNode; title: string }[] = [
  { value: 'projects', label: 'By Project', icon: <BranchNodeIcon size={13} />, title: 'Aggregate projects and reminders across the selected range' },
  { value: 'days', label: 'By Day', icon: <ListIcon size={13} />, title: 'Inspect day-by-day activity timeline' },
]

function dayHasContent(day: DailyDayDto) {
  return day.completedProjects.length > 0
    || day.progressedProjects.length > 0
    || day.plannedReminders.length > 0
    || day.crossDayCompletedReminders.length > 0
}

export function CalendarRangeSummary({
  range,
  startDate,
  endDate,
  today,
  weekStart,
  activeDayDate,
  clampedNotice,
  pendingKey,
  onRangeChange,
  onApplyPreset,
  onSelectDay,
  onOpenProjectDetail,
  onAction,
}: {
  range: DailyRangeDto | undefined
  startDate: ISODate
  endDate: ISODate
  today: ISODate
  weekStart: ISODate
  activeDayDate: ISODate | null
  clampedNotice: boolean
  pendingKey: string | null
  onRangeChange: (nextStart: ISODate, nextEnd: ISODate, anchor: 'start' | 'end') => void
  onApplyPreset: (preset: RangePresetId) => void
  onSelectDay: (date: ISODate) => void
  onOpenProjectDetail: (projectId: string) => void
  onAction: ActionRunner
}) {
  const [breakdownMode, setBreakdownMode] = useState<RangeBreakdownMode>(() => loadRangeBreakdownMode())
  const [hideEmptyDays, setHideEmptyDays] = useState<boolean>(() => loadRangeHideEmpty())
  const [collapsedDays, setCollapsedDays] = useState<Record<string, boolean>>({})
  const timelineRef = useRef<HTMLDivElement>(null)

  const dayCount = startDate && endDate ? Math.max(1, daysBetween(startDate, endDate) + 1) : 0
  const activePreset = useMemo(
    () => (startDate && endDate && today && weekStart ? detectRangePreset(startDate, endDate, today, weekStart) : null),
    [startDate, endDate, today, weekStart],
  )
  const stats = useMemo(() => (range ? computeRangeSummary(range) : null), [range])

  useEffect(() => {
    if (!range) return
    const defaults: Record<string, boolean> = {}
    const shouldCompact = range.days.length > 14
    for (const day of range.days) {
      const isToday = day.date === range.today
      const isFocused = day.date === activeDayDate
      const hasContent = dayHasContent(day)
      defaults[day.date] = shouldCompact
        ? !(isToday || isFocused)
        : !(isToday || isFocused || hasContent)
    }
    setCollapsedDays(defaults)
  }, [range?.startDate, range?.endDate])

  const handleBreakdownChange = (next: RangeBreakdownMode) => {
    setBreakdownMode(next)
    saveRangeBreakdownMode(next)
  }

  const handleHideEmptyChange = (checked: boolean) => {
    setHideEmptyDays(checked)
    saveRangeHideEmpty(checked)
  }

  const setAllCollapsed = (collapsed: boolean) => {
    if (!range) return
    const next: Record<string, boolean> = {}
    for (const day of range.days) next[day.date] = collapsed
    setCollapsedDays(next)
  }

  const handleChartSelectDay = (date: ISODate) => {
    onSelectDay(date)
    if (breakdownMode === 'days') {
      setCollapsedDays((prev) => ({ ...prev, [date]: false }))
      window.requestAnimationFrame(() => {
        timelineRef.current
          ?.querySelector<HTMLElement>(`[data-day-date="${date}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    }
  }

  const timelineDays = useMemo(() => {
    if (!range) return []
    return hideEmptyDays ? range.days.filter((day) => dayHasContent(day) || day.date === range.today) : range.days
  }, [range, hideEmptyDays])

  const hasAnyRangeDayActivity = useMemo(
    () => Boolean(range?.days.some(dayHasContent)),
    [range],
  )

  return <div className="calendar-range-scroll">
    <section className="calendar-range-bar card" aria-label="Date range controls">
      <div className="range-picker-group">
        <label className="range-date-field">
          <span>From</span>
          <input
            type="date"
            className="create-input range-date-input"
            value={startDate}
            aria-label="Range start date"
            onChange={(event) => {
              if (event.target.value) onRangeChange(event.target.value, endDate, 'start')
            }}
          />
        </label>
        <span className="range-picker-sep" aria-hidden="true">–</span>
        <label className="range-date-field">
          <span>To</span>
          <input
            type="date"
            className="create-input range-date-input"
            value={endDate}
            aria-label="Range end date"
            onChange={(event) => {
              if (event.target.value) onRangeChange(startDate, event.target.value, 'end')
            }}
          />
        </label>
        <Badge tone={dayCount >= MAX_RANGE_DAYS ? 'primary' : 'neutral'}>
          {dayCount} {dayCount === 1 ? 'day' : 'days'}{dayCount >= MAX_RANGE_DAYS ? ' (max)' : ''}
        </Badge>
        {clampedNotice && <span className="range-clamped-hint" role="status">Max span is {MAX_RANGE_DAYS} days</span>}
      </div>

      <div className="range-preset-group" role="group" aria-label="Quick date range presets">
        {PRESETS.map((preset) => <button
          key={preset.id}
          type="button"
          className={`filter-chip ${activePreset === preset.id ? 'active' : ''}`}
          aria-pressed={activePreset === preset.id}
          onClick={() => onApplyPreset(preset.id)}
        >{preset.label}</button>)}
      </div>
    </section>

    {!range || !stats ? <div className="card"><div className="loading-state">Loading range summary…</div></div> : <>
      <RangeOverviewCard
        stats={stats}
        activeDayDate={activeDayDate}
        onSelectDay={handleChartSelectDay}
      />

      <div className="range-breakdown-bar">
        <SegmentedControl
          label="Range breakdown view"
          value={breakdownMode}
          options={BREAKDOWN_OPTIONS}
          onChange={handleBreakdownChange}
        />
        {breakdownMode === 'days' && <div className="range-timeline-controls">
          <label className="timeline-toggle-label">
            <input type="checkbox" checked={hideEmptyDays} onChange={(event) => handleHideEmptyChange(event.target.checked)} />
            <span>Hide empty days</span>
          </label>
          <div className="tree-controls" role="group" aria-label="Timeline day controls">
            <button type="button" onClick={() => setAllCollapsed(false)}>Expand All</button>
            <button type="button" onClick={() => setAllCollapsed(true)}>Collapse All</button>
          </div>
        </div>}
      </div>

      {breakdownMode === 'projects' ? <RangeProjectBreakdownView
        range={range}
        stats={stats}
        pendingKey={pendingKey}
        onSelectDay={onSelectDay}
        onOpenProjectDetail={onOpenProjectDetail}
        onAction={onAction}
      /> : <div ref={timelineRef} className="range-timeline-wrap">
        {!hasAnyRangeDayActivity && hideEmptyDays ? <div className="card">
          <EmptyState title="No activity recorded in this period." />
        </div> : <div className="weekly-timeline-list">
          {timelineDays.map((day) => <RangeTimelineDayCard
            key={day.date}
            day={day}
            today={range.today}
            isSelected={activeDayDate === day.date}
            collapsed={Boolean(collapsedDays[day.date])}
            pendingKey={pendingKey}
            onToggle={() => setCollapsedDays((prev) => ({ ...prev, [day.date]: !prev[day.date] }))}
            onSelectDay={onSelectDay}
            onOpenProjectDetail={onOpenProjectDetail}
            onAction={onAction}
          />)}
        </div>}
      </div>}
    </>}
  </div>
}

function RangeOverviewCard({
  stats,
  activeDayDate,
  onSelectDay,
}: {
  stats: RangeSummaryStats
  activeDayDate: ISODate | null
  onSelectDay: (date: ISODate) => void
}) {
  const maxDaily = useMemo(
    () => Math.max(1, ...stats.dailyActivity.map((day) => day.totalProjectCount)),
    [stats.dailyActivity],
  )
  const totalDays = stats.dailyActivity.length
  const spanClass = totalDays > 16 ? 'span-compact' : totalDays > 10 ? 'span-medium' : 'span-wide'
  const tickStep = totalDays > 22 ? 3 : totalDays > 16 ? 2 : 1

  const timingParts = [
    stats.reminderTiming.onTime > 0 ? `${stats.reminderTiming.onTime} on time` : null,
    stats.reminderTiming.early > 0 ? `${stats.reminderTiming.early} early` : null,
    stats.reminderTiming.late > 0 ? `${stats.reminderTiming.late} late` : null,
  ].filter(Boolean)

  const activeDaysTitle = stats.elapsedDays < stats.totalDays
    ? `${stats.activeDaysCount} active days out of ${stats.elapsedDays} elapsed days (${stats.totalDays}-day range)`
    : `${stats.activeDaysCount} active days out of ${stats.totalDays} days`

  return <section className="range-overview card" aria-label="Period summary">
    <div className="range-metrics-grid">
      <div className="weekly-metric tone-completed">
        <span className="weekly-metric-value">{stats.completedProjectsCount}</span>
        <span className="weekly-metric-label">Completed Projects</span>
      </div>
      <div className="weekly-metric tone-progress">
        <span className="weekly-metric-value">{stats.progressLogsCount}</span>
        <span className="weekly-metric-label">Progress Logs</span>
      </div>
      <div className="weekly-metric" title={activeDaysTitle}>
        <span className="weekly-metric-value">{stats.activeDaysCount} / {stats.totalDays}</span>
        <span className="weekly-metric-label">Active Days</span>
      </div>
      <div className="weekly-metric">
        <span className="weekly-metric-value">{stats.uniqueActiveProjectsCount}</span>
        <span className="weekly-metric-label">Active Projects</span>
      </div>
      <div className="weekly-metric" title={timingParts.length > 0 ? timingParts.join(' · ') : undefined}>
        <span className="weekly-metric-value">{stats.remindersDoneCount}</span>
        <span className="weekly-metric-label">Reminders Done</span>
      </div>
      <div className="weekly-metric">
        <span className="weekly-metric-value">{stats.remindersUpcomingCount}</span>
        <span className="weekly-metric-label">Upcoming</span>
      </div>
    </div>

    <div className="range-chart-section">
      <div className="range-chart-header">
        <span className="range-chart-title">Daily Project Activity</span>
        <div className="range-chart-legend" aria-hidden="true">
          <span className="range-legend-item"><span className="range-legend-dot completed" />Completed</span>
          <span className="range-legend-item"><span className="range-legend-dot progress" />Progress</span>
        </div>
      </div>
      <div className={`range-chart ${spanClass}`} role="group" aria-label="Daily project activity distribution">
        {stats.dailyActivity.map((day, index) => {
          const completedPct = day.completedCount > 0 ? Math.max(14, Math.round((day.completedCount / maxDaily) * 100)) : 0
          const progressPct = day.progressCount > 0 ? Math.max(14, Math.round((day.progressCount / maxDaily) * 100)) : 0
          const isSelected = activeDayDate === day.date
          const showLabel = tickStep === 1
            || index === 0
            || index === totalDays - 1
            || day.isToday
            || isSelected
            || index % tickStep === 0
          const labelText = totalDays <= 10
            ? `${day.weekday} ${day.dayNumber}`
            : String(day.dayNumber)
          const tooltip = day.isFuture
            ? `${formatFullDate(day.date)} · Upcoming`
            : `${formatFullDate(day.date)} · ${day.completedCount} completed, ${day.progressCount} progress ${day.progressCount === 1 ? 'log' : 'logs'}${day.remindersDoneCount > 0 ? `, ${day.remindersDoneCount} reminders done` : ''}`

          return <button
            key={day.date}
            type="button"
            className={`range-chart-col ${day.isToday ? 'is-today' : ''} ${day.isFuture ? 'is-future' : ''} ${day.isWeekend ? 'is-weekend' : ''} ${isSelected ? 'is-selected' : ''}`}
            title={tooltip}
            aria-label={tooltip}
            aria-pressed={isSelected}
            onClick={() => onSelectDay(day.date)}
          >
            <span className="range-chart-track" aria-hidden="true">
              {day.completedCount > 0 && <span className="daily-chart-bar completed" style={{ height: `${completedPct}%` }} />}
              {day.progressCount > 0 && <span className="daily-chart-bar progress" style={{ height: `${progressPct}%` }} />}
            </span>
            <span className={`range-chart-label ${showLabel ? '' : 'is-hidden'}`} aria-hidden={!showLabel}>
              {showLabel ? labelText : ''}
            </span>
          </button>
        })}
      </div>
    </div>
  </section>
}

function RangeProjectBreakdownView({
  range,
  stats,
  pendingKey,
  onSelectDay,
  onOpenProjectDetail,
  onAction,
}: {
  range: DailyRangeDto
  stats: RangeSummaryStats
  pendingKey: string | null
  onSelectDay: (date: ISODate) => void
  onOpenProjectDetail: (projectId: string) => void
  onAction: ActionRunner
}) {
  const { reminderGroups } = stats
  const totalReminders = reminderGroups.upcoming.length
    + reminderGroups.overdueInRange.length
    + reminderGroups.completed.length
    + reminderGroups.canceled.length
  const hasAny = stats.completedProjects.length > 0 || stats.projectBreakdown.length > 0 || totalReminders > 0

  if (!hasAny) {
    return <div className="card">
      <EmptyState
        title="No activity recorded in this period."
        description="Choose another date range, log progress in Projects, or add a reminder above."
      />
    </div>
  }

  return <div className="range-summary-sections">
    {stats.completedProjects.length > 0 && <section className="range-section card">
      <header className="range-section-header">
        <div className="range-section-title tone-completed">
          <CheckIcon size={14} strokeWidth={2.4} />
          <h2>Completed Projects</h2>
          <span className="count-label">{stats.completedProjects.length}</span>
        </div>
      </header>
      <div className="range-completed-grid">
        {stats.completedProjects.map((item) => <ProjectDailyRow
          key={`${item.projectId}-${item.completedDate}`}
          item={{
            projectId: item.projectId,
            title: item.title,
            parentPath: item.parentPath,
            shortId: item.shortId,
            status: 'completed',
            progressedSameDay: item.progressedSameDay,
          }}
          completed
          dateBadge={formatMonthDay(item.completedDate)}
          onOpenProjectDetail={onOpenProjectDetail}
        />)}
      </div>
    </section>}

    {stats.projectBreakdown.length > 0 && <section className="range-section card">
      <header className="range-section-header">
        <div className="range-section-title tone-progress">
          <TrendingUpIcon size={14} strokeWidth={2.1} />
          <h2>Project Activity Breakdown</h2>
          <span className="count-label">{stats.projectBreakdown.length}</span>
        </div>
        <span className="range-section-caption">
          {formatMonthDay(range.startDate)} – {formatMonthDay(range.endDate)}
        </span>
      </header>
      <div className="range-project-list">
        {stats.projectBreakdown.map((item) => <RangeProjectStripRow
          key={item.projectId}
          item={item}
          days={range.days}
          today={range.today}
          onOpenProjectDetail={onOpenProjectDetail}
        />)}
      </div>
    </section>}

    {totalReminders > 0 && <section className="range-section card">
      <header className="range-section-header">
        <div className="range-section-title">
          <ReminderIcon size={14} strokeWidth={2} />
          <h2>Reminders in Period</h2>
          <span className="count-label">{totalReminders}</span>
        </div>
        <div className="range-reminder-badges">
          {stats.reminderTiming.onTime > 0 && <Badge tone="completed">{stats.reminderTiming.onTime} on time</Badge>}
          {stats.reminderTiming.early > 0 && <Badge tone="completed">{stats.reminderTiming.early} early</Badge>}
          {stats.reminderTiming.late > 0 && <Badge tone="neutral">{stats.reminderTiming.late} late</Badge>}
          {reminderGroups.upcoming.length > 0 && <Badge tone="primary">{reminderGroups.upcoming.length} upcoming</Badge>}
          {reminderGroups.overdueInRange.length > 0 && <Badge tone="overdue">{reminderGroups.overdueInRange.length} overdue</Badge>}
          {reminderGroups.canceled.length > 0 && <Badge tone="canceled">{reminderGroups.canceled.length} canceled</Badge>}
        </div>
      </header>

      <div className="range-reminder-groups">
        {reminderGroups.overdueInRange.length > 0 && <div className="range-reminder-group">
          <h3 className="range-subgroup-title tone-overdue">Overdue in Range ({reminderGroups.overdueInRange.length})</h3>
          <div className="day-panel-items">
            {reminderGroups.overdueInRange.map((item) => <MonthReminderRow
              key={`range-overdue-${item.reminder.id}`}
              item={item}
              today={range.today}
              pendingKey={pendingKey}
              inPanel
              showDeleteButton
              dateLink={{
                date: item.reminder.scheduledDate,
                label: formatMonthDay(item.reminder.scheduledDate),
                title: `Scheduled for ${formatFullDate(item.reminder.scheduledDate)} · Open day details`,
              }}
              onJumpToDate={onSelectDay}
              onAction={onAction}
            />)}
          </div>
        </div>}

        {reminderGroups.upcoming.length > 0 && <div className="range-reminder-group">
          <h3 className="range-subgroup-title">Scheduled ({reminderGroups.upcoming.length})</h3>
          <div className="day-panel-items">
            {reminderGroups.upcoming.map((item) => <MonthReminderRow
              key={`range-upcoming-${item.reminder.id}`}
              item={item}
              today={range.today}
              pendingKey={pendingKey}
              inPanel
              showDeleteButton
              dateLink={{
                date: item.reminder.scheduledDate,
                label: formatMonthDay(item.reminder.scheduledDate),
                title: `Scheduled for ${formatFullDate(item.reminder.scheduledDate)} · Open day details`,
              }}
              onJumpToDate={onSelectDay}
              onAction={onAction}
            />)}
          </div>
        </div>}

        {reminderGroups.completed.length > 0 && <div className="range-reminder-group">
          <h3 className="range-subgroup-title tone-completed">Completed ({reminderGroups.completed.length})</h3>
          <div className="day-panel-items">
            {reminderGroups.completed.map((item) => {
              const targetDate = item.reminder.completedDate ?? item.reminder.scheduledDate
              return <MonthReminderRow
                key={`range-completed-${item.reminder.id}`}
                item={item}
                today={range.today}
                pendingKey={pendingKey}
                inPanel
                showDeleteButton
                dateLink={{
                  date: targetDate,
                  label: formatMonthDay(targetDate),
                  title: `Completed on ${formatFullDate(targetDate)} · Open day details`,
                }}
                onJumpToDate={onSelectDay}
                onAction={onAction}
              />
            })}
          </div>
        </div>}

        {reminderGroups.canceled.length > 0 && <div className="range-reminder-group">
          <h3 className="range-subgroup-title">Canceled ({reminderGroups.canceled.length})</h3>
          <div className="day-panel-items">
            {reminderGroups.canceled.map((item) => <MonthReminderRow
              key={`range-canceled-${item.reminder.id}`}
              item={item}
              today={range.today}
              pendingKey={pendingKey}
              inPanel
              showDeleteButton
              dateLink={{
                date: item.reminder.scheduledDate,
                label: formatMonthDay(item.reminder.scheduledDate),
                title: `Scheduled for ${formatFullDate(item.reminder.scheduledDate)} · Open day details`,
              }}
              onJumpToDate={onSelectDay}
              onAction={onAction}
            />)}
          </div>
        </div>}
      </div>
    </section>}
  </div>
}

function RangeProjectStripRow({
  item,
  days,
  today,
  onOpenProjectDetail,
}: {
  item: RangeProjectBreakdownItem
  days: DailyDayDto[]
  today: ISODate
  onOpenProjectDetail: (projectId: string) => void
}) {
  const progressSet = useMemo(() => new Set(item.progressDates), [item.progressDates])
  const parentSummary = formatProjectParentSummary(item.parentPath)
  const meta = [parentSummary, item.shortId].filter(Boolean).join(' · ')
  const fullPath = [...item.parentPath, item.title].join(' / ')

  return <button
    type="button"
    className="range-project-row"
    onClick={() => onOpenProjectDetail(item.projectId)}
    title={fullPath}
  >
    <div className="range-project-info">
      <StatusIcon status={item.status} size="sm" />
      <div className="range-project-text">
        <span className="range-project-heading">
          <strong>{item.title}</strong>
          {item.completedDate && <Badge tone="completed">Done {formatMonthDay(item.completedDate)}</Badge>}
        </span>
        {meta && <small>{meta}</small>}
      </div>
    </div>
    <div className="range-project-activity">
      <div className="range-project-strip" aria-hidden="true">
        {days.map((day) => {
          const isFuture = day.date > today
          const isCompletedDay = item.completedDate === day.date
          const hasProgress = progressSet.has(day.date)
          const cellClass = isFuture
            ? 'is-future'
            : isCompletedDay
              ? 'is-completed'
              : hasProgress
                ? 'is-progress'
                : 'is-empty'
          const cellTitle = isCompletedDay
            ? `${formatFullDate(day.date)} · Completed${hasProgress ? ' & Progressed' : ''}`
            : hasProgress
              ? `${formatFullDate(day.date)} · Progressed`
              : `${formatFullDate(day.date)} · No activity`
          return <span
            key={day.date}
            className={`range-strip-cell ${cellClass} ${day.date === today ? 'is-today' : ''}`}
            title={cellTitle}
          />
        })}
      </div>
      <span className="range-project-days" title={`${item.activeDayCount} active ${item.activeDayCount === 1 ? 'day' : 'days'} in range`}>
        {item.activeDayCount}d
      </span>
    </div>
  </button>
}

function RangeTimelineDayCard({
  day,
  today,
  isSelected,
  collapsed,
  pendingKey,
  onToggle,
  onSelectDay,
  onOpenProjectDetail,
  onAction,
}: {
  day: DailyDayDto
  today: ISODate
  isSelected: boolean
  collapsed: boolean
  pendingKey: string | null
  onToggle: () => void
  onSelectDay: (date: ISODate) => void
  onOpenProjectDetail: (projectId: string) => void
  onAction: ActionRunner
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
    <div className="timeline-day-header-row">
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
      <button
        type="button"
        className="icon-button timeline-day-panel-btn"
        onClick={() => onSelectDay(day.date)}
        aria-label={`Open day panel for ${formatFullDate(day.date)}`}
        title="Open day panel (add or reorder reminders)"
      ><CalendarIcon size={13} /></button>
    </div>

    {!collapsed && <div className="timeline-day-body">
      {hasAny ? <>
        {day.completedProjects.length > 0 && <section className="day-group tone-done">
          <h2 className="day-group-title"><CheckIcon size={11} strokeWidth={2.4} />Completed Projects</h2>
          {day.completedProjects.map((item) => <ProjectDailyRow
            key={item.projectId}
            item={item}
            completed
            onOpenProjectDetail={onOpenProjectDetail}
          />)}
        </section>}

        {day.progressedProjects.length > 0 && <section className="day-group tone-progress">
          <h2 className="day-group-title"><TrendingUpIcon size={11} strokeWidth={2.1} />Project Progress</h2>
          {day.progressedProjects.map((item) => <ProjectDailyRow
            key={item.projectId}
            item={item}
            onOpenProjectDetail={onOpenProjectDetail}
          />)}
        </section>}

        {plannedReminders.length > 0 && <section className="day-group tone-reminder">
          <h2 className="day-group-title">Scheduled Reminders</h2>
          <div className="day-panel-items">
            {plannedReminders.map((item) => <MonthReminderRow
              key={`timeline-planned-${item.reminder.id}`}
              item={item}
              today={today}
              pendingKey={pendingKey}
              inPanel
              showDeleteButton
              onAction={onAction}
            />)}
          </div>
        </section>}

        {day.crossDayCompletedReminders.length > 0 && <section className="day-group tone-reminder">
          <h2 className="day-group-title">Completed from Other Dates</h2>
          <div className="day-panel-items">
            {day.crossDayCompletedReminders.map((item) => <MonthReminderRow
              key={`timeline-cross-${item.reminder.id}`}
              item={item}
              today={today}
              pendingKey={pendingKey}
              inPanel
              showDeleteButton
              onAction={onAction}
            />)}
          </div>
        </section>}
      </> : <p className="muted">No activity recorded for this day.</p>}
    </div>}
  </article>
}
