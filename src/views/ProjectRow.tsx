import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import {
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  CornerDownRightIcon,
  GripIcon,
  MinusIcon,
  PlusIcon,
} from '../components/icons'
import { MoveProjectDialog } from '../components/MoveProjectDialog'
import { ActionMenu, ConfirmDialog, FormDialog, isEditableElement, LoadError } from '../components/ui'
import type { ActionRunner } from '../components/ui'
import { STATUS_TEXT } from '../constants'
import type { DropPosition } from '../constants'
import { MAX_TREE_INDENT, TREE_INDENT, TREE_TOGGLE_WIDTH } from '../project-tree'
import type { ProjectTreeRow } from '../project-tree'
import { EXPAND_KEYS, PROJECT_KEYS, TRASH_KEYS } from '../query-keys'
import type { ProjectDto } from '../types'
import { formatShortDate } from '../ui-format'

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

  return <div ref={rowRef} className="project-row-wrap is-child inline-child-wrap" role="listitem" aria-level={depth + 1}>
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
}: {
  row: ProjectTreeRow
  visuallyExpanded: boolean
  showDownGuide: boolean
  projects: ProjectDto[]
  pendingKey: string | null
  today: string
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
  const canDropHere = Boolean(dragState && dragState.parentId === project.parentId && dragState.id !== project.id && pendingKey === null)

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

  const menuItems = [
    { label: 'View Details', onSelect: () => onOpenDetail(project.id) },
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
    { label: 'Add Subproject', separator: true, onSelect: () => onStartAddChild(project.id) },
    { label: 'Rename', onSelect: startRename },
    { label: 'Progress Calendar', onSelect: () => onOpenCalendar(project.id) },
    { label: 'Move to…', onSelect: () => setDialog('move') },
    { label: 'Move to Trash', separator: true, danger: true, onSelect: () => setDialog('trash') },
  ]

  return <div className={`project-row-wrap ${depth === 0 ? 'is-root' : 'is-child'} ${dropPosition ? `drop-${dropPosition}` : ''}`} role="listitem" aria-level={depth + 1}>
    <div
      className={`project-row ${project.status} ${depth === 0 ? 'project-root' : ''} ${isDragging ? 'is-dragging' : ''} ${rowBusy ? 'is-pending' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'F2' && !editingTitle && !isEditableElement(event.target)) {
          event.preventDefault()
          startRename()
        }
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
      <button
        type="button"
        className="drag-handle"
        aria-label={`Drag to reorder ${project.title}`}
        title="Drag to reorder siblings"
        draggable={pendingKey === null && !editingTitle}
        disabled={rowBusy || editingTitle}
        onDragStart={(event) => {
          event.stopPropagation()
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/branchtrace-project', project.id)
          onDragStart({ id: project.id, parentId: project.parentId })
        }}
        onDragEnd={onDragEnd}
      ><GripIcon size={14} /></button>
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
      <span className={`status-dot ${project.status}`} role="img" aria-label={`Status: ${STATUS_TEXT[project.status]}`} title={STATUS_TEXT[project.status]}>
        {project.status === 'completed' && <CheckIcon size={10} strokeWidth={2.3} />}
        {project.status === 'canceled' && <MinusIcon size={10} strokeWidth={2.3} />}
      </span>
      <div className={`project-main ${editingTitle ? 'is-editing' : ''}`}>
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
          <button ref={titleButtonRef} type="button" className="project-title" title={`${project.title} (Double-click or F2 to rename)`} disabled={rowBusy} onClick={(event) => {
            window.clearTimeout(clickTimer.current)
            if (event.detail === 0) onOpenDetail(project.id)
            else if (event.detail === 1) clickTimer.current = window.setTimeout(() => onOpenDetail(project.id), 185)
          }} onDoubleClick={startRename}>{project.title}</button>
          <button
            type="button"
            className={`progress-button ${project.progressedToday ? 'checked' : ''} ${isTerminal && !project.progressedToday ? 'terminal-muted' : ''}`}
            disabled={progressPending || isTerminal}
            aria-busy={progressPending}
            aria-pressed={project.progressedToday}
            onClick={() => void onAction(() => api.setProjectProgress(project.id, undefined, !project.progressedToday, project.version), project.progressedToday ? 'Removed today\'s progress' : 'Logged progress for today', { key: `${rowPrefix}progress`, invalidate: PROJECT_KEYS })}
            title={project.status === 'active' ? (project.progressedToday ? 'Remove today\'s progress' : 'Log progress for today') : 'Terminal projects can remove past progress from the calendar'}
          >
            {project.progressedToday ? <><CheckIcon size={12} strokeWidth={2.3} /><span>Progressed</span></> : <><PlusIcon size={12} strokeWidth={2.2} /><span>Log Today</span></>}
          </button>
          <button type="button" className="icon-button add-child-button" disabled={rowBusy} aria-label={`Add subproject under ${project.title}`} title="Add subproject" onClick={() => onStartAddChild(project.id)}><PlusIcon size={15} /></button>
        </>}
      </div>
      <div className="project-tail">
        {depth > MAX_TREE_INDENT && <span className="depth-label">Level {depth + 1}</span>}
        {isTerminal && terminalDate && <span className={`terminal-date-badge ${project.status}`} title={`${STATUS_TEXT[project.status]} on ${terminalDate}`}>{STATUS_TEXT[project.status]} {formatShortDate(terminalDate)}</span>}
        <button
          type="button"
          className={`progress-history-button ${project.progressCount === 0 ? 'empty' : ''}`}
          disabled={rowBusy}
          onClick={() => onOpenCalendar(project.id)}
          aria-label={project.progressCount > 0 ? `Open progress calendar (${project.progressCount} ${project.progressCount === 1 ? 'day' : 'days'} logged)` : `Open progress calendar for ${project.title}`}
          title={project.progressCount > 0 ? `${project.progressCount} ${project.progressCount === 1 ? 'day' : 'days'} logged · Click to open calendar` : 'Open progress calendar'}
        >
          <CalendarIcon size={13} className="progress-calendar-icon" />
          {project.progressCount > 0 && <>
            <span className="progress-dates">
              {project.recentProgressDates.map((date) => <time key={date} dateTime={date}>{formatShortDate(date)}</time>)}
              {project.progressCount > 3 && <span className="progress-more">+{project.progressCount - 3}</span>}
            </span>
            <span className="progress-total">{project.progressCount}d</span>
          </>}
        </button>
        <ActionMenu label={`More actions for ${project.title}`} items={menuItems} disabled={rowBusy} contextAnchor={contextAnchor} onContextClose={closeContext} />
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
