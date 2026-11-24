import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { CollapseAllIcon, ExpandAllIcon } from '../components/icons'
import { EmptyState } from '../components/ui'
import type { ActionRunner } from '../components/ui'
import type { DropPosition } from '../constants'
import { buildProjectDisplayItems, computeReorderedIds, createProjectTree, MAX_TREE_INDENT, TREE_INDENT } from '../project-tree'
import { EXPAND_KEYS, PROJECT_KEYS } from '../query-keys'
import type { ProjectDto } from '../types'
import { InlineChildRow, ProjectRow } from './ProjectRow'
import type { DragProjectState } from './ProjectRow'

export function ProjectView({
  projects,
  loading,
  pendingKey,
  today,
  focusCreateTick,
  onAction,
  onOpenDetail,
  onOpenCalendar,
}: {
  projects: ProjectDto[]
  loading: boolean
  pendingKey: string | null
  today: string
  focusCreateTick: number
  onAction: ActionRunner
  onOpenDetail: (id: string) => void
  onOpenCalendar: (id: string) => void
}) {
  const [newTitle, setNewTitle] = useState('')
  const [addingChildParentId, setAddingChildParentId] = useState<string | null>(null)
  const [dragState, setDragState] = useState<DragProjectState | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null)
  const createInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusCreateTick > 0) createInputRef.current?.focus({ preventScroll: true })
  }, [focusCreateTick])

  useEffect(() => {
    if (addingChildParentId && !projects.some((project) => project.id === addingChildParentId)) {
      setAddingChildParentId(null)
    }
  }, [addingChildParentId, projects])

  const tempExpandedIds = useMemo(
    () => addingChildParentId ? new Set([addingChildParentId]) : undefined,
    [addingChildParentId],
  )
  const { grouped, rows, hasBranches } = useMemo(() => createProjectTree(projects, tempExpandedIds), [projects, tempExpandedIds])
  const displayItems = useMemo(
    () => buildProjectDisplayItems(rows, addingChildParentId, tempExpandedIds),
    [rows, addingChildParentId, tempExpandedIds],
  )
  const treeMinWidth = 360 + rows.reduce((width, row) => Math.max(width, Math.min(row.depth, MAX_TREE_INDENT) * TREE_INDENT + (row.depth > MAX_TREE_INDENT ? 76 : 0)), 0)

  const creatingRoot = pendingKey === 'project:create-root'
  const bulkExpanding = pendingKey === 'project:expand-all'

  const reorder = async (parentId: string | null, fromId: string, targetId: string, position: DropPosition) => {
    if (pendingKey !== null) return
    const siblingIds = (grouped.get(parentId) ?? []).map((item) => item.id)
    const nextIds = computeReorderedIds(siblingIds, fromId, targetId, position)
    if (!nextIds) return
    await onAction(
      () => api.reorderProjectSiblings(parentId, nextIds),
      'Project order saved',
      { key: `project:${fromId}:reorder`, invalidate: PROJECT_KEYS },
    )
  }

  const createRoot = async () => {
    if (creatingRoot || loading || !newTitle.trim()) return
    const result = await onAction(
      () => api.createProject(newTitle.trim()),
      'Project created',
      { key: 'project:create-root', invalidate: PROJECT_KEYS },
    )
    if (result.ok) {
      setNewTitle('')
      createInputRef.current?.focus({ preventScroll: true })
    }
  }

  const clearDrag = useCallback(() => {
    setDragState(null)
    setDropTarget(null)
  }, [])

  const handleDragHover = useCallback((id: string, position: DropPosition) => {
    setDropTarget((prev) => prev?.id === id && prev.position === position ? prev : { id, position })
  }, [])

  const handleDragLeave = useCallback((id: string) => {
    setDropTarget((prev) => prev?.id === id ? null : prev)
  }, [])

  return <section className="view-stack" aria-label="Projects">
    <div className="page-toolbar">
      <div className="page-title project-page-title">
        <h1>Projects</h1>
        <span className="count-label">{projects.length}</span>
        <div className="tree-controls" role="group" aria-label="Tree expansion controls">
          <button type="button" className="secondary-button icon-text-button" disabled={bulkExpanding || loading || !hasBranches} onClick={() => void onAction(() => api.setAllProjectsExpanded(true), 'Expanded all projects', { key: 'project:expand-all', invalidate: EXPAND_KEYS })}><ExpandAllIcon size={13} />Expand All</button>
          <button type="button" className="secondary-button icon-text-button" disabled={bulkExpanding || loading || !hasBranches} onClick={() => void onAction(() => api.setAllProjectsExpanded(false), 'Collapsed all projects', { key: 'project:expand-all', invalidate: EXPAND_KEYS })}><CollapseAllIcon size={13} />Collapse All</button>
        </div>
      </div>
      <form className="create-bar" onSubmit={(event) => { event.preventDefault(); void createRoot() }}>
        <input ref={createInputRef} value={newTitle} readOnly={creatingRoot || loading} aria-busy={creatingRoot || loading} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setNewTitle('') }} placeholder="New project… (N)" aria-label="New top-level project" />
        <button type="submit" className="primary-button" disabled={creatingRoot || loading || !newTitle.trim()}>{creatingRoot ? 'Adding…' : 'Add'}</button>
      </form>
    </div>
    <div className={`project-list card ${dragState ? 'is-reordering' : ''}`} aria-busy={loading}>
      {loading ? <div className="loading-state">Loading projects…</div> : projects.length ? <div className="project-tree" role="list" aria-label="Project tree" style={{ minWidth: `${treeMinWidth}px` }}>
        {displayItems.map((item) => item.kind === 'project'
          ? <ProjectRow
            key={item.row.project.id}
            row={item.row}
            visuallyExpanded={item.visuallyExpanded}
            showDownGuide={item.showDownGuide}
            projects={projects}
            pendingKey={pendingKey}
            today={today}
            dragState={dragState}
            dropPosition={dropTarget?.id === item.row.project.id ? dropTarget.position : null}
            onAction={onAction}
            onOpenDetail={onOpenDetail}
            onOpenCalendar={onOpenCalendar}
            addingChild={addingChildParentId === item.row.project.id}
            onStartAddChild={setAddingChildParentId}
            onStopAddChild={() => setAddingChildParentId(null)}
            onDragStart={setDragState}
            onDragEnd={clearDrag}
            onDragHover={handleDragHover}
            onDragLeave={handleDragLeave}
            onReorder={reorder}
          />
          : <InlineChildRow
            key={`child-input-${item.parent.id}`}
            parent={item.parent}
            depth={item.depth}
            continuationDepths={item.continuationDepths}
            submitting={pendingKey === `project:${item.parent.id}:child`}
            onAction={onAction}
            onClose={() => setAddingChildParentId(null)}
          />)}
      </div> : <EmptyState>No projects yet. Add one above to get started.</EmptyState>}
    </div>
  </section>
}
