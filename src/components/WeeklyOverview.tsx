import { useMemo } from 'react'
import type { DailyWeekDto, ISODate } from '../types'
import { formatFullDate } from '../ui-format'
import { computeWeeklyOverview } from '../weekly-summary'

export function WeeklyOverview({
  weekly,
  onSelectDay,
}: {
  weekly: DailyWeekDto
  onSelectDay: (date: ISODate) => void
}) {
  const stats = useMemo(() => computeWeeklyOverview(weekly), [weekly])
  const maxDaily = useMemo(
    () => Math.max(1, ...stats.dailyActivity.map((day) => day.totalCount)),
    [stats.dailyActivity],
  )

  return <section className="weekly-overview card" aria-label="Weekly summary">
    <div className="weekly-metrics-grid">
      <div className="weekly-metric tone-completed">
        <span className="weekly-metric-value">{stats.completedProjects}</span>
        <span className="weekly-metric-label">Completed Projects</span>
      </div>
      <div className="weekly-metric tone-progress">
        <span className="weekly-metric-value">{stats.progressLogs}</span>
        <span className="weekly-metric-label">Progress Logs</span>
      </div>
      <div className="weekly-metric">
        <span className="weekly-metric-value">{stats.activeDays} / 7</span>
        <span className="weekly-metric-label">Active Days</span>
      </div>
      <div className="weekly-metric">
        <span className="weekly-metric-value">{stats.remindersDone}</span>
        <span className="weekly-metric-label">Reminders Done</span>
      </div>
      <div className="weekly-metric">
        <span className="weekly-metric-value">{stats.upcomingReminders}</span>
        <span className="weekly-metric-label">Upcoming</span>
      </div>
    </div>

    <div className="daily-chart" role="group" aria-label="Daily project activity distribution">
      {stats.dailyActivity.map((day) => {
        const completedPct = day.completedCount > 0 ? Math.max(14, Math.round((day.completedCount / maxDaily) * 100)) : 0
        const progressPct = day.progressCount > 0 ? Math.max(14, Math.round((day.progressCount / maxDaily) * 100)) : 0
        const tooltip = day.isFuture
          ? `${formatFullDate(day.date)} · Upcoming`
          : `${formatFullDate(day.date)} · ${day.completedCount} completed, ${day.progressCount} progress ${day.progressCount === 1 ? 'log' : 'logs'}`

        return <button
          key={day.date}
          type="button"
          className={`daily-chart-col ${day.isToday ? 'is-today' : ''} ${day.isFuture ? 'is-future' : ''}`}
          title={tooltip}
          aria-label={tooltip}
          onClick={() => onSelectDay(day.date)}
        >
          <span className="daily-chart-track" aria-hidden="true">
            {day.completedCount > 0 && <span className="daily-chart-bar completed" style={{ height: `${completedPct}%` }} />}
            {day.progressCount > 0 && <span className="daily-chart-bar progress" style={{ height: `${progressPct}%` }} />}
          </span>
          <span className="daily-chart-label">{day.weekday}</span>
        </button>
      })}
    </div>
  </section>
}
