import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useQueries } from '@tanstack/react-query'
import { api } from '../api'
import { CloseIcon, CollapseAllIcon, ExpandAllIcon, PlusIcon, SearchIcon } from '../components/icons'
import { EmptyState } from '../components/ui'
import type { ActionRunner } from '../components/ui'
import type { DropPosition } from '../constants'
import { loadInactiveThresholdDays, saveInactiveThresholdDays } from '../preferences'
import type { InactiveThresholdDays } from '../preferences'
import {
  buildProgressDatesMapFromWeeks,
  collectAncestorIds,
  filterProjectTree,
} from '../project-filters'
import type { ProjectFilter } from '../project-filters'
import { buildProjectDisplayItems, computeReorderedIds, createProjectTree, MAX_TREE_INDENT, TREE_INDENT } from '../project-tree'
import type { ProjectTreeRow } from '../project-tree'
import { EXPAND_KEYS, PROJECT_KEYS } from '../query-keys'
import type { ISODate, ProjectDto } from '../types'
import { getRecentWeekStarts } from '../ui-format'
import { InlineChildRow, ProjectRow } from './ProjectRow'
import type { DragProjectState } from './ProjectRow'

const FILTER_OPTIONS: readonly { value: ProjectFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'canceled', label: 'Canceled' },
  { value: 'logged-today', label: 'Logged Today' },
  { value: 'not-logged-today', label: 'Not Logged Today' },
  { value: 'inactive', label: 'Inactive' },
]

export function ProjectView({
  projects,
  loading,
  pendingKey,
  today,
  selectedProjectId,
  detailPanelOpen,
  focusCreateTick,
  focusSearchTick,
  addChildRequest,
  locateTarget,
  onClearAddChildRequest,
  onAction,
  onOpenDetail,
  onOpenCalendar,
}: {
  projects: ProjectDto[]
  loading: boolean
  pendingKey: string | null
  today: ISODate
  selectedProjectId: string | null
  detailPanelOpen: boolean
  focusCreateTick: number
  focusSearchTick: number
  addChildRequest: { parentId: string; tick: number } | null
  locateTarget: { projectId: string; tick: number } | null
  onClearAddChildRequest: () => void
  onAction: ActionRunner
  onOpenDetail: (id: string) => void
  onOpenCalendar: (id: string) => void
}) {
  const [newTitle, setNewTitle] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<ProjectFilter>('all')
  const [inactiveDays, setInactiveDays] = useState<InactiveThresholdDays>(() => loadInactiveThresholdDays())
  const [addingChildParentId, setAddingChildParentId] = useState<string | null>(null)
  const [locatedProjectId, setLocatedProjectId] = useState<string | null>(null)
  const [locatedExpandedIds, setLocatedExpandedIds] = useState<Set<string>>(() => new Set())
  const [dragState, setDragState] = useState<DragProjectState | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null)
  const [wideViewport, setWideViewport] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1440 : false))

  const createInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onResize = () => setWideViewport(window.innerWidth >= 1440)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (focusCreateTick > 0) createInputRef.current?.focus({ preventScroll: true })
  }, [focusCreateTick])

  useEffect(() => {
    if (focusSearchTick > 0) {
      searchInputRef.current?.focus({ preventScroll: true })
      searchInputRef.current?.select()
    }
  }, [focusSearchTick])

  useEffect(() => {
    if (!addChildRequest) return
    setAddingChildParentId(addChildRequest.parentId)
    onClearAddChildRequest()
  }, [addChildRequest, onClearAddChildRequest])

  useEffect(() => {
    if (addingChildParentId && !projects.some((project) => project.id === addingChildParentId)) {
      setAddingChildParentId(null)
    }
  }, [addingChildParentId, projects])

  useEffect(() => {
    if (!locateTarget) return
    const targetId = locateTarget.projectId
    if (!projects.some((item) => item.id === targetId)) return
    setSearchQuery('')
    setFilter('all')
    const ancestors = collectAncestorIds(projects, targetId)
    setLocatedExpandedIds(new Set(ancestors))
    setLocatedProjectId(targetId)
    const frame = window.requestAnimationFrame(() => {
      const rowElement = treeRef.current?.querySelector<HTMLElement>(`[data-project-id="${targetId}"]`)
      rowElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      rowElement?.querySelector<HTMLElement>('[data-tree-focus-target]')?.focus({ preventScroll: true })
    })
    const timer = window.setTimeout(() => setLocatedProjectId(null), 1700)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [locateTarget, projects])

  const timelineDays: 14 | 30 = wideViewport && !detailPanelOpen ? 30 : 14
  const recentWeekStarts = useMemo(() => getRecentWeekStarts(today, 30), [today])
  const weekQueries = useQueries({
    queries: recentWeekStarts.map((ws) => ({
      queryKey: ['dailyWeek', ws],
      queryFn: () => api.getDailyWeek(ws),
      staleTime: 30_000,
    })),
  })
  const progressDatesByProject = useMemo(
    () => buildProgressDatesMapFromWeeks(weekQueries.map((q) => q.data)),
    [weekQueries],
  )

  const filtered = useMemo(
    () => filterProjectTree(projects, { query: searchQuery, filter, today, inactiveDays }),
    [projects, searchQuery, filter, today, inactiveDays],
  )

  const tempExpandedIds = useMemo(() => {
    const merged = new Set<string>(filtered.tempExpandedIds)
    if (addingChildParentId) merged.add(addingChildParentId)
    for (const id of locatedExpandedIds) merged.add(id)
    return merged.size > 0 ? merged : undefined
  }, [filtered.tempExpandedIds, addingChildParentId, locatedExpandedIds])

  const { grouped, rows, hasBranches } = useMemo(
    () => createProjectTree(filtered.filteredProjects, tempExpandedIds),
    [filtered.filteredProjects, tempExpandedIds],
  )
  const displayItems = useMemo(
    () => buildProjectDisplayItems(rows, addingChildParentId, tempExpandedIds),
    [rows, addingChildParentId, tempExpandedIds],
  )

  const treeMinWidth = 360 + rows.reduce(
    (width, row) => Math.max(width, Math.min(row.depth, MAX_TREE_INDENT) * TREE_INDENT + (row.depth > MAX_TREE_INDENT ? 48 : 0)),
    0,
  )

  const creatingRoot = pendingKey === 'project:create-root'
  const bulkExpanding = pendingKey === 'project:expand-all'

  const clearFilters = useCallback(() => {
    setSearchQuery('')
    setFilter('all')
  }, [])

  const focusProjectRow = useCallback((projectId: string) => {
    window.requestAnimationFrame(() => {
      const target = treeRef.current?.querySelector<HTMLElement>(`[data-project-id="${projectId}"] [data-tree-focus-target]`)
      target?.focus({ preventScroll: false })
    })
  }, [])

  const handleTreeKeyDown = useCallback((
    event: KeyboardEvent<HTMLElement>,
    row: ProjectTreeRow,
    visuallyExpanded: boolean,
  ) => {
    const currentIndex = rows.findIndex((item) => item.project.id === row.project.id)
    if (currentIndex < 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = rows[currentIndex + 1]
      if (next) focusProjectRow(next.project.id)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const prev = rows[currentIndex - 1]
      if (prev) focusProjectRow(prev.project.id)
    } else if (event.key === 'Home') {
      event.preventDefault()
      if (rows[0]) focusProjectRow(rows[0].project.id)
    } else if (event.key === 'End') {
      event.preventDefault()
      const last = rows[rows.length - 1]
      if (last) focusProjectRow(last.project.id)
    } else if (event.key === 'ArrowRight') {
      if (!row.hasChildren) return
      event.preventDefault()
      if (!visuallyExpanded) {
        void onAction(
          () => api.setProjectExpanded(row.project.id, true),
          undefined,
          { key: `project:${row.project.id}:expand`, invalidate: EXPAND_KEYS, keepNotice: true },
        )
      } else {
        const next = rows[currentIndex + 1]
        if (next && next.project.parentId === row.project.id) {
          focusProjectRow(next.project.id)
        }
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (row.hasChildren && visuallyExpanded) {
        void onAction(
          () => api.setProjectExpanded(row.project.id, false),
          undefined,
          { key: `project:${row.project.id}:expand`, invalidate: EXPAND_KEYS, keepNotice: true },
        )
      } else if (row.project.parentId) {
        focusProjectRow(row.project.parentId)
      }
    }
  }, [rows, focusProjectRow, onAction])

  const reorder = async (parentId: string | null, fromId: string, targetId: string, position: DropPosition) => {
    if (pendingKey !== null || filtered.isFiltered) return
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

  const handleInactiveDaysChange = (next: InactiveThresholdDays) => {
    setInactiveDays(next)
    saveInactiveThresholdDays(next)
  }

  const countText = filtered.isFiltered
    ? `${filtered.directMatchCount} / ${projects.length}`
    : String(projects.length)

  return <section className="view-stack" aria-label="Projects">
    <div className="page-toolbar">
      <div className="projects-toolbar-left">
        <div className="page-title">
          <h1>Projects</h1>
          <span className="count-label" title={filtered.isFiltered ? `${filtered.directMatchCount} matching projects out of ${projects.length}` : `${projects.length} total projects`}>{countText}</span>
        </div>
        <div className="tree-controls" role="group" aria-label="Tree expansion controls">
          <button
            type="button"
            disabled={bulkExpanding || loading || !hasBranches}
            onClick={() => void onAction(() => api.setAllProjectsExpanded(true), 'Expanded all projects', { key: 'project:expand-all', invalidate: EXPAND_KEYS })}
            title="Expand all branches"
          ><ExpandAllIcon size={13} /><span>Expand</span></button>
          <button
            type="button"
            disabled={bulkExpanding || loading || !hasBranches}
            onClick={() => {
              setLocatedExpandedIds(new Set())
              void onAction(() => api.setAllProjectsExpanded(false), 'Collapsed all projects', { key: 'project:expand-all', invalidate: EXPAND_KEYS })
            }}
            title="Collapse all branches"
          ><CollapseAllIcon size={13} /><span>Collapse</span></button>
        </div>
      </div>

      <div className="projects-toolbar-right">
        <div className="project-search-box">
          <span className="project-search-icon" aria-hidden="true"><SearchIcon size={14} /></span>
          <input
            ref={searchInputRef}
            type="search"
            className="search-input"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && searchQuery) {
                event.preventDefault()
                setSearchQuery('')
              }
            }}
            placeholder="Search projects… (⌘K)"
            aria-label="Search projects"
          />
          {searchQuery && <button
            type="button"
            className="icon-button search-clear-btn"
            aria-label="Clear search"
            onClick={() => { setSearchQuery(''); searchInputRef.current?.focus() }}
          ><CloseIcon size={12} /></button>}
        </div>

        <form className="create-bar" onSubmit={(event) => { event.preventDefault(); void createRoot() }}>
          <input
            ref={createInputRef}
            className="create-input"
            value={newTitle}
            readOnly={creatingRoot || loading}
            aria-busy={creatingRoot || loading}
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') setNewTitle('') }}
            placeholder="New project… (N)"
            aria-label="New top-level project"
          />
          <button type="submit" className="primary-button" disabled={creatingRoot || loading || !newTitle.trim()}>
            <PlusIcon size={14} /><span>{creatingRoot ? 'Adding…' : 'New Project'}</span>
          </button>
        </form>
      </div>
    </div>

    <div className="project-filter-bar" role="region" aria-label="Project filters">
      <div className="filter-chip-group" role="group" aria-label="Filter projects">
        {FILTER_OPTIONS.map((option) => <button
          key={option.value}
          type="button"
          className={`filter-chip ${filter === option.value ? 'active' : ''}`}
          aria-pressed={filter === option.value}
          onClick={() => setFilter(option.value)}
        >{option.label}</button>)}
        {filter === 'inactive' && <select
          className="inactive-threshold-select"
          aria-label="Inactivity threshold"
          value={inactiveDays}
          onChange={(event) => handleInactiveDaysChange(Number(event.target.value) as InactiveThresholdDays)}
        >
          <option value={7}>No activity in 7d</option>
          <option value={14}>No activity in 14d</option>
          <option value={30}>No activity in 30d</option>
        </select>}
      </div>
      {filtered.isFiltered && <button type="button" className="ghost-button btn-sm" onClick={clearFilters}>Clear Filters</button>}
    </div>

    <div className={`project-list card ${dragState ? 'is-reordering' : ''}`} aria-busy={loading}>
      {loading ? <div className="loading-state">Loading projects…</div> : projects.length === 0 ? <EmptyState
        title="No projects yet."
        description="Create your first project and start tracking progress."
      /> : displayItems.length === 0 ? <EmptyState
        title="No matching projects."
        description="Try a different search or clear your filters."
        action={<button type="button" className="secondary-button btn-sm" onClick={clearFilters}>Clear Filters</button>}
      /> : <div ref={treeRef} className="project-tree" role="tree" aria-label="Project tree" style={{ minWidth: `${treeMinWidth}px` }}>
        {displayItems.map((item) => item.kind === 'project'
          ? <ProjectRow
            key={item.row.project.id}
            row={item.row}
            visuallyExpanded={item.visuallyExpanded}
            showDownGuide={item.showDownGuide}
            projects={projects}
            pendingKey={pendingKey}
            today={today}
            isSelected={selectedProjectId === item.row.project.id}
            isLocated={locatedProjectId === item.row.project.id}
            isAncestorContext={filtered.ancestorIds.has(item.row.project.id)}
            isFiltered={filtered.isFiltered}
            showInactiveHint={filter === 'inactive'}
            inactiveThresholdDays={inactiveDays}
            timelineDays={timelineDays}
            progressDatesByProject={progressDatesByProject}
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
            onTreeKeyDown={handleTreeKeyDown}
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
      </div>}
    </div>
  </section>
}
