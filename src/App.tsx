import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { ActionMenu, ConfirmDialog, errorMessage, FormDialog, LoadError, Modal } from './components/ui'
import type { ActionRunner } from './components/ui'
import { createMoveOptions } from './project-options'
import type { DailyDayDto, DailyWeekDto, ProjectDailyItem, ProjectDetailDto, ProjectDto, ReminderDailyItem, ThemeMode, TrashEntryDto } from './types'
import './index.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } })
const statusText = { active: '进行中', completed: '已完成', canceled: '已取消' } as const
type View = 'project' | 'daily' | 'trash' | 'settings'

function AppShell() {
  const client = useQueryClient()
  const [view, setView] = useState<View>('project')
  const [weekStart, setWeekStart] = useState<string | null>(null)
  const [trashKind, setTrashKind] = useState<'project' | 'reminder'>('project')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [calendarProjectId, setCalendarProjectId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const actionLock = useRef(false)

  const clock = useQuery({ queryKey: ['clockContext'], queryFn: api.getClockContext, refetchInterval: 60_000 })
  const projects = useQuery({ queryKey: ['projectTree'], queryFn: api.getProjectTree })
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getAppSettings })
  const daily = useQuery({ queryKey: ['dailyWeek', weekStart], queryFn: () => api.getDailyWeek(weekStart!), enabled: view === 'daily' && Boolean(weekStart) })
  const trash = useQuery({ queryKey: ['trash', trashKind], queryFn: () => api.listTrash(trashKind), enabled: view === 'trash' })
  const detail = useQuery({ queryKey: ['projectDetail', selectedProjectId], queryFn: () => api.getProjectDetail(selectedProjectId!), enabled: Boolean(selectedProjectId) })

  useEffect(() => {
    if (clock.data && !weekStart) setWeekStart(clock.data.weekStart)
  }, [clock.data, weekStart])

  useEffect(() => {
    if (!notice || notice.error) return
    const timeout = window.setTimeout(() => setNotice(null), 3500)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    const mode = settings.data?.themeMode ?? 'system'
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', mode === 'dark' || (mode === 'system' && media.matches))
    apply()
    if (mode !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.data?.themeMode])

  const refresh = () => Promise.all(['projectTree', 'projectDetail', 'projectProgressMonth', 'dailyWeek', 'reminder', 'trash', 'settings', 'clockContext'].map((key) => client.invalidateQueries({ queryKey: [key] })))

  const perform: ActionRunner = async (action, success) => {
    if (actionLock.current) return { ok: false, message: '操作正在进行，请稍候。' }
    actionLock.current = true
    setBusy(true)
    setNotice(null)
    try {
      try {
        await action()
      } catch (error) {
        const message = errorMessage(error)
        setNotice({ message, error: true })
        // Refresh versions before a retained draft can be submitted again.
        await refresh().catch(() => undefined)
        return { ok: false, message }
      }
      try {
        await refresh()
        if (success) setNotice({ message: success })
      } catch {
        // The write committed; keep a refresh failure from causing a duplicate write.
        setNotice({ message: '已保存，页面刷新失败，请重新打开此页面。', error: true })
      }
      return { ok: true }
    } finally {
      actionLock.current = false
      setBusy(false)
    }
  }

  const projectList = projects.data ?? []
  const today = clock.data?.today ?? isoDate(new Date())
  const calendarProject = projectList.find((project) => project.id === calendarProjectId)

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-block"><span className="brand-mark" aria-hidden="true">枝</span><span className="brand-name">枝迹</span></div>
      <nav className="main-nav" aria-label="主视图">
        <button type="button" data-focus-fallback className={`nav-item ${view === 'project' ? 'active' : ''}`} aria-current={view === 'project' ? 'page' : undefined} disabled={busy} onClick={() => setView('project')}>项目</button>
        <button type="button" className={`nav-item ${view === 'daily' ? 'active' : ''}`} aria-current={view === 'daily' ? 'page' : undefined} disabled={busy} onClick={() => { setView('daily'); if (clock.data) setWeekStart(clock.data.weekStart) }}>每日</button>
      </nav>
      <div className="top-actions"><time className="today-text" dateTime={today} title={`今天 ${today}`}>{today}</time><ActionMenu label="全局更多" active={view === 'trash' || view === 'settings'} disabled={busy} items={[{ label: '回收站', onSelect: () => setView('trash') }, { label: '设置', onSelect: () => setView('settings') }]} /></div>
    </header>

    {notice && <div className={`notice ${notice.error ? 'notice-error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.message}</span><button type="button" className="icon-button" onClick={() => setNotice(null)} aria-label="关闭提示">×</button></div>}

    <main className="main-content">
      {view === 'project' && <>
        {projects.isError && <LoadError error={projects.error} retry={() => void projects.refetch()} />}
        <ProjectView projects={projectList} loading={projects.isLoading} busy={busy} today={today} onAction={perform} onOpenDetail={setSelectedProjectId} onOpenCalendar={setCalendarProjectId} />
      </>}
      {view === 'daily' && <>
        {clock.isError && <LoadError error={clock.error} retry={() => void clock.refetch()} />}
        {daily.isError && <LoadError error={daily.error} retry={() => void daily.refetch()} />}
        <DailyView daily={daily.data} weekStart={weekStart ?? clock.data?.weekStart ?? ''} currentWeekStart={clock.data?.weekStart ?? ''} onWeekChange={setWeekStart} busy={busy} onAction={perform} onOpenDetail={setSelectedProjectId} />
      </>}
      {view === 'trash' && <>
        {trash.isError && <LoadError error={trash.error} retry={() => void trash.refetch()} />}
        <TrashView kind={trashKind} entries={trash.data ?? []} loading={trash.isLoading} busy={busy} onKindChange={setTrashKind} onAction={perform} />
      </>}
      {view === 'settings' && <>
        {settings.isError && <LoadError error={settings.error} retry={() => void settings.refetch()} />}
        <SettingsView mode={settings.data?.themeMode ?? 'system'} busy={busy || settings.isLoading} onAction={perform} />
      </>}
    </main>

    {selectedProjectId && <ProjectDetailModal detail={detail.data} loading={detail.isLoading} error={detail.error} retry={() => void detail.refetch()} onClose={() => setSelectedProjectId(null)} />}
    {calendarProject && <ProgressCalendarModal project={calendarProject} today={today} busy={busy} onAction={perform} onClose={() => setCalendarProjectId(null)} />}
  </div>
}

function ProjectView({ projects, loading, busy, today, onAction, onOpenDetail, onOpenCalendar }: { projects: ProjectDto[]; loading: boolean; busy: boolean; today: string; onAction: ActionRunner; onOpenDetail: (id: string) => void; onOpenCalendar: (id: string) => void }) {
  const [newTitle, setNewTitle] = useState('')
  const grouped = useMemo(() => {
    const map = new Map<string | null, ProjectDto[]>()
    for (const project of projects) map.set(project.parentId, [...(map.get(project.parentId) ?? []), project])
    for (const items of map.values()) items.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    return map
  }, [projects])

  const reorder = async (parentId: string | null, fromId: string, toId: string) => {
    if (busy) return
    const siblings = [...(grouped.get(parentId) ?? [])]
    const fromIndex = siblings.findIndex((item) => item.id === fromId)
    const toIndex = siblings.findIndex((item) => item.id === toId)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
    const [moved] = siblings.splice(fromIndex, 1)
    siblings.splice(toIndex, 0, moved)
    await onAction(() => api.reorderProjectSiblings(parentId, siblings.map((item) => item.id)), '项目顺序已保存')
  }

  const createRoot = async () => {
    if (busy || !newTitle.trim()) return
    const result = await onAction(() => api.createProject(newTitle.trim()), '项目已创建')
    if (result.ok) setNewTitle('')
  }

  const renderChildren = (parentId: string | null, depth = 0): ReactNode[] => (grouped.get(parentId) ?? []).flatMap((project) => [
    <ProjectRow key={project.id} project={project} projects={projects} depth={depth} hasChildren={Boolean(grouped.get(project.id)?.length)} busy={busy} today={today} onAction={onAction} onOpenDetail={onOpenDetail} onOpenCalendar={onOpenCalendar} onReorder={reorder} />,
    ...(project.isExpanded ? renderChildren(project.id, depth + 1) : []),
  ])

  return <section className="view-stack" aria-label="项目">
    <div className="page-toolbar">
      <div className="page-title"><h1>项目</h1><span className="count-label">{projects.length}</span></div>
      <form className="create-bar" onSubmit={(event) => { event.preventDefault(); void createRoot() }}>
        <input value={newTitle} disabled={busy || loading} onChange={(event) => setNewTitle(event.target.value)} placeholder="新建项目…" aria-label="新建顶层项目" />
        <button type="submit" className="primary-button" disabled={busy || loading || !newTitle.trim()}>添加</button>
      </form>
    </div>
    <div className="project-list card" aria-busy={busy || loading}>
      {loading ? <div className="loading-state">正在读取项目…</div> : projects.length ? renderChildren(null) : <EmptyState>还没有项目，在上方添加一个。</EmptyState>}
    </div>
  </section>
}

type ProjectDialog = 'rename' | 'child' | 'terminal' | 'move' | 'trash'

function ProjectRow({ project, projects, depth, hasChildren, busy, today, onAction, onOpenDetail, onOpenCalendar, onReorder }: { project: ProjectDto; projects: ProjectDto[]; depth: number; hasChildren: boolean; busy: boolean; today: string; onAction: ActionRunner; onOpenDetail: (id: string) => void; onOpenCalendar: (id: string) => void; onReorder: (parentId: string | null, fromId: string, toId: string) => Promise<void> }) {
  const [dialog, setDialog] = useState<ProjectDialog | null>(null)
  const clickTimer = useRef<number>()
  useEffect(() => () => window.clearTimeout(clickTimer.current), [])
  const close = () => setDialog(null)
  const terminalDate = project.completedDate ?? project.canceledDate ?? ''

  const createChild = async (title: string) => {
    const result = await onAction(() => api.createProject(title, project.id), '子项目已创建')
    if (result.ok && !project.isExpanded) {
      // Creation already committed; an expansion failure must not resubmit it.
      await onAction(() => api.setProjectExpanded(project.id, true))
    }
    return result
  }

  const menuItems = [
    ...(project.status === 'active'
      ? [{ label: '标记完成', onSelect: () => void onAction(() => api.completeProject(project.id, project.version), '项目已完成') }, { label: '取消项目', onSelect: () => void onAction(() => api.cancelProject(project.id, project.version), '项目已取消') }]
      : [{ label: '恢复未完成', onSelect: () => void onAction(() => api.restoreProject(project.id, project.version), '项目已恢复') }, { label: '修改终止日期', onSelect: () => setDialog('terminal') }]),
    { label: '新建子项目', separator: true, onSelect: () => setDialog('child') },
    { label: '重命名', onSelect: () => setDialog('rename') },
    { label: '推进日历', onSelect: () => onOpenCalendar(project.id) },
    { label: '移动到…', onSelect: () => setDialog('move') },
    { label: '移入回收站', separator: true, danger: true, onSelect: () => setDialog('trash') },
  ]

  return <div className="project-row-wrap">
    <div className={`project-row ${project.status}`} style={{ paddingLeft: `${8 + Math.min(depth, 12) * 18}px` }} onDragOver={(event) => { if (!busy && event.dataTransfer.types.includes('text/branchtrace-project')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }} onDrop={(event) => { event.preventDefault(); if (busy) return; const fromId = event.dataTransfer.getData('text/branchtrace-project'); if (fromId) void onReorder(project.parentId, fromId, project.id) }}>
      <button type="button" className="drag-handle" aria-label={`拖动排序 ${project.title}`} title="拖动排序" draggable={!busy} disabled={busy} onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/branchtrace-project', project.id) }}>⠿</button>
      {hasChildren ? <button type="button" className="tree-toggle" disabled={busy} aria-label={`${project.isExpanded ? '折叠' : '展开'} ${project.title}`} aria-expanded={project.isExpanded} onClick={() => void onAction(() => api.setProjectExpanded(project.id, !project.isExpanded))}>{project.isExpanded ? '⌄' : '›'}</button> : <span className="tree-spacer" />}
      <span className={`status-dot ${project.status}`} role="img" aria-label={`状态：${statusText[project.status]}`} title={statusText[project.status]} />
      <button type="button" className="project-title" title={project.title} disabled={busy} onClick={(event) => {
        window.clearTimeout(clickTimer.current)
        if (event.detail === 0) onOpenDetail(project.id)
        else if (event.detail === 1) clickTimer.current = window.setTimeout(() => onOpenDetail(project.id), 220)
      }} onDoubleClick={() => { window.clearTimeout(clickTimer.current); setDialog('rename') }}>{project.title}</button>
      {depth > 12 && <span className="depth-label">第 {depth + 1} 级</span>}
      <div className="progress-history" aria-label={`累计推进 ${project.progressCount} 天`}>
        <span className="progress-dates">{project.recentProgressDates.map((date) => <time key={date} dateTime={date}>{date.slice(5).replace('-', '/')}</time>)}{project.progressCount > 3 && <span>+{project.progressCount - 3}</span>}</span>
        {project.progressCount > 0 && <span className="progress-total">{project.progressCount} 天</span>}
      </div>
      <button type="button" className={`progress-button ${project.progressedToday ? 'checked' : ''}`} disabled={busy || project.status !== 'active'} aria-pressed={project.progressedToday} onClick={() => void onAction(() => api.setProjectProgress(project.id, undefined, !project.progressedToday, project.version), project.progressedToday ? '已撤销今日推进' : '已记录今日推进')} title={project.status === 'active' ? (project.progressedToday ? '撤销今日推进' : '记录今日推进') : '终止项目可在推进日历中撤销已有记录'}>{project.progressedToday ? '✓ 已推进' : '＋ 今日推进'}</button>
      <button type="button" className="icon-button add-child-button" disabled={busy} aria-label={`为 ${project.title} 新建子项目`} title="新建子项目" onClick={() => setDialog('child')}>＋</button>
      <ActionMenu label={`${project.title} 更多操作`} items={menuItems} disabled={busy} />
    </div>

    {dialog === 'rename' && <FormDialog title="重命名项目" label="项目名称" initialValue={project.title} onClose={close} onSubmit={(value) => onAction(() => api.renameProject(project.id, value, project.version), '项目已重命名')} />}
    {dialog === 'child' && <FormDialog title="新建子项目" description={`添加到“${project.title}”`} label="项目名称" initialValue="" submitLabel="添加" onClose={close} onSubmit={createChild} />}
    {dialog === 'terminal' && <FormDialog title="修改终止日期" label={project.status === 'completed' ? '完成日期' : '取消日期'} kind="date" initialValue={terminalDate} max={today} onClose={close} onSubmit={(value) => onAction(() => api.updateProjectTerminalDate(project.id, value, project.version), '终止日期已更新')} />}
    {dialog === 'move' && <FormDialog title="移动项目" description={project.title} label="目标位置" kind="select" options={createMoveOptions(project.id, projects)} initialValue={project.parentId ?? ''} submitLabel="移动" onClose={close} onSubmit={(value) => onAction(() => api.moveProject(project.id, value || null, project.version), '项目已移动')} />}
    {dialog === 'trash' && <ProjectTrashDialog project={project} onAction={onAction} onClose={close} />}
  </div>
}

function ProjectTrashDialog({ project, onAction, onClose }: { project: ProjectDto; onAction: ActionRunner; onClose: () => void }) {
  const preview = useQuery({ queryKey: ['trashPreview', project.id], queryFn: () => api.previewProjectTrash(project.id), staleTime: 0, retry: false })
  return <ConfirmDialog title="移入回收站" description={<>将“{project.title}”及其子项目移入回收站，之后可以恢复。</>} confirmLabel="移入回收站" disabled={!preview.data || preview.isFetching || preview.isError} onClose={onClose} onConfirm={() => onAction(() => api.trashProject(project.id), '项目已移入回收站')}>
    {preview.isError ? <LoadError error={preview.error} retry={() => void preview.refetch()} /> : <p className="affected-count">{preview.isFetching ? '正在检查影响范围…' : `影响 ${preview.data?.activeNodeCount ?? 0} 个活跃节点`}</p>}
  </ConfirmDialog>
}

function DailyView({ daily, weekStart, currentWeekStart, onWeekChange, busy, onAction, onOpenDetail }: { daily: DailyWeekDto | undefined; weekStart: string; currentWeekStart: string; onWeekChange: (value: string) => void; busy: boolean; onAction: ActionRunner; onOpenDetail: (id: string) => void }) {
  const moveWeek = (amount: number) => {
    const date = dateFrom(weekStart)
    date.setDate(date.getDate() + amount * 7)
    onWeekChange(isoDate(date))
  }
  const weekEnd = weekStart ? dateFrom(weekStart) : null
  weekEnd?.setDate(weekEnd.getDate() + 6)
  return <section className="view-stack daily-view" aria-label="每日">
    <div className="page-toolbar">
      <div className="page-title"><h1>每日</h1>{weekEnd && <span className="week-range">{weekStart.slice(5).replace('-', '/')} — {isoDate(weekEnd).slice(5).replace('-', '/')}</span>}</div>
      <div className="week-controls"><button type="button" disabled={!weekStart} onClick={() => moveWeek(-1)} aria-label="上一周">←</button><button type="button" disabled={!currentWeekStart} onClick={() => onWeekChange(currentWeekStart)}>本周</button><button type="button" disabled={!weekStart} onClick={() => moveWeek(1)} aria-label="下一周">→</button></div>
    </div>
    {!daily ? <div className="loading-state">正在读取每日记录…</div> : <div className="week-grid">{daily.days.map((day) => <DailyColumn key={day.date} day={day} today={daily.today} busy={busy} onAction={onAction} onOpenDetail={onOpenDetail} />)}</div>}
  </section>
}

function DailyColumn({ day, today, busy, onAction, onOpenDetail }: { day: DailyDayDto; today: string; busy: boolean; onAction: ActionRunner; onOpenDetail: (id: string) => void }) {
  const [newReminder, setNewReminder] = useState('')
  const plannedReminders = [...day.plannedReminders].sort((a, b) => a.reminder.sortOrder - b.reminder.sortOrder || a.reminder.id.localeCompare(b.reminder.id))
  const canAdd = day.date >= today
  const addReminder = async () => {
    if (busy || !newReminder.trim()) return
    const result = await onAction(() => api.createReminder(newReminder.trim(), day.date), '提醒已创建')
    if (result.ok) setNewReminder('')
  }
  const reorderReminders = async (fromId: string, toId: string) => {
    if (busy) return
    const ordered = plannedReminders.map((item) => item.reminder.id)
    const fromIndex = ordered.indexOf(fromId)
    const toIndex = ordered.indexOf(toId)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
    const [moved] = ordered.splice(fromIndex, 1)
    ordered.splice(toIndex, 0, moved)
    await onAction(() => api.reorderReminders(day.date, ordered), '提醒顺序已保存')
  }
  const hasReminders = day.plannedReminders.length + day.overdueReminders.length + day.crossDayCompletedReminders.length > 0

  return <article className={`day-column ${day.date === today ? 'today' : ''}`} aria-label={day.date}>
    <header className="day-header"><span>{formatWeekday(day.date)}</span><time dateTime={day.date}>{day.date.slice(5).replace('-', '/')}</time>{day.date === today && <em>今天</em>}</header>
    <div className="day-body">
      {day.completedProjects.length > 0 && <DayGroup title="项目完成" tone="done">{day.completedProjects.map((item) => <ProjectDailyRow key={item.projectId} item={item} onOpenDetail={onOpenDetail} completed />)}</DayGroup>}
      {day.progressedProjects.length > 0 && <DayGroup title="项目推进" tone="progress">{day.progressedProjects.map((item) => <ProjectDailyRow key={item.projectId} item={item} onOpenDetail={onOpenDetail} />)}</DayGroup>}
      {(hasReminders || canAdd) && <DayGroup title="独立提醒" tone="reminder">
        {plannedReminders.map((item) => <ReminderRow key={`planned-${item.reminder.id}`} item={item} today={today} busy={busy} onAction={onAction} onReorder={reorderReminders} />)}
        {day.overdueReminders.length > 0 && <div className="subgroup-label">逾期待处理</div>}
        {day.overdueReminders.map((item) => <ReminderRow key={`overdue-${item.reminder.id}`} item={item} today={today} busy={busy} onAction={onAction} overdue />)}
        {day.crossDayCompletedReminders.length > 0 && <div className="subgroup-label">跨日完成</div>}
        {day.crossDayCompletedReminders.map((item) => <ReminderRow key={`completed-${item.reminder.id}`} item={item} today={today} busy={busy} onAction={onAction} />)}
        {canAdd && <form className="reminder-create" onSubmit={(event) => { event.preventDefault(); void addReminder() }}><input value={newReminder} disabled={busy} onChange={(event) => setNewReminder(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setNewReminder('') }} placeholder="添加提醒…" aria-label={`${day.date} 新建提醒`} /><button type="submit" className="icon-button" aria-label={`${day.date} 添加提醒`} disabled={busy || !newReminder.trim()}>＋</button></form>}
      </DayGroup>}
      {!day.completedProjects.length && !day.progressedProjects.length && !hasReminders && !canAdd && <div className="day-empty">暂无记录</div>}
    </div>
  </article>
}

function DayGroup({ title, tone, children }: { title: string; tone: string; children: ReactNode }) {
  return <section className={`day-group ${tone}`}><h2>{title}</h2>{children}</section>
}

function ProjectDailyRow({ item, onOpenDetail, completed = false }: { item: ProjectDailyItem; onOpenDetail: (id: string) => void; completed?: boolean }) {
  return <button type="button" className="daily-item" onClick={() => onOpenDetail(item.projectId)} title={[...item.parentPath, item.title].join(' / ')}><span className="item-icon" aria-hidden="true">{completed ? '✓' : '↗'}</span><span className="item-text"><strong>{item.title}</strong>{(item.parentPath.length > 0 || item.shortId) && <small>{[item.parentPath.join(' / '), item.shortId].filter(Boolean).join(' · ')}</small>}</span></button>
}

type ReminderDialog = 'rename' | 'schedule' | 'completedDate' | 'trash'

function ReminderRow({ item, today, overdue = false, busy, onAction, onReorder }: { item: ReminderDailyItem; today: string; overdue?: boolean; busy: boolean; onAction: ActionRunner; onReorder?: (fromId: string, toId: string) => Promise<void> }) {
  const { reminder } = item
  const [dialog, setDialog] = useState<ReminderDialog | null>(null)
  const close = () => setDialog(null)
  const toggle = () => void onAction(() => reminder.status === 'completed' ? api.restoreReminder(reminder.id, reminder.version) : api.completeReminder(reminder.id, reminder.version), reminder.status === 'completed' ? '提醒已恢复' : '提醒已完成')
  const items = [
    { label: '重命名', onSelect: () => setDialog('rename') },
    { label: '修改计划日期', onSelect: () => setDialog('schedule') },
    ...(reminder.status === 'completed' ? [{ label: '修改完成日期', onSelect: () => setDialog('completedDate') }] : []),
    ...(reminder.status === 'active'
      ? [{ label: '取消提醒', onSelect: () => void onAction(() => api.cancelReminder(reminder.id, reminder.version), '提醒已取消') }]
      : [{ label: '恢复未完成', onSelect: () => void onAction(() => api.restoreReminder(reminder.id, reminder.version), '提醒已恢复') }]),
    { label: '移入回收站', separator: true, danger: true, onSelect: () => setDialog('trash') },
  ]

  return <>
    <div className={`reminder-row ${reminder.status} ${overdue ? 'overdue' : ''}`} onDragOver={(event) => { if (!busy && onReorder && event.dataTransfer.types.includes('text/branchtrace-reminder')) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); if (busy || !onReorder) return; const fromId = event.dataTransfer.getData('text/branchtrace-reminder'); if (fromId) void onReorder(fromId, reminder.id) }}>
      {onReorder && <button type="button" className="drag-handle" aria-label={`拖动排序 ${reminder.title}`} title="拖动排序" draggable={!busy} disabled={busy} onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/branchtrace-reminder', reminder.id) }}>⠿</button>}
      <button type="button" role="checkbox" aria-checked={reminder.status === 'completed'} aria-label={`${reminder.title}，${statusText[reminder.status]}`} className="reminder-check" disabled={busy || reminder.status === 'canceled'} onClick={toggle}>{reminder.status === 'completed' ? '✓' : reminder.status === 'canceled' ? '−' : ''}</button>
      <span className="reminder-title" title={reminder.title} onDoubleClick={() => { if (!busy) setDialog('rename') }}>{reminder.title}</span>
      {overdue && <span className="overdue-label">逾期</span>}
      <ActionMenu label={`${reminder.title} 更多操作`} items={items} disabled={busy} />
    </div>
    {dialog === 'rename' && <FormDialog title="重命名提醒" label="提醒名称" initialValue={reminder.title} onClose={close} onSubmit={(value) => onAction(() => api.renameReminder(reminder.id, value, reminder.version), '提醒已重命名')} />}
    {dialog === 'schedule' && <FormDialog title="修改计划日期" description={reminder.title} label="计划日期" kind="date" initialValue={reminder.scheduledDate} min={today} onClose={close} onSubmit={(value) => onAction(() => api.updateReminderSchedule(reminder.id, value, reminder.version), '计划日期已更新')} />}
    {dialog === 'completedDate' && <FormDialog title="修改完成日期" description={reminder.title} label="完成日期" kind="date" initialValue={reminder.completedDate ?? today} max={today} onClose={close} onSubmit={(value) => onAction(() => api.updateReminderCompletedDate(reminder.id, value, reminder.version), '完成日期已更新')} />}
    {dialog === 'trash' && <ConfirmDialog title="移入回收站" description={`将提醒“${reminder.title}”移入回收站，之后可以恢复。`} confirmLabel="移入回收站" onClose={close} onConfirm={() => onAction(() => api.trashReminder(reminder.id), '提醒已移入回收站')} />}
  </>
}

function TrashView({ kind, entries, loading, busy, onKindChange, onAction }: { kind: 'project' | 'reminder'; entries: TrashEntryDto[]; loading: boolean; busy: boolean; onKindChange: (kind: 'project' | 'reminder') => void; onAction: ActionRunner }) {
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  return <section className="view-stack" aria-label="回收站">
    <div className="page-toolbar"><h1>回收站</h1><button type="button" className="text-button danger-text" disabled={busy || loading || !entries.length} onClick={() => setConfirmEmpty(true)}>清空当前分类</button></div>
    <div className="segmented" aria-label="回收站分类"><button type="button" aria-pressed={kind === 'project'} disabled={busy} onClick={() => onKindChange('project')}>项目</button><button type="button" aria-pressed={kind === 'reminder'} disabled={busy} onClick={() => onKindChange('reminder')}>提醒</button></div>
    <div className="trash-list card" aria-busy={busy || loading}>{loading ? <div className="loading-state">正在读取回收站…</div> : entries.length ? entries.map((entry) => <TrashRow key={entry.id} entry={entry} busy={busy} onAction={onAction} />) : <EmptyState>回收站是空的。</EmptyState>}</div>
    {confirmEmpty && <ConfirmDialog title="清空当前分类" description={`永久删除${kind === 'project' ? '项目' : '提醒'}分类中的 ${entries.length} 条回收站记录及其关联数据。${kind === 'project' ? '项目的所有后代和推进历史也会删除。' : ''}此操作无法恢复。`} confirmLabel="永久清空" onClose={() => setConfirmEmpty(false)} onConfirm={() => onAction(() => api.emptyTrash(kind), '回收站已清空')} />}
  </section>
}

function TrashRow({ entry, busy, onAction }: { entry: TrashEntryDto; busy: boolean; onAction: ActionRunner }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  return <>
    <div className="trash-row"><div className="trash-info"><strong title={entry.titleSnapshot}>{entry.titleSnapshot}</strong><small>{entry.kind === 'project' ? `项目树 · 删除时 ${entry.affectedCountAtDelete} 个活跃节点` : '提醒'} · {new Date(entry.deletedAt).toLocaleString()}</small></div><div className="trash-actions"><button type="button" className="text-button" disabled={busy} onClick={() => void onAction(() => api.restoreTrashEntry(entry.id), '已恢复')}>恢复</button><button type="button" className="text-button danger-text" disabled={busy} onClick={() => setConfirmDelete(true)}>永久删除</button></div></div>
    {confirmDelete && <ConfirmDialog title="永久删除" description={`永久删除${entry.kind === 'project' ? `以“${entry.titleSnapshot}”为根的项目树${entry.currentDescendantCount === null ? '' : `（当前 ${entry.currentDescendantCount} 个节点）`}及推进历史` : `提醒“${entry.titleSnapshot}”`}，此操作无法恢复。`} confirmLabel="永久删除" onClose={() => setConfirmDelete(false)} onConfirm={() => onAction(() => api.permanentlyDeleteTrashEntry(entry.id), '已永久删除')} />}
  </>
}

function SettingsView({ mode, busy, onAction }: { mode: ThemeMode; busy: boolean; onAction: ActionRunner }) {
  return <section className="view-stack" aria-label="设置">
    <div className="page-toolbar"><h1>设置</h1></div>
    <div className="settings-row card"><h2>外观</h2><div className="segmented" aria-label="界面主题">{(['system', 'light', 'dark'] as ThemeMode[]).map((option) => <button key={option} type="button" aria-pressed={mode === option} disabled={busy} onClick={() => { if (mode !== option) void onAction(() => api.setThemeMode(option), '主题已更新') }}>{option === 'system' ? '跟随系统' : option === 'light' ? '浅色' : '深色'}</button>)}</div></div>
  </section>
}

function ProgressCalendarModal({ project, today, busy, onAction, onClose }: { project: ProjectDto; today: string; busy: boolean; onAction: ActionRunner; onClose: () => void }) {
  const [month, setMonth] = useState(today.slice(0, 7))
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
    if (busy || (project.status !== 'active' && !has) || (date > today && !has)) return
    setError(null)
    const result = await onAction(() => api.setProjectProgress(project.id, date, !has, project.version), has ? '已撤销该日推进' : '已记录该日推进')
    if (!result.ok) setError(result.message)
  }
  return <Modal title="推进日历" description={project.title} onClose={onClose} busy={busy} className="calendar-modal">
    <div className="calendar-toolbar"><button type="button" className="icon-button" disabled={busy} onClick={() => changeMonth(-1)} aria-label="上个月">←</button><strong>{year} 年 {monthNumber} 月</strong><button type="button" className="icon-button" disabled={busy} onClick={() => changeMonth(1)} aria-label="下个月">→</button></div>
    {progress.isError && <LoadError error={progress.error} retry={() => void progress.refetch()} />}
    {progress.isLoading && <p className="muted" role="status">正在读取推进记录…</p>}
    <div className="calendar-weekdays" aria-hidden="true">{['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="calendar-grid">{Array.from({ length: leading }, (_, index) => <span key={`leading-${index}`} />)}{dates.map((date) => {
      const has = recorded.has(date)
      return <button key={date} type="button" className={`${has ? 'recorded' : ''} ${date === today ? 'today' : ''}`} aria-label={`${date}${has ? '，已推进' : ''}`} aria-pressed={has} aria-current={date === today ? 'date' : undefined} disabled={busy || progress.isFetching || progress.isError || (date > today && !has) || (project.status !== 'active' && !has)} onClick={() => void toggle(date)}>{Number(date.slice(-2))}</button>
    })}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <p className="calendar-help">点击日期记录或撤销推进。{project.status === 'active' ? '未来日期不可记录。' : '已终止项目仅可撤销已有记录。'}</p>
  </Modal>
}

function ProjectDetailModal({ detail, loading, error, retry, onClose }: { detail: ProjectDetailDto | undefined; loading: boolean; error: unknown; retry: () => void; onClose: () => void }) {
  return <Modal title="项目详情" onClose={onClose}>
    {error ? <LoadError error={error} retry={retry} /> : loading ? <div className="loading-state">正在读取项目详情…</div> : detail && <>
      <h3 className="detail-title">{detail.title}</h3>
      <div className="detail-path">{detail.parentPath.length ? detail.parentPath.join(' / ') : '顶层项目'}</div>
      <div className="detail-status"><span className={`status-dot ${detail.status}`} aria-hidden="true" />{statusText[detail.status]}{(detail.completedDate || detail.canceledDate) && <time>{detail.completedDate ?? detail.canceledDate}</time>}</div>
      <div className="detail-section"><h3>推进历史 <span className="muted">{detail.progressCount} 天</span></h3>{detail.progressDates.length ? <div className="date-chips">{detail.progressDates.map((date) => <time key={date} dateTime={date}>{date}</time>)}</div> : <p className="muted">暂无推进记录</p>}</div>
    </>}
  </Modal>
}

function EmptyState({ children }: { children: ReactNode }) { return <div className="empty-state">{children}</div> }
function formatWeekday(value: string) { return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dateFrom(value).getDay()] }
function dateFrom(value: string) { return new Date(`${value}T12:00:00`) }
function isoDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }

export default function App() { return <QueryClientProvider client={queryClient}><AppShell /></QueryClientProvider> }
