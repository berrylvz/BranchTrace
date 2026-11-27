import { formatProjectParentSummary } from '../range-summary'
import type { ProjectDailyItem } from '../types'
import { CheckIcon, TrendingUpIcon } from './icons'
import { Badge } from './ui'

export function ProjectDailyRow({
  item,
  completed = false,
  dateBadge,
  onOpenProjectDetail,
}: {
  item: ProjectDailyItem
  completed?: boolean
  dateBadge?: string
  onOpenProjectDetail: (projectId: string) => void
}) {
  const parentSummary = formatProjectParentSummary(item.parentPath)
  const meta = [parentSummary, item.shortId].filter(Boolean).join(' · ')
  const fullPath = [...item.parentPath, item.title].join(' / ')

  return <button
    type="button"
    className="daily-item"
    onClick={() => onOpenProjectDetail(item.projectId)}
    title={fullPath}
  >
    <span
      className="item-icon"
      style={{ color: completed ? 'var(--color-completed)' : 'var(--color-progress)' }}
      aria-hidden="true"
    >
      {completed ? <CheckIcon size={13} strokeWidth={2.3} /> : <TrendingUpIcon size={13} strokeWidth={2} />}
    </span>
    <span className="item-text">
      <span className="item-heading">
        <strong>{item.title}</strong>
        {dateBadge && <Badge tone={completed ? 'completed' : 'neutral'}>{dateBadge}</Badge>}
        {completed && item.progressedSameDay && <Badge tone="progress">Progressed same day</Badge>}
      </span>
      {meta && <small>{meta}</small>}
    </span>
  </button>
}
