import { useMemo } from 'react'
import { buildActivityTimeline } from '../project-filters'
import type { ISODate, ProjectDto } from '../types'
import { formatFullDate } from '../ui-format'

function cellTooltip(date: ISODate, hasProgress: boolean, isCompletedDay: boolean, isToday: boolean) {
  const datePart = `${formatFullDate(date)}${isToday ? ' (Today)' : ''}`
  if (isCompletedDay && hasProgress) return `${datePart} · Completed & progress logged`
  if (isCompletedDay) return `${datePart} · Completed`
  if (hasProgress) return `${datePart} · Progress logged`
  return `${datePart} · No activity`
}

export function ActivityTimeline({
  project,
  today,
  windowDays,
  progressDatesByProject,
  variant = 'inline',
  disabled = false,
  onOpenCalendar,
}: {
  project: ProjectDto
  today: ISODate
  windowDays: 14 | 30
  progressDatesByProject?: ReadonlyMap<string, ReadonlySet<ISODate>>
  variant?: 'inline' | 'panel'
  disabled?: boolean
  onOpenCalendar?: () => void
}) {
  const days = useMemo(
    () => buildActivityTimeline(project, today, windowDays, progressDatesByProject),
    [project, today, windowDays, progressDatesByProject],
  )
  const activeInWindow = useMemo(
    () => days.filter((day) => day.hasProgress || day.isCompletedDay).length,
    [days],
  )

  if (variant === 'panel') {
    return <div className="detail-timeline-card">
      <div className="detail-timeline-grid" role="img" aria-label={`Activity over the last ${windowDays} days: ${activeInWindow} active ${activeInWindow === 1 ? 'day' : 'days'}`}>
        {days.map((cell) => <span
          key={cell.date}
          className={`activity-cell ${cell.hasProgress ? 'has-progress' : ''} ${cell.isCompletedDay ? 'is-completed' : ''} ${cell.isToday ? 'is-today' : ''}`}
          title={cellTooltip(cell.date, cell.hasProgress, cell.isCompletedDay, cell.isToday)}
        />)}
      </div>
      <div className="detail-timeline-caption">
        <span>Last {windowDays} days · {activeInWindow} active {activeInWindow === 1 ? 'day' : 'days'}</span>
        <span>{project.progressCount} total</span>
      </div>
    </div>
  }

  return <button
    type="button"
    className="activity-timeline-btn"
    disabled={disabled}
    onClick={onOpenCalendar}
    aria-label={project.progressCount > 0
      ? `Activity timeline for ${project.title}: ${project.progressCount} total ${project.progressCount === 1 ? 'day' : 'days'} logged, ${activeInWindow} in last ${windowDays} days. Open progress calendar.`
      : `No activity recorded yet for ${project.title}. Open progress calendar.`}
    title={project.progressCount > 0
      ? `${project.progressCount} total ${project.progressCount === 1 ? 'day' : 'days'} logged · ${activeInWindow} in last ${windowDays}d · Click to open calendar`
      : 'No activity recorded yet · Click to open calendar'}
  >
    <span className="activity-timeline-grid" aria-hidden="true">
      {days.map((cell) => <span
        key={cell.date}
        className={`activity-cell ${cell.hasProgress ? 'has-progress' : ''} ${cell.isCompletedDay ? 'is-completed' : ''} ${cell.isToday ? 'is-today' : ''}`}
        title={cellTooltip(cell.date, cell.hasProgress, cell.isCompletedDay, cell.isToday)}
      />)}
    </span>
    <span className="activity-count-tag">{project.progressCount > 0 ? `${project.progressCount}d` : '—'}</span>
  </button>
}
