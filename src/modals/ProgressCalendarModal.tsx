import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { ArrowLeftIcon, ArrowRightIcon } from '../components/icons'
import { LoadError, Modal } from '../components/ui'
import type { ActionRunner } from '../components/ui'
import { PROJECT_KEYS } from '../query-keys'
import type { ProjectDto } from '../types'
import { formatMonthLabel, getMonthCalendarLayout, shiftMonth, WEEKDAYS } from '../ui-format'

export function ProgressCalendarModal({
  project,
  today,
  pending,
  onAction,
  onClose,
}: {
  project: ProjectDto
  today: string
  pending: boolean
  onAction: ActionRunner
  onClose: () => void
}) {
  const currentMonth = today.slice(0, 7)
  const [month, setMonth] = useState(currentMonth)
  const [error, setError] = useState<string | null>(null)
  const progress = useQuery({ queryKey: ['projectProgressMonth', project.id, month], queryFn: () => api.getProjectProgressMonth(project.id, month) })
  const { leading, dates } = getMonthCalendarLayout(month)
  const recorded = new Set(progress.data ?? [])
  const changeMonth = (amount: number) => { setMonth(shiftMonth(month, amount)); setError(null) }

  const toggle = async (date: string) => {
    const has = recorded.has(date)
    if (pending || (project.status !== 'active' && !has) || (date > today && !has)) return
    setError(null)
    const result = await onAction(
      () => api.setProjectProgress(project.id, date, !has, project.version),
      has ? 'Progress removed' : 'Progress logged',
      { key: `calendar:${project.id}`, invalidate: PROJECT_KEYS },
    )
    if (!result.ok) setError(result.message)
  }

  return <Modal title="Progress Calendar" description={project.title} onClose={onClose} busy={pending} className="calendar-modal">
    <div className="calendar-toolbar">
      <button type="button" className="icon-button" disabled={pending} onClick={() => changeMonth(-1)} aria-label="Previous month" title="Previous month"><ArrowLeftIcon size={15} /></button>
      <div className="calendar-heading">
        <strong>{formatMonthLabel(month)}</strong>
        <span className="calendar-month-count">{progress.isLoading ? 'Loading…' : `${recorded.size} ${recorded.size === 1 ? 'day' : 'days'} this month`}</span>
      </div>
      <div className="calendar-toolbar-right">
        {month !== currentMonth && <button type="button" className="text-button calendar-today-btn" disabled={pending} onClick={() => { setMonth(currentMonth); setError(null) }}>This Month</button>}
        <button type="button" className="icon-button" disabled={pending} onClick={() => changeMonth(1)} aria-label="Next month" title="Next month"><ArrowRightIcon size={15} /></button>
      </div>
    </div>
    {progress.isError && <LoadError error={progress.error} retry={() => void progress.refetch()} />}
    <div className="calendar-weekdays" aria-hidden="true">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
    <div className={`calendar-grid ${progress.isFetching ? 'is-loading' : ''}`} aria-busy={progress.isFetching}>
      {Array.from({ length: leading }, (_, index) => <span key={`leading-${index}`} />)}
      {dates.map((date) => {
        const has = recorded.has(date)
        const isFuture = date > today
        return <button key={date} type="button" className={`${has ? 'recorded' : ''} ${date === today ? 'today' : ''} ${isFuture ? 'future' : ''}`} aria-label={`${date}${has ? ', progressed' : ''}`} aria-pressed={has} aria-current={date === today ? 'date' : undefined} disabled={pending || progress.isFetching || progress.isError || (isFuture && !has) || (project.status !== 'active' && !has)} onClick={() => void toggle(date)}>
          <span>{Number(date.slice(-2))}</span>
          {has && <span className="recorded-dot" aria-hidden="true" />}
        </button>
      })}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <p className="calendar-help">Click a date to log or remove progress. {project.status === 'active' ? 'Future dates cannot be logged.' : 'Terminal projects can only remove existing entries.'}</p>
  </Modal>
}
