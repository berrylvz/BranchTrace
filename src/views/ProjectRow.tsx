import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { ActivityTimeline } from '../components/ActivityTimeline'
import {
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  CornerDownRightIcon,
  GripIcon,
  PlusIcon,
} from '../components/icons'
import { MoveProjectDialog } from '../components/MoveProjectDialog'
import { ActionMenu, Badge, ConfirmDialog, FormDialog, isEditableElement, LoadError, StatusIcon } from '../components/ui'
import type { ActionRunner } from '../components/ui'
import { STATUS_TEXT } from '../constants'
import type { DropPosition } from '../constants'
import { getProjectInactiveDays } from '../project-filters'
import { MAX_TREE_INDENT, TREE_INDENT, TREE_TOGGLE_WIDTH } from '../project-tree'
import type { ProjectTreeRow } from '../project-tree'
import { EXPAND_KEYS, PROJECT_KEYS, TRASH_KEYS } from '../query-keys'
import type { ISODate, ProjectDto } from '../types'
import { formatMonthDay } from '../ui-format'

const HALF_TOGGLE = TREE_TOGGLE_WIDTH / 2

export interface DragProjectState {
  id: string
  parentId: string | null
}

type ProjectDialog = 'terminal' | 'move' | 'trash'

export function InlineChildRow({
  parent,
  depth,
  continuationDepths,
  submitting,
  onAction,
  onClose,
}: {
  parent: ProjectDto
  depth: number
  continuationDepths: number[]
  submitting: boolean
  onAction: ActionRunner
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const indent = Math.min(depth, MAX_TREE_INDENT)

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
    rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [parent.id])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    const trimmed = title.trim()
    if (!trimmed) {
      setError('Subproject name cannot be empty')
      inputRef.current?.focus({ preventScroll: true })
      return
    }
    setError(null)
    const result = await onAction(
      () => api.createProject(trimmed, parent.id),
      'Subproject created',
      { key: `project:${parent.id}:child`, invalidate: PROJECT_KEYS },
    )
    if (result.ok) {
      setTitle('')
      inputRef.current?.focus({ preventScroll: true })
    } else {
      setError(result.message)
      inputRef.current?.focus({ preventScroll: true })
    }
  }

  return <div ref={rowRef} className="project-row-wrap is-child inline-child-wrap" role="treeitem" aria-level={depth + 1}>
    <div className="project-row inline-child-row">
      <span className="drag-handle-placeholder" aria-hidden="true" />
      <span className="tree-prefix" style={{ width: `${TREE_TOGGLE_WIDTH + indent * TREE_INDENT}px` }}>
        <span className="tree-guides" aria-hidden="true">
          {continuationDepths.map((level) => <span key={level} className="tree-guide-continuation" style={{ left: `${HALF_TOGGLE + level * TREE_INDENT}px` }} />)}
          {depth > 0 && depth <= MAX_TREE_INDENT && <span className="tree-guide-branch last" style={{ left: `${HALF_TOGGLE + (depth - 1) * TREE_INDENT}px`, width: `${TREE_INDENT + HALF_TOGGLE}px` }} />}
        </span>
        <span className="tree-spacer" />
      </span>
      <span className="inline-child-icon" aria-hidden="true"><CornerDownRightIcon size={14} /></span>
      <form className="inline-child-form" onSubmit={(event) => void submit(event)}>
        <div className="inline-child-input-group">
          <input
            ref={inputRef}
            className="inline-edit-input"
            value={title}
            readOnly={submitting}
            aria-busy={submitting}
            placeholder={`New subproject under "${parent.title}"… Enter to add, Esc to finish`}
            aria-label={`New subproject under ${parent.title}`}
            onChange={(event) => { setTitle(event.target.value); if (error) setError(null) }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                onClose()
              }
            }}
          />
          <button type="submit" className="primary-button inline-submit-btn" disabled={submitting || !title.trim()}>{submitting ? 'Adding…' : 'Add'}</button>
          <button type="button" className="icon-button inline-cancel-btn" disabled={submitting} aria-label="Stop adding subprojects" title="Finish (Esc)" onClick={onClose}><CloseIcon size={14} /></button>
        </div>
        {error && <p className="inline-error" role="alert">{error}</p>}
      </form>
    </div>
  </div>
}

export function ProjectRow({
  row,
  visuallyExpanded,
  showDownGuide,
  projects,
  pendingKey,
  today,
  isSelected,
  isLocated,
  isAncestorContext,
  isFiltered,
  showInactiveHint,
  inactiveThresholdDays,
  timelineDays,
  progressDatesByProject,
  dragState,
  dropPosition,
  onAction,
  onOpenDetail,
  onOpenCalendar,
  addingChild,
  onStartAddChild,
  onStopAddChild,
  onDragStart,
  onDragEnd,
  onDragHover,
  onDragLeave,
  onReorder,
  onTreeKeyDown,
}: {
  row: ProjectTreeRow
  visuallyExpanded: boolean
  showDownGuide: boolean
  projects: ProjectDto[]
  pendingKey: string | null
  today: ISODate
  isSelected: boolean
  isLocated: boolean
  isAncestorContext: boolean
  isFiltered: boolean
  showInactiveHint: boolean
  inactiveThresholdDays: number
  timelineDays: 14 | 30
  progressDatesByProject: ReadonlyMap<string, ReadonlySet<ISODate>>
  dragState: DragProjectState | null
  dropPosition: DropPosition | null
  onAction: ActionRunner
  onOpenDetail: (id: string) => void
  onOpenCalendar: (id: string) => void
  addingChild: boolean
  onStartAddChild: (parentId: string) => void
  onStopAddChild: () => void
  onDragStart: (state: DragProjectState) => void
  onDragEnd: () => void
  onDragHover: (id: string, position: DropPosition) => void
  onDragLeave: (id: string) => void
  onReorder: (parentId: string | null, fromId: string, targetId: string, position: DropPosition) => Promise<void>
  onTreeKeyDown: (event: KeyboardEvent<HTMLElement>, row: ProjectTreeRow, visuallyExpanded: boolean) => void
}) {
  const { project, depth, hasChildren, isLastSibling, continuationDepths } = row
  const indent = Math.min(depth, MAX_TREE_INDENT)
  const [dialog, setDialog] = useState<ProjectDialog | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [renameDraft, setRenameDraft] = useState(project.title)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [contextAnchor, setContextAnchor] = useState<{ x: number; y: number } | null>(null)
  const clickTimer = useRef<number>()
  const titleButtonRef = useRef<HTMLButtonElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => window.clearTimeout(clickTimer.current), [])
  useEffect(() => {
    if (!editingTitle) return
    renameInputRef.current?.focus({ preventScroll: true })
    renameInputRef.current?.select()
  }, [editingTitle])

  const closeDialog = () => setDialog(null)
  const closeContext = useCallback(() => setContextAnchor(null), [])
  const terminalDate = project.completedDate ?? project.canceledDate ?? ''
  const isTerminal = project.status !== 'active'

  const rowPrefix = `project:${project.id}:`
  const rowBusy = pendingKey?.startsWith(rowPrefix) ?? false
  const progressPending = pendingKey === `${rowPrefix}progress` || pendingKey === `${rowPrefix}status`
  const expandPending = pendingKey === `${rowPrefix}expand` || pendingKey === 'project:expand-all'
  const renamePending = pendingKey === `${rowPrefix}rename`

  const isDragging = dragState?.id === project.id
  const canDrag = !isFiltered && pendingKey === null && !editingTitle
  const canDropHere = Boolean(!isFiltered && dragState && dragState.parentId === project.parentId && dragState.id !== project.id && pendingKey === null)

  const inactiveDays = getProjectInactiveDays(project, today)
  const inactiveLabel = !isTerminal && showInactiveHint
    ? (project.progressCount === 0
      ? 'No activity yet'
      : inactiveDays !== null && inactiveDays >= inactiveThresholdDays
        ? `Inactive · ${inactiveDays}d`
        : null)
    : null

  const startRename = () => {
    if (rowBusy) return
    window.clearTimeout(clickTimer.current)
    setRenameDraft(project.title)
    setRenameError(null)
    setEditingTitle(true)
  }

  const cancelRename = () => {
    setEditingTitle(false)
    setRenameError(null)
    window.requestAnimationFrame(() => titleButtonRef.current?.focus({ preventScroll: true }))
  }

  const commitRename = async (event?: FormEvent) => {
    event?.preventDefault()
    if (renamePending) return
    const trimmed = renameDraft.trim()
    if (!trimmed) {
      setRenameError('Project name cannot be empty')
      renameInputRef.current?.focus({ preventScroll: true })
      return
    }
    if (trimmed === project.title) {
      cancelRename()
      return
    }
    setRenameError(null)
    const result = await onAction(
      () => api.renameProject(project.id, trimmed, project.version),
      'Project renamed',
      { key: `${rowPrefix}rename`, invalidate: PROJECT_KEYS },
    )
    if (result.ok) {
      setEditingTitle(false)
      window.requestAnimationFrame(() => titleButtonRef.current?.focus({ preventScroll: true }))
    } else {
      setRenameError(result.message)
      renameInputRef.current?.focus({ preventScroll: true })
    }
  }

  const toggleTodayProgress = () => {
    const nextPresent = !project.progressedToday
    void onAction(
      () => api.setProjectProgress(project.id, undefined, nextPresent, project.version),
      (updated) => ({
        message: nextPresent ? 'Progress logged' : 'Today\'s progress removed',
        durationMs: 4500,
        action: {
          label: 'Undo',
          onClick: () => void onAction(
            () => api.setProjectProgress(updated.id, undefined, !nextPresent, updated.version),
            nextPresent ? 'Progress undone' : 'Progress restored',
            { key: 'undo', invalidate: PROJECT_KEYS },
          ),
        },
      }),
      { key: `${rowPrefix}progress`, invalidate: PROJECT_KEYS },
    )
  }

  const menuItems = [
    { label: 'View Activity & Details', onSelect: () => onOpenDetail(project.id) },
    ...(project.status === 'active'
      ? [
        {
          label: 'Mark Completed',
          separator: true,
          onSelect: () => void onAction(
            () => api.completeProject(project.id, project.version),
            (updated) => ({
              message: 'Project completed',
              durationMs: 5000,
              action: {
                label: 'Undo',
                onClick: () => void onAction(() => api.restoreProject(updated.id, updated.version), 'Completion undone', { key: 'undo', invalidate: PROJECT_KEYS }),
              },
            }),
            { key: `${rowPrefix}status`, invalidate: PROJECT_KEYS },
          ),
        },
        {
          label: 'Cancel Project',
          onSelect: () => void onAction(
            () => api.cancelProject(project.id, project.version),
            (updated) => ({
              message: 'Project canceled',
              durationMs: 5000,
              action: {
                label: 'Undo',
                onClick: () => void onAction(() => api.restoreProject(updated.id, updated.version), 'Cancellation undone', { key: 'undo', invalidate: PROJECT_KEYS }),
              },
            }),
            { key: `${rowPrefix}status`, invalidate: PROJECT_KEYS },
          ),
        },
      ]
      : [
        { label: 'Restore to Active', separator: true, onSelect: () => void onAction(() => api.restoreProject(project.id, project.version), 'Project restored', { key: `${rowPrefix}status`, invalidate: PROJECT_KEYS }) },
        { label: 'Edit End Date', onSelect: () => setDialog('terminal') },
      ]),
    { label: 'Add Child Project', separator: true, onSelect: () => onStartAddChild(project.id) },
    { label: 'Rename', onSelect: startRename },
    { label: 'Progress Calendar', onSelect: () => onOpenCalendar(project.id) },
    { label: 'Move Project…', onSelect: () => setDialog('move') },
    { label: 'Move to Trash', separator: true, danger: true, onSelect: () => setDialog('trash') },
  ]

  return <div
    className={`project-row-wrap ${depth === 0 ? 'is-root' : 'is-child'} ${dropPosition ? `drop-${dropPosition}` : ''}`}
    role="treeitem"
    aria-level={depth + 1}
    aria-expanded={hasChildren ? visuallyExpanded : undefined}
    aria-selected={isSelected}
    data-project-id={project.id}
  >
    <div
      className={`project-row ${project.status} ${depth === 0 ? 'project-root' : ''} ${isSelected ? 'is-selected' : ''} ${isLocated ? 'is-located' : ''} ${isAncestorContext ? 'is-ancestor-context' : ''} ${isDragging ? 'is-dragging' : ''} ${rowBusy ? 'is-pending' : ''}`}
      onKeyDown={(event) => {
        if (editingTitle || isEditableElement(event.target)) return
        if (event.key === 'F2') {
          event.preventDefault()
          startRename()
          return
        }
        onTreeKeyDown(event, row, visuallyExpanded)
      }}
      onContextMenu={(event) => {
        if (editingTitle || rowBusy || isEditableElement(event.target)) return
        event.preventDefault()
        setContextAnchor({ x: event.clientX, y: event.clientY })
      }}
      onDragOver={(event) => {
        if (!canDropHere) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const rect = event.currentTarget.getBoundingClientRect()
        onDragHover(project.id, event.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragLeave(project.id)
      }}
      onDrop={(event) => {
        if (!canDropHere) return
        event.preventDefault()
        const fromId = event.dataTransfer.getData('text/branchtrace-project') || dragState?.id
        const rect = event.currentTarget.getBoundingClientRect()
        const position: DropPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
        onDragEnd()
        if (fromId) void onReorder(project.parentId, fromId, project.id, position)
      }}
    >
      {isFiltered ? <span className="drag-handle-placeholder" aria-hidden="true" /> : <button
        type="button"
        className="drag-handle"
        aria-label={`Drag to reorder ${project.title}`}
        title="Drag to reorder siblings"
        draggable={canDrag}
        disabled={rowBusy || editingTitle}
        onDragStart={(event) => {
          event.stopPropagation()
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/branchtrace-project', project.id)
          onDragStart({ id: project.id, parentId: project.parentId })
        }}
        onDragEnd={onDragEnd}
      ><GripIcon size={14} /></button>}

      <span className="tree-prefix" style={{ width: `${TREE_TOGGLE_WIDTH + indent * TREE_INDENT}px` }}>
        <span className="tree-guides" aria-hidden="true">
          {continuationDepths.map((level) => <span key={level} className="tree-guide-continuation" style={{ left: `${HALF_TOGGLE + level * TREE_INDENT}px` }} />)}
          {depth > 0 && depth <= MAX_TREE_INDENT && <span className={`tree-guide-branch ${isLastSibling ? 'last' : ''}`} style={{ left: `${HALF_TOGGLE + (depth - 1) * TREE_INDENT}px`, width: `${hasChildren ? TREE_INDENT - HALF_TOGGLE : TREE_INDENT + HALF_TOGGLE}px` }} />}
          {showDownGuide && depth < MAX_TREE_INDENT && <span className="tree-guide-down" style={{ left: `${HALF_TOGGLE + indent * TREE_INDENT}px` }} />}
        </span>
        {hasChildren ? <button type="button" className="tree-toggle" disabled={expandPending} aria-label={`${visuallyExpanded ? 'Collapse' : 'Expand'} ${project.title}`} aria-expanded={visuallyExpanded} onClick={() => {
          if (addingChild) {
            onStopAddChild()
            if (!project.isExpanded) return
          }
          void onAction(() => api.setProjectExpanded(project.id, !project.isExpanded), undefined, { key: `${rowPrefix}expand`, invalidate: EXPAND_KEYS, keepNotice: true })
        }}><ChevronRightIcon size={16} strokeWidth={1.85} className={`tree-chevron ${visuallyExpanded ? 'expanded' : ''}`} /></button> : <span className="tree-spacer" />}
      </span>

      <StatusIcon status={project.status} label={`Status: ${STATUS_TEXT[project.status]}`} />

      <div className="project-main">
        {editingTitle ? <form className="inline-rename-form" onSubmit={(event) => void commitRename(event)}>
          <div className="inline-rename-controls">
            <input
              ref={renameInputRef}
              className="inline-edit-input"
              value={renameDraft}
              readOnly={renamePending}
              aria-busy={renamePending}
              aria-label="Rename project"
              onChange={(event) => { setRenameDraft(event.target.value); if (renameError) setRenameError(null) }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  cancelRename()
                }
              }}
            />
            <button type="submit" className="icon-button inline-confirm-btn" disabled={renamePending} aria-label="Save name" title="Save (Enter)" onMouseDown={(event) => event.preventDefault()}><CheckIcon size={14} strokeWidth={2.2} /></button>
            <button type="button" className="icon-button inline-cancel-btn" disabled={renamePending} aria-label="Cancel rename" title="Cancel (Esc)" onMouseDown={(event) => event.preventDefault()} onClick={cancelRename}><CloseIcon size={14} /></button>
          </div>
          {renameError && <p className="inline-error" role="alert">{renameError}</p>}
        </form> : <>
          <button
            ref={titleButtonRef}
            type="button"
            data-tree-focus-target
            className="project-title"
            title={`${project.title} (Click for details · Double-click or F2 to rename)`}
            disabled={rowBusy}
            onClick={(event) => {
              window.clearTimeout(clickTimer.current)
              if (event.detail === 0) onOpenDetail(project.id)
              else if (event.detail === 1) clickTimer.current = window.setTimeout(() => onOpenDetail(project.id), 185)
            }}
            onDoubleClick={startRename}
          >{project.title}</button>
          {inactiveLabel && <Badge tone="neutral">{inactiveLabel}</Badge>}
        </>}
      </div>

      <div className="project-tail">
        <div className="project-meta-slot">
          {depth > MAX_TREE_INDENT && <span className="depth-label">L{depth + 1}</span>}
          {isTerminal && terminalDate && <span className={`terminal-date-badge ${project.status}`} title={`${STATUS_TEXT[project.status]} on ${terminalDate}`}>
            {STATUS_TEXT[project.status]} {formatMonthDay(terminalDate)}
          </span>}
        </div>

        <ActivityTimeline
          project={project}
          today={today}
          windowDays={timelineDays}
          progressDatesByProject={progressDatesByProject}
          disabled={rowBusy}
          onOpenCalendar={() => onOpenCalendar(project.id)}
        />

        <div className="progress-slot">
          {!isTerminal ? <button
            type="button"
            className={`progress-button ${project.progressedToday ? 'checked' : ''}`}
            disabled={progressPending}
            aria-busy={progressPending}
            aria-pressed={project.progressedToday}
            onClick={toggleTodayProgress}
            title={project.progressedToday ? 'Logged today · Click to remove today\'s progress' : 'Log progress for today'}
          >
            {project.progressedToday
              ? <><CheckIcon size={12} strokeWidth={2.4} /><span>Logged Today</span></>
              : <><PlusIcon size={12} strokeWidth={2.2} /><span>Log Today</span></>}
          </button> : project.progressedToday ? <Badge tone="progress" title="Progress logged today">
            <CheckIcon size={10} strokeWidth={2.4} /><span>Logged</span>
          </Badge> : null}
        </div>

        <div className="row-quick-actions">
          <button
            type="button"
            className="icon-button add-child-button"
            disabled={rowBusy}
            aria-label={`Add child project under ${project.title}`}
            title="Add child project"
            onClick={() => onStartAddChild(project.id)}
          ><PlusIcon size={15} /></button>
          <ActionMenu label={`More actions for ${project.title}`} items={menuItems} disabled={rowBusy} contextAnchor={contextAnchor} onContextClose={closeContext} />
        </div>
      </div>
    </div>

    {dialog === 'terminal' && <FormDialog title="Edit End Date" label={project.status === 'completed' ? 'Completed Date' : 'Canceled Date'} kind="date" initialValue={terminalDate} max={today} onClose={closeDialog} onSubmit={(value) => onAction(() => api.updateProjectTerminalDate(project.id, value, project.version), 'End date updated', { key: `${rowPrefix}terminal`, invalidate: PROJECT_KEYS })} />}
    {dialog === 'move' && <MoveProjectDialog project={project} projects={projects} onClose={closeDialog} onSubmit={(targetParentId) => onAction(() => api.moveProject(project.id, targetParentId, project.version), 'Project moved', { key: `${rowPrefix}move`, invalidate: PROJECT_KEYS })} />}
    {dialog === 'trash' && <ProjectTrashDialog project={project} onAction={onAction} onClose={closeDialog} />}
  </div>
}

function ProjectTrashDialog({ project, onAction, onClose }: { project: ProjectDto; onAction: ActionRunner; onClose: () => void }) {
  const preview = useQuery({ queryKey: ['trashPreview', project.id], queryFn: () => api.previewProjectTrash(project.id), staleTime: 0, retry: false })
  const affectedCount = preview.data?.activeNodeCount ?? 0
  return <ConfirmDialog title="Move to Trash" description={<>Move "{project.title}" and its subprojects to Trash? You can restore them later.</>} confirmLabel="Move to Trash" disabled={!preview.data || preview.isFetching || preview.isError} onClose={onClose} onConfirm={() => onAction(() => api.trashProject(project.id), 'Project moved to Trash', { key: `project:${project.id}:trash`, invalidate: TRASH_KEYS })}>
    {preview.isError ? <LoadError error={preview.error} retry={() => void preview.refetch()} /> : <p className="affected-count">{preview.isFetching ? 'Checking affected projects…' : `Affects ${affectedCount} active ${affectedCount === 1 ? 'node' : 'nodes'}`}</p>}
  </ConfirmDialog>
}
