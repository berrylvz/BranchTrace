import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, MinusIcon, ProgressArrowIcon } from '../components/icons'
import { STATUS_TEXT } from '../constants'
import { usePeriodNavigationShortcuts } from '../hooks/useGlobalShortcut'
import type { DailyDayDto, DailyWeekDto, ProjectDailyItem, ReminderDailyItem } from '../types'
import {
  addDays,
  formatFullDate,
  formatMonthDay,
  formatShortDate,
  formatWeekdayShort,
  formatWeekRange,
  isWeekendDate,
} from '../ui-format'

export function WeeklyView({
  weekly,
  weekStart,
  currentWeekStart,
  focusedDate,
  focusDayTick,
  onWeekChange,
  onFocusDateChange,
  onOpenDetail,
}: {
  weekly: DailyWeekDto | undefined
  weekStart: string
  currentWeekStart: string
  focusedDate: string | null
  focusDayTick: number
  onWeekChange: (value: string) => void
  onFocusDateChange: (date: string | null) => void
  onOpenDetail: (id: string) => void
}) {
  const weekGridRef = useRef<HTMLDivElement>(null)

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
      weekGridRef.current?.querySelector<HTMLElement>('.day-column.today')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
    })
  }, [currentWeekStart, onWeekChange, onFocusDateChange])

  useEffect(() => {
    if (!weekly || !focusedDate) return
    if (!weekly.days.some((day) => day.date === focusedDate)) return
    const frame = window.requestAnimationFrame(() => {
      weekGridRef.current
        ?.querySelector<HTMLElement>(`[data-day-date="${focusedDate}"]`)
        ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [weekly, focusedDate, focusDayTick])

  usePeriodNavigationShortcuts(moveWeek, jumpToCurrentWeek)

  const weekEnd = weekStart ? addDays(weekStart, 6) : null
  const isCurrentWeek = Boolean(weekStart && currentWeekStart && weekStart === currentWeekStart)

  return <section className="view-stack daily-view" aria-label="Weekly">
    <div className="page-toolbar">
      <div className="page-title">
        <h1>Weekly</h1>
        {weekEnd && <span className="week-range">{formatWeekRange(weekStart, weekEnd)}</span>}
        <span className="readonly-badge">Read-only</span>
      </div>
      <div className="week-controls">
        <button type="button" disabled={!weekStart} onClick={() => moveWeek(-1)} aria-label="Previous week" title="Previous week (←)"><ArrowLeftIcon size={15} /></button>
        <button type="button" className={isCurrentWeek ? 'current-week' : ''} disabled={!currentWeekStart} onClick={jumpToCurrentWeek} title="Jump to this week (T)">This Week</button>
        <button type="button" disabled={!weekStart} onClick={() => moveWeek(1)} aria-label="Next week" title="Next week (→)"><ArrowRightIcon size={15} /></button>
      </div>
    </div>
    {!weekly ? <div className="loading-state">Loading weekly overview…</div> : <div ref={weekGridRef} className="week-grid">
      {weekly.days.map((day) => <WeeklyColumn
        key={day.date}
        day={day}
        today={weekly.today}
        isSelected={focusedDate === day.date}
        onOpenDetail={onOpenDetail}
      />)}
    </div>}
  </section>
}

function WeeklyColumn({
  day,
  today,
  isSelected,
  onOpenDetail,
}: {
  day: DailyDayDto
  today: string
  isSelected: boolean
  onOpenDetail: (id: string) => void
}) {
  const plannedReminders = [...day.plannedReminders].sort((a, b) => a.reminder.sortOrder - b.reminder.sortOrder || a.reminder.id.localeCompare(b.reminder.id))
  const isToday = day.date === today
  const isPast = day.date < today
  const isWeekend = isWeekendDate(day.date)
  const hasReminders = day.plannedReminders.length + day.overdueReminders.length + day.crossDayCompletedReminders.length > 0
  const hasProjects = day.completedProjects.length > 0 || day.progressedProjects.length > 0

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
        {isToday && <em className="today-pill">Today</em>}
        {isSelected && !isToday && <em className="selected-pill">Selected</em>}
      </div>
    </header>
    <div className="day-body">
      {day.completedProjects.length > 0 && <DayGroup title="Completed Projects" tone="done">{day.completedProjects.map((item) => <ProjectDailyRow key={item.projectId} item={item} onOpenDetail={onOpenDetail} completed />)}</DayGroup>}
      {day.progressedProjects.length > 0 && <DayGroup title="Project Progress" tone="progress">{day.progressedProjects.map((item) => <ProjectDailyRow key={item.projectId} item={item} onOpenDetail={onOpenDetail} />)}</DayGroup>}
      {hasReminders && <DayGroup title="Reminders" tone="reminder">
        {plannedReminders.map((item) => <ReadOnlyReminderRow key={`planned-${item.reminder.id}`} item={item} />)}
        {day.overdueReminders.length > 0 && <div className="subgroup-label">Overdue</div>}
        {day.overdueReminders.map((item) => <ReadOnlyReminderRow key={`overdue-${item.reminder.id}`} item={item} overdue />)}
        {day.crossDayCompletedReminders.length > 0 && <div className="subgroup-label">Completed from Earlier</div>}
        {day.crossDayCompletedReminders.map((item) => <ReadOnlyReminderRow key={`completed-${item.reminder.id}`} item={item} />)}
      </DayGroup>}
      {!hasProjects && !hasReminders && <div className="day-empty">No items</div>}
    </div>
  </article>
}

function DayGroup({ title, tone, children }: { title: string; tone: string; children: ReactNode }) {
  return <section className={`day-group ${tone}`}><h2>{title}</h2>{children}</section>
}

function ProjectDailyRow({ item, onOpenDetail, completed = false }: { item: ProjectDailyItem; onOpenDetail: (id: string) => void; completed?: boolean }) {
  const meta = [item.parentPath.join(' / '), item.shortId].filter(Boolean).join(' · ')
  return <button type="button" className="daily-item" onClick={() => onOpenDetail(item.projectId)} title={[...item.parentPath, item.title].join(' / ')}>
    <span className="item-icon" aria-hidden="true">{completed ? <CheckIcon size={13} strokeWidth={2.2} /> : <ProgressArrowIcon size={13} strokeWidth={2} />}</span>
    <span className="item-text">
      <span className="item-heading"><strong>{item.title}</strong>{completed && item.progressedSameDay && <span className="same-day-badge">Progressed same day</span>}</span>
      {meta && <small>{meta}</small>}
    </span>
  </button>
}

function ReadOnlyReminderRow({ item, overdue = false }: { item: ReminderDailyItem; overdue?: boolean }) {
  const { reminder } = item
  const dateHint = overdue
    ? null
    : item.displayType === 'completed'
      ? { text: `Planned ${formatShortDate(reminder.scheduledDate)}`, title: `Scheduled for ${reminder.scheduledDate}` }
      : item.displayType === 'planned' && reminder.status === 'completed' && !item.isPlannedAndCompletedSameDay && reminder.completedDate
        ? { text: `Done ${formatShortDate(reminder.completedDate)}`, title: `Completed on ${reminder.completedDate}` }
        : reminder.status === 'canceled'
          ? { text: 'Canceled', title: reminder.canceledDate ? `Canceled on ${reminder.canceledDate}` : 'Canceled' }
          : null

  return <div className={`reminder-row readonly ${reminder.status} ${overdue ? 'overdue' : ''}`}>
    <span
      className="reminder-check readonly-check"
      role="img"
      aria-label={`Status: ${STATUS_TEXT[reminder.status]}`}
      title={STATUS_TEXT[reminder.status]}
    >
      {reminder.status === 'completed' && <CheckIcon size={11} strokeWidth={2.4} />}
      {reminder.status === 'canceled' && <MinusIcon size={11} strokeWidth={2.2} />}
    </span>
    <div className="reminder-content">
      <span className="reminder-title" title={reminder.title}>{reminder.title}</span>
      {overdue && <span className="overdue-label" title={`Scheduled for ${reminder.scheduledDate}`}>Overdue · {formatShortDate(reminder.scheduledDate)}</span>}
      {dateHint && <span className="reminder-date-hint" title={dateHint.title}>{dateHint.text}</span>}
    </div>
  </div>
}
