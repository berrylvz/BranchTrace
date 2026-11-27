import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api } from '../api'
import { CalendarMonthGrid } from '../components/CalendarMonthGrid'
import { CalendarRangeSummary } from '../components/CalendarRangeSummary'
import { DayDetailPanel } from '../components/DayDetailPanel'
import { CalendarDaysIcon, CalendarRangeIcon, PlusIcon } from '../components/icons'
import { OverdueRemindersBanner } from '../components/OverdueRemindersBanner'
import { DateNavigator, SegmentedControl } from '../components/ui'
import type { ActionRunner } from '../components/ui'
import { useGlobalShortcut, usePeriodNavigationShortcuts } from '../hooks/useGlobalShortcut'
import { loadMonthlyDisplayMode, saveMonthlyDisplayMode } from '../preferences'
import type { CalendarDisplayMode } from '../preferences'
import { REMINDER_KEYS } from '../query-keys'
import {
  buildRangePreset,
  normalizeDateRange,
  shiftDateRange,
  shiftRangeToLatest,
} from '../range-summary'
import type { DateRangeBounds, RangePresetId } from '../range-summary'
import type { DailyRangeDto, ISODate, MonthCalendarDto } from '../types'
import {
  addDays,
  formatDateRangeLabel,
  formatMonthLabel,
  getWeekStart,
  shiftMonth,
} from '../ui-format'

export type CalendarMode = 'month' | 'range'

const CALENDAR_MODE_OPTIONS: readonly { value: CalendarMode; label: string; icon: ReactNode; title: string }[] = [
  { value: 'month', label: 'Month', icon: <CalendarDaysIcon size={13} />, title: 'Monthly calendar & reminders (M)' },
  { value: 'range', label: 'Summary', icon: <CalendarRangeIcon size={13} />, title: 'Custom date range summary, up to 30 days (S)' },
]

const DISPLAY_MODE_OPTIONS: readonly { value: CalendarDisplayMode; label: string; title: string }[] = [
  { value: 'both', label: 'Both', title: 'Show planned dates and actual completion dates' },
  { value: 'planned', label: 'Planned', title: 'Show reminders on their scheduled date only' },
  { value: 'actual', label: 'Actual', title: 'Show completed reminders on their actual completion date' },
]

export function CalendarView({
  mode,
  calendar,
  rangeData,
  month,
  currentMonth,
  rangeBounds,
  today,
  weekStart,
  pendingKey,
  focusCreateTick,
  onModeChange,
  onMonthChange,
  onRangeChange,
  onOpenProjectDetail,
  onAction,
}: {
  mode: CalendarMode
  calendar: MonthCalendarDto | undefined
  rangeData: DailyRangeDto | undefined
  month: string
  currentMonth: string
  rangeBounds: DateRangeBounds
  today: ISODate
  weekStart: ISODate
  pendingKey: string | null
  focusCreateTick: number
  onModeChange: (next: CalendarMode) => void
  onMonthChange: (month: string) => void
  onRangeChange: (next: DateRangeBounds) => void
  onOpenProjectDetail: (projectId: string) => void
  onAction: ActionRunner
}) {
  const [quickTitle, setQuickTitle] = useState('')
  const [quickDate, setQuickDate] = useState(today)
  const [quickError, setQuickError] = useState<string | null>(null)
  const [displayMode, setDisplayMode] = useState<CalendarDisplayMode>(() => loadMonthlyDisplayMode())
  const [activeDayDate, setActiveDayDate] = useState<ISODate | null>(null)
  const [clampedNotice, setClampedNotice] = useState(false)

  const quickInputRef = useRef<HTMLInputElement>(null)

  const effectiveToday = (mode === 'month' ? calendar?.today : rangeData?.today) ?? today
  const overdueReminders = mode === 'month'
    ? (calendar?.overdueReminders ?? [])
    : (rangeData?.overdueReminders ?? [])

  useEffect(() => {
    setQuickDate((current) => (!current || current < effectiveToday ? effectiveToday : current))
  }, [effectiveToday])

  useEffect(() => {
    if (focusCreateTick > 0) quickInputRef.current?.focus({ preventScroll: true })
  }, [focusCreateTick])

  useEffect(() => {
    if (!clampedNotice) return
    const timer = window.setTimeout(() => setClampedNotice(false), 4000)
    return () => window.clearTimeout(timer)
  }, [clampedNotice])

  const activeMonthDay = useMemo(
    () => (activeDayDate && calendar ? calendar.days.find((day) => day.date === activeDayDate) ?? null : null),
    [activeDayDate, calendar],
  )
  const activeDailyDay = useMemo(
    () => (activeDayDate && rangeData ? rangeData.days.find((day) => day.date === activeDayDate) ?? null : null),
    [activeDayDate, rangeData],
  )

  const applyNormalizedRange = useCallback((nextStart: ISODate, nextEnd: ISODate, anchor: 'start' | 'end') => {
    const normalized = normalizeDateRange(nextStart, nextEnd, anchor)
    setClampedNotice(normalized.clamped)
    onRangeChange({ startDate: normalized.startDate, endDate: normalized.endDate })
  }, [onRangeChange])

  const handleApplyPreset = useCallback((preset: RangePresetId) => {
    setClampedNotice(false)
    onRangeChange(buildRangePreset(preset, effectiveToday, weekStart))
  }, [effectiveToday, weekStart, onRangeChange])

  const selectDay = useCallback((date: ISODate, options?: { shiftKey?: boolean }) => {
    if (options?.shiftKey && mode === 'month' && activeDayDate) {
      const start = activeDayDate <= date ? activeDayDate : date
      const end = activeDayDate <= date ? date : activeDayDate
      applyNormalizedRange(start, end, 'start')
      setActiveDayDate(null)
      onModeChange('range')
      return
    }
    setActiveDayDate(date)
    if (mode === 'month') {
      const targetMonth = date.slice(0, 7)
      if (targetMonth && targetMonth !== month) {
        onMonthChange(targetMonth)
      }
    }
    if (date >= effectiveToday) {
      setQuickDate(date)
    }
  }, [mode, activeDayDate, month, effectiveToday, applyNormalizedRange, onModeChange, onMonthChange])

  const stepActiveDay = useCallback((delta: number) => {
    if (!activeDayDate) return
    const nextDate = addDays(activeDayDate, delta)
    selectDay(nextDate)
  }, [activeDayDate, selectDay])

  const summarizeWeekForDate = useCallback((date: ISODate) => {
    const start = getWeekStart(date)
    setClampedNotice(false)
    onRangeChange({ startDate: start, endDate: addDays(start, 6) })
    onModeChange('range')
  }, [onRangeChange, onModeChange])

  const showDateInMonth = useCallback((date: ISODate) => {
    const targetMonth = date.slice(0, 7)
    if (targetMonth) onMonthChange(targetMonth)
    setActiveDayDate(date)
    onModeChange('month')
  }, [onMonthChange, onModeChange])

  const stepPeriod = useCallback((delta: number) => {
    if (mode === 'month') {
      if (!month) return
      onMonthChange(shiftMonth(month, delta))
      return
    }
    setClampedNotice(false)
    onRangeChange(shiftDateRange(rangeBounds.startDate, rangeBounds.endDate, delta < 0 ? -1 : 1))
  }, [mode, month, rangeBounds, onMonthChange, onRangeChange])

  const jumpToCurrentPeriod = useCallback(() => {
    if (mode === 'month') {
      if (!currentMonth) return
      onMonthChange(currentMonth)
      return
    }
    setClampedNotice(false)
    onRangeChange(shiftRangeToLatest(rangeBounds.startDate, rangeBounds.endDate, effectiveToday))
  }, [mode, currentMonth, rangeBounds, effectiveToday, onMonthChange, onRangeChange])

  usePeriodNavigationShortcuts(stepPeriod, jumpToCurrentPeriod)

  useGlobalShortcut((event) => {
    const lower = event.key.toLowerCase()
    if (lower === 'm') {
      event.preventDefault()
      onModeChange('month')
    } else if (lower === 's') {
      event.preventDefault()
      onModeChange('range')
    }
  })

  const handleDisplayModeChange = (next: CalendarDisplayMode) => {
    setDisplayMode(next)
    saveMonthlyDisplayMode(next)
  }

  const creatingQuick = pendingKey === 'calendar:quick-create'
  const isCurrentPeriod = mode === 'month'
    ? Boolean(month && currentMonth && month === currentMonth)
    : rangeBounds.endDate === effectiveToday

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
      { key: 'calendar:quick-create', invalidate: REMINDER_KEYS },
    )
    if (result.ok) {
      setQuickTitle('')
      if (mode === 'month') {
        const targetMonth = targetDate.slice(0, 7)
        if (targetMonth && targetMonth !== month) {
          onMonthChange(targetMonth)
        }
      }
      quickInputRef.current?.focus({ preventScroll: true })
    } else {
      setQuickError(result.message)
    }
  }

  const periodLabel = mode === 'month'
    ? (month ? formatMonthLabel(month) : '')
    : formatDateRangeLabel(rangeBounds.startDate, rangeBounds.endDate)

  return <section className="view-stack calendar-view" aria-label="Calendar">
    <div className="page-toolbar calendar-toolbar">
      <div className="page-title">
        <h1>Calendar</h1>
        <SegmentedControl
          label="Calendar view mode"
          value={mode}
          options={CALENDAR_MODE_OPTIONS}
          onChange={onModeChange}
        />
        {periodLabel && <span className="period-label">{periodLabel}</span>}
        <DateNavigator
          onPrev={() => stepPeriod(-1)}
          onToday={jumpToCurrentPeriod}
          onNext={() => stepPeriod(1)}
          todayLabel={mode === 'month' ? 'This Month' : 'Latest'}
          isCurrent={isCurrentPeriod}
          prevLabel={mode === 'month' ? 'Previous month' : 'Previous period'}
          nextLabel={mode === 'month' ? 'Next month' : 'Next period'}
          disabled={mode === 'month' ? !month : !rangeBounds.startDate}
        />
      </div>

      <div className="calendar-toolbar-right">
        {mode === 'month' && <SegmentedControl
          label="Calendar display mode"
          value={displayMode}
          options={DISPLAY_MODE_OPTIONS}
          onChange={handleDisplayModeChange}
        />}

        <form className="calendar-create-bar" onSubmit={(event) => void submitQuickReminder(event)}>
          <input
            ref={quickInputRef}
            className="create-input calendar-create-input"
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
            className="create-input calendar-create-date"
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
        {quickError && <span className="calendar-create-error" role="alert">{quickError}</span>}
      </div>
    </div>

    <div className="calendar-workspace">
      <div className="calendar-main">
        <OverdueRemindersBanner
          overdueReminders={overdueReminders}
          today={effectiveToday}
          pendingKey={pendingKey}
          onSelectDate={(date) => selectDay(date)}
          onAction={onAction}
        />

        {mode === 'month' ? <CalendarMonthGrid
          calendar={calendar}
          activeDayDate={activeDayDate}
          displayMode={displayMode}
          pendingKey={pendingKey}
          onSelectDay={selectDay}
          onAction={onAction}
        /> : <CalendarRangeSummary
          range={rangeData}
          startDate={rangeBounds.startDate}
          endDate={rangeBounds.endDate}
          today={effectiveToday}
          weekStart={weekStart}
          activeDayDate={activeDayDate}
          clampedNotice={clampedNotice}
          pendingKey={pendingKey}
          onRangeChange={applyNormalizedRange}
          onApplyPreset={handleApplyPreset}
          onSelectDay={(date) => selectDay(date)}
          onOpenProjectDetail={onOpenProjectDetail}
          onAction={onAction}
        />}
      </div>

      {activeDayDate && <DayDetailPanel
        date={activeDayDate}
        monthDay={activeMonthDay}
        dailyDay={activeDailyDay}
        today={effectiveToday}
        pendingKey={pendingKey}
        contextMode={mode}
        onStepDay={stepActiveDay}
        onSummarizeWeek={summarizeWeekForDate}
        onShowInMonth={showDateInMonth}
        onOpenProjectDetail={onOpenProjectDetail}
        onAction={onAction}
        onClose={() => setActiveDayDate(null)}
      />}
    </div>
  </section>
}
