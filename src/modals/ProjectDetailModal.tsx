import { useMemo } from 'react'
import { CheckIcon, MinusIcon } from '../components/icons'
import { LoadError, Modal } from '../components/ui'
import { STATUS_TEXT } from '../constants'
import type { ProjectDetailDto } from '../types'
import { formatShortDate, groupProgressDatesByMonth } from '../ui-format'

export function ProjectDetailModal({
  detail,
  loading,
  error,
  retry,
  onClose,
}: {
  detail: ProjectDetailDto | undefined
  loading: boolean
  error: unknown
  retry: () => void
  onClose: () => void
}) {
  const monthGroups = useMemo(() => detail ? groupProgressDatesByMonth(detail.progressDates) : [], [detail])
  return <Modal title="Project Details" onClose={onClose} className="detail-modal">
    {error ? <LoadError error={error} retry={retry} /> : loading ? <div className="loading-state">Loading project details…</div> : detail && <>
      <h3 className="detail-title">{detail.title}</h3>
      <div className="detail-path">{detail.parentPath.length ? detail.parentPath.join(' / ') : 'Top-level project'}</div>
      <div className="detail-status">
        <span className={`detail-status-pill ${detail.status}`}>
          <span className={`status-dot ${detail.status}`} aria-hidden="true">
            {detail.status === 'completed' && <CheckIcon size={10} strokeWidth={2.3} />}
            {detail.status === 'canceled' && <MinusIcon size={10} strokeWidth={2.3} />}
          </span>
          {STATUS_TEXT[detail.status]}
        </span>
        {(detail.completedDate || detail.canceledDate) && <time dateTime={detail.completedDate ?? detail.canceledDate ?? undefined}>{detail.completedDate ?? detail.canceledDate}</time>}
      </div>
      <div className="detail-section">
        <h3>Progress History <span className="count-label">{detail.progressCount} {detail.progressCount === 1 ? 'day' : 'days'}</span></h3>
        {monthGroups.length ? <div className="detail-month-groups">
          {monthGroups.map((group) => <div key={group.monthKey} className="detail-month-group">
            <div className="detail-month-heading"><span>{group.label}</span><small>{group.dates.length} {group.dates.length === 1 ? 'day' : 'days'}</small></div>
            <div className="date-chips">{group.dates.map((date) => <time key={date} dateTime={date}>{formatShortDate(date)}</time>)}</div>
          </div>)}
        </div> : <p className="muted">No progress logged yet.</p>}
      </div>
    </>}
  </Modal>
}
