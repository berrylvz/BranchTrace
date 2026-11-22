import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BranchNodeIcon,
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  CollapseAllIcon,
  CornerDownRightIcon,
  ExpandAllIcon,
  GripIcon,
  KeyboardIcon,
  MinusIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  ProgressArrowIcon,
  ReminderIcon,
  SettingsIcon,
  SunIcon,
  TrashIcon,
} from './components/icons'
import { MonthlyView } from './components/MonthlyView'
import { MoveProjectDialog } from './components/MoveProjectDialog'
import { ActionMenu, AppErrorBoundary, ConfirmDialog, errorMessage, FormDialog, isEditableElement, LoadError, Modal } from './components/ui'
import type { ActionRunner, NoticeConfig } from './components/ui'
import { buildProjectDisplayItems, computeReorderedIds, createProjectTree, MAX_TREE_INDENT, TREE_INDENT, TREE_TOGGLE_WIDTH } from './project-tree'
import type { ProjectTreeRow } from './project-tree'
import {
  formatFullDate,
  formatMonthDay,
  formatMonthLabel,
  formatShortDate,
  formatTrashTimestamp,
  formatWeekdayShort,
  formatWeekRange,
  getWeekStart,
  groupProgressDatesByMonth,
  isWeekendDate,
} from './ui-format'
import type { ApiError, DailyDayDto, DailyWeekDto, ProjectDailyItem, ProjectDetailDto, ProjectDto, ReminderDailyItem, ThemeMode, TrashEntryDto } from './types'
import './index.css'

const HALF_TOGGLE = TREE_TOGGLE_WIDTH / 2

function isStartupError(error: unknown): error is ApiError {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  const apiError = error as ApiError
  return apiError.code === 'MIGRATION_ERROR' || apiError.details?.startupError === true
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (failureCount, error) => !isStartupError(error) && failureCount < 1,
    },
  },
})

const ALL_QUERY_KEYS = ['projectTree', 'projectDetail', 'projectProgressMonth', 'dailyWeek', 'monthCalendar', 'reminder', 'trash', 'settings', 'clockContext'] as const
const EXPAND_KEYS = ['projectTree'] as const
const PROJECT_KEYS = ['projectTree', 'projectDetail', 'projectProgressMonth', 'dailyWeek', 'monthCalendar'] as const
const TRASH_KEYS = ['projectTree', 'projectDetail', 'projectProgressMonth', 'dailyWeek', 'monthCalendar', 'reminder', 'trash'] as const
const SETTINGS_KEYS = ['settings'] as const

const statusText = { active: 'Active', completed: 'Completed', canceled: 'Canceled' } as const
type View = 'project' | 'weekly' | 'monthly' | 'trash' | 'settings'
type DropPosition = 'before' | 'after'

function AppShell() {
  const client = useQueryClient()
  const [view, setView] = useState<View>('project')
  const [weekStart, setWeekStart] = useState<string | null>(null)
  const [month, setMonth] = useState<string | null>(null)
  const [focusedDate, setFocusedDate] = useState<string | null>(null)
  const [focusDayTick, setFocusDayTick] = useState(0)
  const [trashKind, setTrashKind] = useState<'project' | 'reminder'>('project')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [calendarProjectId, setCalendarProjectId] = useState<string | null>(null)
  const [notice, setNotice] = useState<NoticeConfig | null>(null)
  const [noticePaused, setNoticePaused] = useState(false)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [focusCreateTick, setFocusCreateTick] = useState(0)
  const actionLock = useRef(false)
  const previousClock = useRef<{ today: string; weekStart: string } | null>(null)

  const clock = useQuery({ queryKey: ['clockContext'], queryFn: api.getClockContext, refetchInterval: 60_000 })
  const projects = useQuery({ queryKey: ['projectTree'], queryFn: api.getProjectTree })
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getAppSettings })
  const weekly = useQuery({ queryKey: ['dailyWeek', weekStart], queryFn: () => api.getDailyWeek(weekStart!), enabled: view === 'weekly' && Boolean(weekStart) })
  const monthly = useQuery({ queryKey: ['monthCalendar', month], queryFn: () => api.getMonthCalendar(month!), enabled: view === 'monthly' && Boolean(month) })
  const trash = useQuery({ queryKey: ['trash', trashKind], queryFn: () => api.listTrash(trashKind), enabled: view === 'trash' })
  const detail = useQuery({ queryKey: ['projectDetail', selectedProjectId], queryFn: () => api.getProjectDetail(selectedProjectId!), enabled: Boolean(selectedProjectId) })

  useEffect(() => {
    const current = clock.data
    if (!current) return
    const previous = previousClock.current
    previousClock.current = { today: current.today, weekStart: current.weekStart }
    const currentMonthKey = current.today.slice(0, 7)
    if (!previous) {
      setWeekStart((currentWeek) => currentWeek ?? current.weekStart)
      setMonth((currentMonth) => currentMonth ?? currentMonthKey)
      return
    }
    if (previous.today !== current.today || previous.weekStart !== current.weekStart) {
      const previousMonthKey = previous.today.slice(0, 7)
      setWeekStart((currentWeek) => (!currentWeek || currentWeek === previous.weekStart ? current.weekStart : currentWeek))
      setMonth((currentMonth) => (!currentMonth || currentMonth === previousMonthKey ? currentMonthKey : currentMonth))
      void Promise.all(
        ['projectTree', 'dailyWeek', 'monthCalendar', 'projectDetail', 'projectProgressMonth']
          .map((key) => client.invalidateQueries({ queryKey: [key] })),
      )
    }
  }, [clock.data, client])

  useEffect(() => {
    const syncClock = () => {
      if (document.visibilityState === 'hidden') return
      void client.invalidateQueries({ queryKey: ['clockContext'] })
    }
    window.addEventListener('focus', syncClock)
    document.addEventListener('visibilitychange', syncClock)
    return () => {
      window.removeEventListener('focus', syncClock)
      document.removeEventListener('visibilitychange', syncClock)
    }
  }, [client])

  useEffect(() => {
    if (!notice || notice.error || noticePaused) return
    const timeout = window.setTimeout(() => setNotice(null), notice.durationMs ?? 3500)
    return () => window.clearTimeout(timeout)
  }, [notice, noticePaused])

  useEffect(() => {
    const mode = settings.data?.themeMode ?? 'system'
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = mode === 'dark' || (mode === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#131a16' : '#f6f8f7')
    }
    apply()
    if (mode !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.data?.themeMode])

  const openWeeklyView = useCallback(() => {
    setFocusedDate(null)
    setView('weekly')
    void client
      .fetchQuery({ queryKey: ['clockContext'], queryFn: api.getClockContext, staleTime: 0 })
      .then((fresh) => {
        setWeekStart(fresh.weekStart)
        return Promise.all([
          client.invalidateQueries({ queryKey: ['dailyWeek'] }),
          client.invalidateQueries({ queryKey: ['projectTree'] }),
        ])
      })
      .catch(() => {
        if (clock.data) setWeekStart(clock.data.weekStart)
      })
  }, [client, clock.data])

  const openWeeklyForDate = useCallback((date: string) => {
    const targetWeek = getWeekStart(date)
    setWeekStart(targetWeek)
    setFocusedDate(date)
    setFocusDayTick((tick) => tick + 1)
    setView('weekly')
    void Promise.all([
      client.invalidateQueries({ queryKey: ['clockContext'] }),
      client.invalidateQueries({ queryKey: ['dailyWeek', targetWeek] }),
    ])
  }, [client])

  const openMonthlyView = useCallback(() => {
    setView('monthly')
    void client
      .fetchQuery({ queryKey: ['clockContext'], queryFn: api.getClockContext, staleTime: 0 })
      .then((fresh) => {
        const freshMonth = fresh.today.slice(0, 7)
        setMonth((current) => current ?? freshMonth)
        return Promise.all([
          client.invalidateQueries({ queryKey: ['monthCalendar'] }),
          client.invalidateQueries({ queryKey: ['projectTree'] }),
        ])
      })
      .catch(() => {
        if (clock.data) setMonth((current) => current ?? clock.data.today.slice(0, 7))
      })
  }, [client, clock.data])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (document.getElementById('root')?.hasAttribute('inert')) return
      if (document.querySelector('[role="menu"]')) return
      if (isEditableElement(event.target)) return
      const mod = event.ctrlKey || event.metaKey
      if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setView('project')
        setFocusCreateTick((tick) => tick + 1)
        return
      }
      if (!event.altKey && !event.shiftKey && (event.key === '1' || event.key === '2' || event.key === '3')) {
        event.preventDefault()
        if (event.key === '1') setView('project')
        else if (event.key === '2') openWeeklyView()
        else openMonthlyView()
        return
      }
      if (!mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setView('project')
        setFocusCreateTick((tick) => tick + 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openWeeklyView, openMonthlyView])

  const invalidateKeys = useCallback((keys: readonly string[]) => Promise.all(
    keys.map((key) => client.invalidateQueries({ queryKey: [key] }, { throwOnError: true })),
  ), [client])

  const perform: ActionRunner = useCallback(async (action, success, options) => {
    if (actionLock.current) return { ok: false, message: 'Another action is in progress. Please wait.' }
    actionLock.current = true
    setPendingKey(options?.key ?? 'global')
    if (!options?.keepNotice) {
      setNotice(null)
      setNoticePaused(false)
    }
    const keys = options?.invalidate ?? ALL_QUERY_KEYS
    try {
      let data: Awaited<ReturnType<typeof action>>
      try {
        data = await action()
      } catch (error) {
        const message = errorMessage(error)
        setNotice({ message, error: true })
        // Refresh versions before a retained draft can be submitted again.
        await invalidateKeys(ALL_QUERY_KEYS).catch(() => undefined)
        return { ok: false, message }
      }
      try {
        await invalidateKeys(keys)
        if (success) {
          const resolved = typeof success === 'function' ? success(data) : success
          if (typeof resolved === 'string') setNotice({ message: resolved })
          else if (resolved) setNotice(resolved)
        }
      } catch {
        // The write committed; keep a refresh failure from causing a duplicate write.
        setNotice({ message: 'Saved, but refreshing the view failed. Please reopen this page.', error: true })
      }
      return { ok: true, data }
    } finally {
      actionLock.current = false
      setPendingKey(null)
    }
  }, [invalidateKeys])

  const startupError = ([projects.error, settings.error, weekly.error, monthly.error, trash.error] as unknown[]).find(isStartupError)
  if (startupError) {
    return <StartupErrorView error={startupError} />
  }

  const projectList = projects.data ?? []
  const today = clock.data?.today ?? isoDate(new Date())
  const currentMonth = today.slice(0, 7)
  const calendarProject = projectList.find((project) => project.id === calendarProjectId)

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-block"><span className="brand-mark" aria-hidden="true"><BranchNodeIcon size={15} /></span><span className="brand-name">BranchTrace</span></div>
      <nav className="main-nav" aria-label="Primary views">
        <button type="button" data-focus-fallback className={`nav-item ${view === 'project' ? 'active' : ''}`} aria-current={view === 'project' ? 'page' : undefined} onClick={() => setView('project')}>Projects</button>
        <button type="button" className={`nav-item ${view === 'weekly' ? 'active' : ''}`} aria-current={view === 'weekly' ? 'page' : undefined} onClick={openWeeklyView}>Weekly</button>
        <button type="button" className={`nav-item ${view === 'monthly' ? 'active' : ''}`} aria-current={view === 'monthly' ? 'page' : undefined} onClick={openMonthlyView}>Monthly</button>
      </nav>
      <div className="top-actions">
        <time className="today-text" dateTime={today} title={`Today: ${today}`}>{formatFullDate(today)}</time>
        <span className="top-divider" aria-hidden="true" />
        <div className="utility-nav" role="group" aria-label="Utilities">
          <button
            type="button"
            className={`utility-button ${view === 'trash' ? 'active' : ''}`}
            aria-label="Trash"
            aria-current={view === 'trash' ? 'page' : undefined}
            title="Trash"
            onClick={() => setView('trash')}
          ><TrashIcon size={16} /></button>
          <button
            type="button"
            className={`utility-button ${view === 'settings' ? 'active' : ''}`}
            aria-label="Settings"
            aria-current={view === 'settings' ? 'page' : undefined}
            title="Settings"
            onClick={() => setView('settings')}
          ><SettingsIcon size={16} /></button>
        </div>
      </div>
    </header>

    {notice && createPortal(<div
      className={`notice ${notice.error ? 'notice-error' : ''}`}
      role={notice.error ? 'alert' : 'status'}
      onMouseEnter={() => setNoticePaused(true)}
      onMouseLeave={() => setNoticePaused(false)}
      onFocus={() => setNoticePaused(true)}
      onBlur={() => setNoticePaused(false)}
    >
      <span>{notice.message}</span>
      {notice.action && <button type="button" className="text-button notice-action" disabled={pendingKey === 'undo'} onClick={() => { const handler = notice.action!.onClick; setNotice(null); handler() }}>{notice.action.label}</button>}
      <button type="button" className="icon-button" onClick={() => setNotice(null)} aria-label="Dismiss notification"><CloseIcon size={14} /></button>
    </div>, document.body)}

    <main className="main-content">
      {view === 'project' && <>
        {projects.isError && <LoadError error={projects.error} retry={() => void projects.refetch()} />}
        <ProjectView projects={projectList} loading={projects.isLoading} pendingKey={pendingKey} today={today} focusCreateTick={focusCreateTick} onAction={perform} onOpenDetail={setSelectedProjectId} onOpenCalendar={setCalendarProjectId} />
      </>}
      {view === 'weekly' && <>
        {clock.isError && <LoadError error={clock.error} retry={() => void clock.refetch()} />}
        {weekly.isError && <LoadError error={weekly.error} retry={() => void weekly.refetch()} />}
        <WeeklyView
          weekly={weekly.data}
          weekStart={weekStart ?? clock.data?.weekStart ?? ''}
          currentWeekStart={clock.data?.weekStart ?? ''}
          focusedDate={focusedDate}
          focusDayTick={focusDayTick}
          onWeekChange={setWeekStart}
          onFocusDateChange={setFocusedDate}
          onOpenDetail={setSelectedProjectId}
        />
      </>}
      {view === 'monthly' && <>
        {clock.isError && <LoadError error={clock.error} retry={() => void clock.refetch()} />}
        {monthly.isError && <LoadError error={monthly.error} retry={() => void monthly.refetch()} />}
        <MonthlyView
          calendar={monthly.data}
          month={month ?? currentMonth}
          currentMonth={currentMonth}
          today={today}
          pendingKey={pendingKey}
          onMonthChange={setMonth}
          onSelectDay={openWeeklyForDate}
          onAction={perform}
        />
      </>}
      {view === 'trash' && <>
        {trash.isError && <LoadError error={trash.error} retry={() => void trash.refetch()} />}
        <TrashView kind={trashKind} entries={trash.data ?? []} loading={trash.isLoading} pendingKey={pendingKey} onKindChange={setTrashKind} onAction={perform} />
      </>}
      {view === 'settings' && <>
        {settings.isError && <LoadError error={settings.error} retry={() => void settings.refetch()} />}
        <SettingsView mode={settings.data?.themeMode ?? 'system'} pending={pendingKey === 'settings:theme' || settings.isLoading} onAction={perform} />
      </>}
    </main>

    {selectedProjectId && <ProjectDetailModal detail={detail.data} loading={detail.isLoading} error={detail.error} retry={() => void detail.refetch()} onClose={() => setSelectedProjectId(null)} />}
    {calendarProject && <ProgressCalendarModal project={calendarProject} today={today} pending={pendingKey === `calendar:${calendarProject.id}`} onAction={perform} onClose={() => setCalendarProjectId(null)} />}
  </div>
}

interface DragProjectState {
  id: string
  parentId: string | null
}

function ProjectView({ projects, loading, pendingKey, today, focusCreateTick, onAction, onOpenDetail, onOpenCalendar }: { projects: ProjectDto[]; loading: boolean; pendingKey: string | null; today: string; focusCreateTick: number; onAction: ActionRunner; onOpenDetail: (id: string) => void; onOpenCalendar: (id: string) => void }) {
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

function InlineChildRow({
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

type ProjectDialog = 'terminal' | 'move' | 'trash'

function ProjectRow({
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
      <span className={`status-dot ${project.status}`} role="img" aria-label={`Status: ${statusText[project.status]}`} title={statusText[project.status]}>
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
        {isTerminal && terminalDate && <span className={`terminal-date-badge ${project.status}`} title={`${statusText[project.status]} on ${terminalDate}`}>{statusText[project.status]} {formatShortDate(terminalDate)}</span>}
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

function WeeklyView({
  weekly,
  weekStart,
  currentWeekStart,
  focusedDate,
  focusDayTick,
  onWeekChange,
  onFocusDateChange,
  onOpenDetail,
}: {
  weekly: DailyWeekDto | undefined
  weekStart: string
  currentWeekStart: string
  focusedDate: string | null
  focusDayTick: number
  onWeekChange: (value: string) => void
  onFocusDateChange: (date: string | null) => void
  onOpenDetail: (id: string) => void
}) {
  const weekGridRef = useRef<HTMLDivElement>(null)

  const moveWeek = useCallback((amount: number) => {
    if (!weekStart) return
    const date = dateFrom(weekStart)
    date.setDate(date.getDate() + amount * 7)
    onFocusDateChange(null)
    onWeekChange(isoDate(date))
  }, [weekStart, onWeekChange, onFocusDateChange])

  const jumpToCurrentWeek = useCallback(() => {
    if (!currentWeekStart) return
    onFocusDateChange(null)
    onWeekChange(currentWeekStart)
    window.requestAnimationFrame(() => {
      weekGridRef.current?.querySelector<HTMLElement>('.day-column.today')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
    })
  }, [currentWeekStart, onWeekChange, onFocusDateChange])

  useEffect(() => {
    if (!weekly || !focusedDate) return
    if (!weekly.days.some((day) => day.date === focusedDate)) return
    const frame = window.requestAnimationFrame(() => {
      weekGridRef.current
        ?.querySelector<HTMLElement>(`[data-day-date="${focusedDate}"]`)
        ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [weekly, focusedDate, focusDayTick])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (document.getElementById('root')?.hasAttribute('inert')) return
      if (document.querySelector('[role="menu"]')) return
      if (isEditableElement(event.target)) return
      if (event.key === 'ArrowLeft' || event.key === '[') {
        event.preventDefault()
        moveWeek(-1)
      } else if (event.key === 'ArrowRight' || event.key === ']') {
        event.preventDefault()
        moveWeek(1)
      } else if (event.key.toLowerCase() === 't') {
        event.preventDefault()
        jumpToCurrentWeek()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [moveWeek, jumpToCurrentWeek])

  const weekEnd = weekStart ? dateFrom(weekStart) : null
  weekEnd?.setDate(weekEnd.getDate() + 6)
  const isCurrentWeek = Boolean(weekStart && currentWeekStart && weekStart === currentWeekStart)

  return <section className="view-stack daily-view" aria-label="Weekly">
    <div className="page-toolbar">
      <div className="page-title">
        <h1>Weekly</h1>
        {weekEnd && <span className="week-range">{formatWeekRange(weekStart, isoDate(weekEnd))}</span>}
        <span className="readonly-badge">Read-only</span>
      </div>
      <div className="week-controls">
        <button type="button" disabled={!weekStart} onClick={() => moveWeek(-1)} aria-label="Previous week" title="Previous week (←)"><ArrowLeftIcon size={15} /></button>
        <button type="button" className={isCurrentWeek ? 'current-week' : ''} disabled={!currentWeekStart} onClick={jumpToCurrentWeek} title="Jump to this week (T)">This Week</button>
        <button type="button" disabled={!weekStart} onClick={() => moveWeek(1)} aria-label="Next week" title="Next week (→)"><ArrowRightIcon size={15} /></button>
      </div>
    </div>
    {!weekly ? <div className="loading-state">Loading weekly overview…</div> : <div ref={weekGridRef} className="week-grid">
      {weekly.days.map((day) => <WeeklyColumn
        key={day.date}
        day={day}
        today={weekly.today}
        isSelected={focusedDate === day.date}
        onOpenDetail={onOpenDetail}
      />)}
    </div>}
  </section>
}

function WeeklyColumn({
  day,
  today,
  isSelected,
  onOpenDetail,
}: {
  day: DailyDayDto
  today: string
  isSelected: boolean
  onOpenDetail: (id: string) => void
}) {
  const plannedReminders = [...day.plannedReminders].sort((a, b) => a.reminder.sortOrder - b.reminder.sortOrder || a.reminder.id.localeCompare(b.reminder.id))
  const isToday = day.date === today
  const isPast = day.date < today
  const isWeekend = isWeekendDate(day.date)
  const hasReminders = day.plannedReminders.length + day.overdueReminders.length + day.crossDayCompletedReminders.length > 0
  const hasProjects = day.completedProjects.length > 0 || day.progressedProjects.length > 0

  return <article
    data-day-date={day.date}
    className={`day-column ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${isPast ? 'past' : ''} ${isWeekend ? 'weekend' : ''}`}
    aria-label={formatFullDate(day.date)}
    aria-current={isSelected ? 'date' : undefined}
  >
    <header className="day-header">
      <div className="day-header-main">
        <span className="day-weekday">{formatWeekdayShort(day.date)}</span>
        <time dateTime={day.date}>{formatMonthDay(day.date)}</time>
      </div>
      <div className="day-header-badges">
        {isToday && <em className="today-pill">Today</em>}
        {isSelected && !isToday && <em className="selected-pill">Selected</em>}
      </div>
    </header>
    <div className="day-body">
      {day.completedProjects.length > 0 && <DayGroup title="Completed Projects" tone="done">{day.completedProjects.map((item) => <ProjectDailyRow key={item.projectId} item={item} onOpenDetail={onOpenDetail} completed />)}</DayGroup>}
      {day.progressedProjects.length > 0 && <DayGroup title="Project Progress" tone="progress">{day.progressedProjects.map((item) => <ProjectDailyRow key={item.projectId} item={item} onOpenDetail={onOpenDetail} />)}</DayGroup>}
      {hasReminders && <DayGroup title="Reminders" tone="reminder">
        {plannedReminders.map((item) => <ReadOnlyReminderRow key={`planned-${item.reminder.id}`} item={item} />)}
        {day.overdueReminders.length > 0 && <div className="subgroup-label">Overdue</div>}
        {day.overdueReminders.map((item) => <ReadOnlyReminderRow key={`overdue-${item.reminder.id}`} item={item} overdue />)}
        {day.crossDayCompletedReminders.length > 0 && <div className="subgroup-label">Completed from Earlier</div>}
        {day.crossDayCompletedReminders.map((item) => <ReadOnlyReminderRow key={`completed-${item.reminder.id}`} item={item} />)}
      </DayGroup>}
      {!hasProjects && !hasReminders && <div className="day-empty">No items</div>}
    </div>
  </article>
}

function DayGroup({ title, tone, children }: { title: string; tone: string; children: ReactNode }) {
  return <section className={`day-group ${tone}`}><h2>{title}</h2>{children}</section>
}

function ProjectDailyRow({ item, onOpenDetail, completed = false }: { item: ProjectDailyItem; onOpenDetail: (id: string) => void; completed?: boolean }) {
  const meta = [item.parentPath.join(' / '), item.shortId].filter(Boolean).join(' · ')
  return <button type="button" className="daily-item" onClick={() => onOpenDetail(item.projectId)} title={[...item.parentPath, item.title].join(' / ')}>
    <span className="item-icon" aria-hidden="true">{completed ? <CheckIcon size={13} strokeWidth={2.2} /> : <ProgressArrowIcon size={13} strokeWidth={2} />}</span>
    <span className="item-text">
      <span className="item-heading"><strong>{item.title}</strong>{completed && item.progressedSameDay && <span className="same-day-badge">Progressed same day</span>}</span>
      {meta && <small>{meta}</small>}
    </span>
  </button>
}

function ReadOnlyReminderRow({ item, overdue = false }: { item: ReminderDailyItem; overdue?: boolean }) {
  const { reminder } = item
  const dateHint = overdue
    ? null
    : item.displayType === 'completed'
      ? { text: `Planned ${formatShortDate(reminder.scheduledDate)}`, title: `Scheduled for ${reminder.scheduledDate}` }
      : item.displayType === 'planned' && reminder.status === 'completed' && !item.isPlannedAndCompletedSameDay && reminder.completedDate
        ? { text: `Done ${formatShortDate(reminder.completedDate)}`, title: `Completed on ${reminder.completedDate}` }
        : reminder.status === 'canceled'
          ? { text: 'Canceled', title: reminder.canceledDate ? `Canceled on ${reminder.canceledDate}` : 'Canceled' }
          : null

  return <div className={`reminder-row readonly ${reminder.status} ${overdue ? 'overdue' : ''}`}>
    <span
      className="reminder-check readonly-check"
      role="img"
      aria-label={`Status: ${statusText[reminder.status]}`}
      title={statusText[reminder.status]}
    >
      {reminder.status === 'completed' && <CheckIcon size={11} strokeWidth={2.4} />}
      {reminder.status === 'canceled' && <MinusIcon size={11} strokeWidth={2.2} />}
    </span>
    <div className="reminder-content">
      <span className="reminder-title" title={reminder.title}>{reminder.title}</span>
      {overdue && <span className="overdue-label" title={`Scheduled for ${reminder.scheduledDate}`}>Overdue · {formatShortDate(reminder.scheduledDate)}</span>}
      {dateHint && <span className="reminder-date-hint" title={dateHint.title}>{dateHint.text}</span>}
    </div>
  </div>
}

function TrashView({ kind, entries, loading, pendingKey, onKindChange, onAction }: { kind: 'project' | 'reminder'; entries: TrashEntryDto[]; loading: boolean; pendingKey: string | null; onKindChange: (kind: 'project' | 'reminder') => void; onAction: ActionRunner }) {
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const emptying = pendingKey === 'trash:empty'
  return <section className="view-stack trash-view" aria-label="Trash">
    <div className="page-toolbar">
      <div className="page-title"><h1>Trash</h1><span className="count-label">{entries.length}</span></div>
      <button type="button" className="text-button danger-text" disabled={emptying || loading || !entries.length} onClick={() => setConfirmEmpty(true)}>Empty Current Tab</button>
    </div>
    <div className="segmented" aria-label="Trash category"><button type="button" aria-pressed={kind === 'project'} onClick={() => onKindChange('project')}>Projects</button><button type="button" aria-pressed={kind === 'reminder'} onClick={() => onKindChange('reminder')}>Reminders</button></div>
    <div className="trash-list card" aria-busy={loading}>{loading ? <div className="loading-state">Loading Trash…</div> : entries.length ? entries.map((entry) => <TrashRow key={entry.id} entry={entry} pending={pendingKey === `trash:${entry.id}` || emptying} onAction={onAction} />) : <EmptyState>Trash is empty.</EmptyState>}</div>
    {confirmEmpty && <ConfirmDialog title="Empty Trash" description={`Permanently delete ${entries.length} ${kind === 'project' ? 'project' : 'reminder'} ${entries.length === 1 ? 'entry' : 'entries'} and all associated data.${kind === 'project' ? ' All descendants and progress history will also be removed.' : ''} This action cannot be undone.`} confirmLabel="Delete Permanently" onClose={() => setConfirmEmpty(false)} onConfirm={() => onAction(() => api.emptyTrash(kind), 'Trash emptied', { key: 'trash:empty', invalidate: TRASH_KEYS })} />}
  </section>
}

function TrashRow({ entry, pending, onAction }: { entry: TrashEntryDto; pending: boolean; onAction: ActionRunner }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deletedTime = formatTrashTimestamp(entry.deletedAt)
  return <>
    <div className={`trash-row ${pending ? 'is-pending' : ''}`}>
      <span className="trash-kind-icon" aria-hidden="true">{entry.kind === 'project' ? <BranchNodeIcon size={16} /> : <ReminderIcon size={16} />}</span>
      <div className="trash-info">
        <strong title={entry.titleSnapshot}>{entry.titleSnapshot}</strong>
        <small title={entry.deletedAt}>{entry.kind === 'project' ? `Project tree · ${entry.affectedCountAtDelete} active ${entry.affectedCountAtDelete === 1 ? 'node' : 'nodes'} when deleted` : 'Reminder'} · <time dateTime={entry.deletedAt}>{deletedTime}</time></small>
      </div>
      <div className="trash-actions"><button type="button" className="text-button" disabled={pending} onClick={() => void onAction(() => api.restoreTrashEntry(entry.id), 'Restored', { key: `trash:${entry.id}`, invalidate: TRASH_KEYS })}>Restore</button><button type="button" className="text-button danger-text" disabled={pending} onClick={() => setConfirmDelete(true)}>Delete Permanently</button></div>
    </div>
    {confirmDelete && <ConfirmDialog title="Delete Permanently" description={entry.kind === 'project' ? `Permanently delete the project tree rooted at "${entry.titleSnapshot}"${entry.currentDescendantCount === null ? '' : ` (${entry.currentDescendantCount} ${entry.currentDescendantCount === 1 ? 'node' : 'nodes'})`} and its progress history? This action cannot be undone.` : `Permanently delete reminder "${entry.titleSnapshot}"? This action cannot be undone.`} confirmLabel="Delete Permanently" onClose={() => setConfirmDelete(false)} onConfirm={() => onAction(() => api.permanentlyDeleteTrashEntry(entry.id), 'Permanently deleted', { key: `trash:${entry.id}`, invalidate: TRASH_KEYS })} />}
  </>
}

const themeOptions: { value: ThemeMode; label: string; caption: string; preview: 'system' | 'light' | 'dark' }[] = [
  { value: 'system', label: 'System', caption: 'Automatically match your operating system appearance', preview: 'system' },
  { value: 'light', label: 'Light', caption: 'Crisp paper-like surface for daytime focus', preview: 'light' },
  { value: 'dark', label: 'Dark', caption: 'Low-glare forest dark palette for night sessions', preview: 'dark' },
]

const shortcuts: { keys: string[]; label: string }[] = [
  { keys: ['1', '2', '3'], label: 'Switch between Projects, Weekly, and Monthly views' },
  { keys: ['N'], label: 'Focus the new top-level project input' },
  { keys: ['←', '→'], label: 'Navigate previous / next week (Weekly) or month (Monthly)' },
  { keys: ['T'], label: 'Jump to This Week (Weekly) or This Month (Monthly)' },
  { keys: ['F2'], label: 'Inline rename the focused project or reminder' },
  { keys: ['Right-click'], label: 'Open the action menu on a project or reminder' },
  { keys: ['Enter', 'Esc'], label: 'Submit continuously, confirm edits, or cancel' },
]

function SettingsView({ mode, pending, onAction }: { mode: ThemeMode; pending: boolean; onAction: ActionRunner }) {
  return <section className="view-stack settings-view" aria-label="Settings">
    <div className="page-toolbar"><h1>Settings</h1></div>
    <div className="settings-stack">
      <section className="settings-card card">
        <div className="settings-card-header">
          <h2>Appearance</h2>
          <p className="muted">Choose your interface theme. Changes apply immediately and are saved locally.</p>
        </div>
        <div className="theme-grid" role="group" aria-label="Theme">
          {themeOptions.map((option) => {
            const active = mode === option.value
            return <button
              key={option.value}
              type="button"
              className={`theme-option-card ${active ? 'active' : ''}`}
              aria-pressed={active}
              disabled={pending}
              onClick={() => { if (mode !== option.value) void onAction(() => api.setThemeMode(option.value), 'Theme updated', { key: 'settings:theme', invalidate: SETTINGS_KEYS }) }}
            >
              <span className={`theme-preview preview-${option.preview}`} aria-hidden="true">
                <span className="preview-bar"><span className="preview-dot" /><span className="preview-line short" /></span>
                <span className="preview-body">
                  <span className="preview-row"><span className="preview-line" /><span className="preview-pill" /></span>
                  <span className="preview-row indent"><span className="preview-line mid" /><span className="preview-pill done" /></span>
                  <span className="preview-row indent"><span className="preview-line short" /></span>
                </span>
              </span>
              <span className="theme-option-meta">
                <span className="theme-option-title">
                  {option.value === 'system' ? <MonitorIcon size={14} /> : option.value === 'light' ? <SunIcon size={14} /> : <MoonIcon size={14} />}
                  <strong>{option.label}</strong>
                  {active && <span className="theme-active-check" aria-hidden="true"><CheckIcon size={11} strokeWidth={2.4} /></span>}
                </span>
                <small>{option.caption}</small>
              </span>
            </button>
          })}
        </div>
      </section>

      <section className="settings-card card">
        <div className="settings-card-header">
          <h2 className="heading-with-icon"><KeyboardIcon size={16} />Keyboard Shortcuts</h2>
          <p className="muted">Navigate views and manage items quickly when no text field is focused.</p>
        </div>
        <div className="shortcut-list">
          {shortcuts.map((item) => <div key={item.label} className="shortcut-row">
            <span className="shortcut-label">{item.label}</span>
            <span className="shortcut-keys">{item.keys.map((key) => <kbd key={key}>{key}</kbd>)}</span>
          </div>)}
        </div>
      </section>

      <section className="settings-card card about-card">
        <div className="about-header">
          <span className="brand-mark about-mark" aria-hidden="true"><BranchNodeIcon size={20} /></span>
          <div>
            <h2>BranchTrace</h2>
            <p className="muted">Organize long-term goals as project trees and track daily momentum.</p>
          </div>
        </div>
        <div className="about-badges">
          <span className="meta-pill">v1.0.0</span>
          <span className="meta-pill">Offline-first</span>
          <span className="meta-pill">SQLite Transactions</span>
        </div>
      </section>
    </div>
  </section>
}

function ProgressCalendarModal({ project, today, pending, onAction, onClose }: { project: ProjectDto; today: string; pending: boolean; onAction: ActionRunner; onClose: () => void }) {
  const currentMonth = today.slice(0, 7)
  const [month, setMonth] = useState(currentMonth)
  const [error, setError] = useState<string | null>(null)
  const progress = useQuery({ queryKey: ['projectProgressMonth', project.id, month], queryFn: () => api.getProjectProgressMonth(project.id, month) })
  const [year, monthNumber] = month.split('-').map(Number)
  const monthIndex = monthNumber - 1
  const leading = (new Date(year, monthIndex, 1).getDay() || 7) - 1
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const dates = Array.from({ length: daysInMonth }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
  const recorded = new Set(progress.data ?? [])
  const changeMonth = (amount: number) => { setMonth(isoDate(new Date(year, monthIndex + amount, 1)).slice(0, 7)); setError(null) }
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
    <div className="calendar-weekdays" aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div>
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

function ProjectDetailModal({ detail, loading, error, retry, onClose }: { detail: ProjectDetailDto | undefined; loading: boolean; error: unknown; retry: () => void; onClose: () => void }) {
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
          {statusText[detail.status]}
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

function StartupErrorView({ error }: { error: ApiError }) {
  const dbPath = typeof error.details?.dbPath === 'string' ? error.details.dbPath : null
  return <div className="fatal-shell" role="alert">
    <section className="fatal-card card">
      <div className="brand-block"><span className="brand-mark" aria-hidden="true"><BranchNodeIcon size={15} /></span><span className="brand-name">BranchTrace</span></div>
      <h1>Database Initialization Failed</h1>
      <p className="fatal-message">{error.message}</p>
      <p className="muted">Error code: {error.code}</p>
      {dbPath && <p className="fatal-path">Database path: <code>{dbPath}</code></p>}
      <p className="muted">To protect your data, the app will not overwrite or delete existing database files. Please back up this file, resolve the issue, and restart.</p>
    </section>
  </div>
}

function EmptyState({ children }: { children: ReactNode }) { return <div className="empty-state">{children}</div> }
function dateFrom(value: string) { return new Date(`${value}T12:00:00`) }
function isoDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }

export default function App() { return <AppErrorBoundary><QueryClientProvider client={queryClient}><AppShell /></QueryClientProvider></AppErrorBoundary> }
