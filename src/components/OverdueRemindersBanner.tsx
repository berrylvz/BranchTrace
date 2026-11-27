import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { computeOverdueStripLayout } from '../monthly-layout'
import type { ISODate, ReminderDailyItem } from '../types'
import { MonthReminderRow } from './DayDetailPanel'
import { ChevronDownIcon, ClockAlertIcon } from './icons'
import type { ActionRunner } from './ui'

export function OverdueRemindersBanner({
  overdueReminders,
  today,
  pendingKey,
  onSelectDate,
  onAction,
}: {
  overdueReminders: ReminderDailyItem[]
  today: ISODate
  pendingKey: string | null
  onSelectDate: (date: ISODate) => void
  onAction: ActionRunner
}) {
  const [expanded, setExpanded] = useState(false)
  const [stripWidth, setStripWidth] = useState(0)
  const stripRef = useRef<HTMLDivElement>(null)
  const overdueCount = overdueReminders.length

  useEffect(() => {
    if (overdueCount === 0) setExpanded(false)
  }, [overdueCount])

  useLayoutEffect(() => {
    const element = stripRef.current
    if (!element) return
    const update = (width: number) => {
      const nextWidth = Math.round(width)
      setStripWidth((prev) => (prev === nextWidth ? prev : nextWidth))
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
  }, [overdueCount > 0, expanded])

  const layout = useMemo(
    () => computeOverdueStripLayout(overdueCount, stripWidth),
    [overdueCount, stripWidth],
  )
  const visibleOverdue = useMemo(
    () => overdueReminders.slice(0, layout.visibleCount),
    [overdueReminders, layout.visibleCount],
  )

  if (overdueCount === 0) return null

  return <section className="calendar-overdue-card card" aria-label="Current overdue reminders">
    <div className="calendar-overdue-bar">
      <button
        type="button"
        className="calendar-overdue-trigger"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        title="Current unfinished reminders scheduled before today"
      >
        <ClockAlertIcon size={14} />
        <span className="calendar-overdue-title">Overdue Reminders</span>
        <span className="count-label overdue-count">{overdueCount}</span>
        <ChevronDownIcon
          size={13}
          style={{
            transform: expanded ? 'rotate(180deg)' : undefined,
            transition: 'transform var(--transition-fast)',
          }}
        />
      </button>
      {!expanded && <div ref={stripRef} className="calendar-overdue-strip">
        {visibleOverdue.map((item) => <MonthReminderRow
          key={`overdue-${item.reminder.id}`}
          item={item}
          today={today}
          pendingKey={pendingKey}
          overdue
          onJumpToDate={onSelectDate}
          onAction={onAction}
        />)}
        {layout.hiddenCount > 0 && <button
          type="button"
          className={`overdue-more-btn ${visibleOverdue.length === 0 ? 'solo' : ''}`}
          onClick={() => setExpanded(true)}
          aria-label={visibleOverdue.length === 0
            ? `Show all ${overdueCount} overdue reminders`
            : `Show ${layout.hiddenCount} more overdue ${layout.hiddenCount === 1 ? 'reminder' : 'reminders'}`}
        >
          {visibleOverdue.length === 0 ? 'Show all' : `+${layout.hiddenCount} more`}
        </button>}
      </div>}
      {expanded && <button type="button" className="overdue-more-btn solo" onClick={() => setExpanded(false)}>Collapse</button>}
    </div>

    {expanded && <div className="calendar-overdue-drawer">
      {overdueReminders.map((item) => <MonthReminderRow
        key={`overdue-drawer-${item.reminder.id}`}
        item={item}
        today={today}
        pendingKey={pendingKey}
        overdue
        inPanel
        showDeleteButton
        onJumpToDate={onSelectDate}
        onAction={onAction}
      />)}
    </div>}
  </section>
}
