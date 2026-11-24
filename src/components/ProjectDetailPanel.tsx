import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { STATUS_TEXT } from '../constants'
import { getProjectInactiveDays } from '../project-filters'
import { PROJECT_KEYS, TRASH_KEYS } from '../query-keys'
import type { ISODate, ProjectDetailDto, ProjectDto } from '../types'
import { formatFullDate, formatShortDate, groupProgressDatesByMonth } from '../ui-format'
import { ActivityTimeline } from './ActivityTimeline'
import { CalendarIcon, CheckIcon, LocateIcon, PlusIcon, TrashIcon } from './icons'
import { MoveProjectDialog } from './MoveProjectDialog'
import { Badge, ConfirmDialog, FormDialog, LoadError, SidePanel, StatusIcon } from './ui'
import type { ActionRunner } from './ui'

type DetailDialog = 'terminal' | 'move' | 'trash'

export function ProjectDetailPanel({
  detail,
  projects,
  loading,
  error,
  today,
  pendingKey,
  showLocateButton = true,
  overlay = false,
  retry,
  onClose,
  onLocate,
  onOpenCalendar,
  onStartAddChild,
  onAction,
}: {
  detail: ProjectDetailDto | undefined
  projects: ProjectDto[]
  loading: boolean
  error: unknown
  today: ISODate
  pendingKey: string | null
  showLocateButton?: boolean
  overlay?: boolean
  retry: () => void
  onClose: () => void
  onLocate: (id: string) => void
  onOpenCalendar: (id: string) => void
  onStartAddChild: (id: string) => void
  onAction: ActionRunner
}) {
  const [dialog, setDialog] = useState<DetailDialog | null>(null)
  const monthGroups = useMemo(() => detail ? groupProgressDatesByMonth(detail.progressDates) : [], [detail])
  const childCount = useMemo(
    () => (detail ? projects.filter((item) => item.parentId === detail.id).length : 0),
    [detail, projects],
  )
  const exactProgressMap = useMemo(() => {
    if (!detail) return undefined
    return new Map<string, Set<ISODate>>([[detail.id, new Set(detail.progressDates)]])
  }, [detail])

  const rowPrefix = detail ? `project:${detail.id}:` : ''
  const busy = detail ? (pendingKey?.startsWith(rowPrefix) ?? false) : false
  const inactiveDays = detail ? getProjectInactiveDays(detail, today) : null
  const terminalDate = detail ? (detail.completedDate ?? detail.canceledDate ?? '') : ''

  return <>
    <SidePanel
      title="Project Details"
      overlay={overlay}
      headerActions={detail && showLocateButton ? <button
        type="button"
        className="ghost-button btn-sm"
        onClick={() => onLocate(detail.id)}
        title="Locate in Projects tree"
      >
        <LocateIcon size={14} />
        <span>Locate</span>
      </button> : undefined}
      onClose={onClose}
    >
      {error ? <LoadError error={error} retry={retry} /> : loading ? <div className="loading-state">Loading project details…</div> : detail && <>
        <div>
          <h3 className="detail-panel-title">{detail.title}</h3>
          <div className="detail-breadcrumb" title={detail.parentPath.length ? [...detail.parentPath, detail.title].join(' / ') : detail.title}>
            {detail.parentPath.length > 0 ? detail.parentPath.map((segment, idx) => <span key={`${segment}-${idx}`}>
              {idx > 0 && <span className="detail-breadcrumb-sep"> / </span>}
              <span>{segment}</span>
            </span>) : <span>Top-level project</span>}
          </div>
        </div>

        <div className="detail-meta-row">
          <Badge tone={detail.status === 'completed' ? 'completed' : detail.status === 'canceled' ? 'canceled' : 'primary'}>
            <StatusIcon status={detail.status} size="sm" />
            <span>{STATUS_TEXT[detail.status]}</span>
          </Badge>
          {terminalDate && <Badge tone="neutral" title={`${STATUS_TEXT[detail.status]} on ${terminalDate}`}>
            {formatFullDate(terminalDate)}
          </Badge>}
          {childCount > 0 && <Badge tone="neutral">
            {childCount} {childCount === 1 ? 'subproject' : 'subprojects'}
          </Badge>}
          {detail.status === 'active' && detail.progressCount === 0 && <Badge tone="neutral">No activity yet</Badge>}
          {detail.status === 'active' && inactiveDays !== null && inactiveDays >= 7 && <Badge tone="neutral">
            Last active {inactiveDays}d ago
          </Badge>}
        </div>

        <div className="detail-actions-bar">
          {detail.status === 'active' ? <>
            <button
              type="button"
              className={`btn-sm ${detail.progressedToday ? 'secondary-button' : 'primary-button'}`}
              disabled={busy}
              onClick={() => void onAction(
                () => api.setProjectProgress(detail.id, undefined, !detail.progressedToday, detail.version),
                (updated) => ({
                  message: detail.progressedToday ? 'Today\'s progress removed' : 'Progress logged',
                  durationMs: 4500,
                  action: {
                    label: 'Undo',
                    onClick: () => void onAction(
                      () => api.setProjectProgress(updated.id, undefined, detail.progressedToday, updated.version),
                      detail.progressedToday ? 'Progress restored' : 'Progress undone',
                      { key: 'undo', invalidate: PROJECT_KEYS },
                    ),
                  },
                }),
                { key: `${rowPrefix}progress`, invalidate: PROJECT_KEYS },
              )}
            >
              {detail.progressedToday ? <><CheckIcon size={13} strokeWidth={2.3} /><span>Logged Today</span></> : <><PlusIcon size={13} strokeWidth={2.2} /><span>Log Today</span></>}
            </button>
            <button
              type="button"
              className="secondary-button btn-sm"
              disabled={busy}
              onClick={() => void onAction(
                () => api.completeProject(detail.id, detail.version),
                (updated) => ({
                  message: 'Project completed',
                  durationMs: 5000,
                  action: {
                    label: 'Undo',
                    onClick: () => void onAction(() => api.restoreProject(updated.id, updated.version), 'Completion undone', { key: 'undo', invalidate: PROJECT_KEYS }),
                  },
                }),
                { key: `${rowPrefix}status`, invalidate: PROJECT_KEYS },
              )}
            >Complete</button>
            <button
              type="button"
              className="secondary-button btn-sm"
              disabled={busy}
              onClick={() => void onAction(
                () => api.cancelProject(detail.id, detail.version),
                (updated) => ({
                  message: 'Project canceled',
                  durationMs: 5000,
                  action: {
                    label: 'Undo',
                    onClick: () => void onAction(() => api.restoreProject(updated.id, updated.version), 'Cancellation undone', { key: 'undo', invalidate: PROJECT_KEYS }),
                  },
                }),
                { key: `${rowPrefix}status`, invalidate: PROJECT_KEYS },
              )}
            >Cancel</button>
          </> : <>
            <button
              type="button"
              className="secondary-button btn-sm"
              disabled={busy}
              onClick={() => void onAction(() => api.restoreProject(detail.id, detail.version), 'Project restored', { key: `${rowPrefix}status`, invalidate: PROJECT_KEYS })}
            >Restore to Active</button>
            <button type="button" className="secondary-button btn-sm" disabled={busy} onClick={() => setDialog('terminal')}>Edit End Date</button>
          </>}
          <button type="button" className="secondary-button btn-sm" disabled={busy} onClick={() => onStartAddChild(detail.id)}>
            <PlusIcon size={13} /><span>Add Child</span>
          </button>
          <button type="button" className="secondary-button btn-sm" disabled={busy} onClick={() => setDialog('move')}>Move…</button>
          <button type="button" className="ghost-button btn-sm danger-text" disabled={busy} onClick={() => setDialog('trash')}>
            <TrashIcon size={13} /><span>Trash</span>
          </button>
        </div>

        <section className="detail-section">
          <div className="detail-section-header">
            <h3>Recent Activity</h3>
            <button type="button" className="ghost-button btn-sm" onClick={() => onOpenCalendar(detail.id)}>
              <CalendarIcon size={13} /><span>Calendar</span>
            </button>
          </div>
          <ActivityTimeline
            project={detail}
            today={today}
            progressDatesByProject={exactProgressMap}
            variant="panel"
            onOpenCalendar={() => onOpenCalendar(detail.id)}
          />
        </section>

        <section className="detail-section">
          <div className="detail-section-header">
            <h3>Progress History</h3>
            <span className="count-label">{detail.progressCount} {detail.progressCount === 1 ? 'day' : 'days'}</span>
          </div>
          {monthGroups.length > 0 ? <div className="detail-month-groups">
            {monthGroups.map((group) => <div key={group.monthKey} className="detail-month-group">
              <div className="detail-month-heading">
                <span>{group.label}</span>
                <small className="tabular-nums">{group.dates.length} {group.dates.length === 1 ? 'day' : 'days'}</small>
              </div>
              <div className="date-chips">
                {group.dates.map((date) => <time key={date} dateTime={date} title={formatFullDate(date)}>{formatShortDate(date)}</time>)}
              </div>
            </div>)}
          </div> : <p className="muted">No activity recorded yet.</p>}
        </section>
      </>}
    </SidePanel>

    {detail && dialog === 'terminal' && <FormDialog
      title="Edit End Date"
      label={detail.status === 'completed' ? 'Completed Date' : 'Canceled Date'}
      kind="date"
      initialValue={terminalDate}
      max={today}
      onClose={() => setDialog(null)}
      onSubmit={(value) => onAction(() => api.updateProjectTerminalDate(detail.id, value, detail.version), 'End date updated', { key: `${rowPrefix}terminal`, invalidate: PROJECT_KEYS })}
    />}
    {detail && dialog === 'move' && <MoveProjectDialog
      project={detail}
      projects={projects}
      onClose={() => setDialog(null)}
      onSubmit={(targetParentId) => onAction(() => api.moveProject(detail.id, targetParentId, detail.version), 'Project moved', { key: `${rowPrefix}move`, invalidate: PROJECT_KEYS })}
    />}
    {detail && dialog === 'trash' && <DetailTrashDialog project={detail} onAction={onAction} onClose={() => setDialog(null)} onTrashed={onClose} />}
  </>
}

function DetailTrashDialog({
  project,
  onAction,
  onClose,
  onTrashed,
}: {
  project: ProjectDto
  onAction: ActionRunner
  onClose: () => void
  onTrashed: () => void
}) {
  const preview = useQuery({ queryKey: ['trashPreview', project.id], queryFn: () => api.previewProjectTrash(project.id), staleTime: 0, retry: false })
  const affectedCount = preview.data?.activeNodeCount ?? 0
  return <ConfirmDialog
    title="Move to Trash"
    description={<>Move "{project.title}" and its subprojects to Trash? You can restore them later.</>}
    confirmLabel="Move to Trash"
    disabled={!preview.data || preview.isFetching || preview.isError}
    onClose={onClose}
    onConfirm={async () => {
      const result = await onAction(() => api.trashProject(project.id), 'Project moved to Trash', { key: `project:${project.id}:trash`, invalidate: TRASH_KEYS })
      if (result.ok) onTrashed()
      return result
    }}
  >
    {preview.isError
      ? <LoadError error={preview.error} retry={() => void preview.refetch()} />
      : <p className="affected-count">{preview.isFetching ? 'Checking affected projects…' : `Affects ${affectedCount} active ${affectedCount === 1 ? 'node' : 'nodes'}`}</p>}
  </ConfirmDialog>
}
