import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { DailyDayDto, ProjectDailyItem, ProjectDetailDto, ProjectDto, ReminderDailyItem, ThemeMode, TrashEntryDto } from './types'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1 },
  },
})

const statusText = { active: '进行中', completed: '已完成', canceled: '已取消' } as const

function AppShell() {
  const client = useQueryClient()
  const [view, setView] = useState<'project' | 'daily' | 'trash' | 'settings'>('project')
  const [weekStart, setWeekStart] = useState<string | null>(null)
  const [trashKind, setTrashKind] = useState<'project' | 'reminder'>('project')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [calendarProjectId, setCalendarProjectId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const clock = useQuery({ queryKey: ['clockContext'], queryFn: api.getClockContext, refetchInterval: 60_000 })
  const projects = useQuery({ queryKey: ['projectTree'], queryFn: api.getProjectTree })
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getAppSettings })
  const daily = useQuery({ queryKey: ['dailyWeek', weekStart], queryFn: () => api.getDailyWeek(weekStart!), enabled: Boolean(weekStart) })
  const trash = useQuery({ queryKey: ['trash', trashKind], queryFn: () => api.listTrash(trashKind), enabled: view === 'trash' })
  const detail = useQuery({ queryKey: ['projectDetail', selectedProjectId], queryFn: () => api.getProjectDetail(selectedProjectId!), enabled: Boolean(selectedProjectId) })

  useEffect(() => {
    if (clock.data && !weekStart) setWeekStart(clock.data.weekStart)
  }, [clock.data, weekStart])

  useEffect(() => {
    const mode = settings.data?.themeMode ?? 'system'
    const root = document.documentElement
    const apply = (isDark: boolean) => root.classList.toggle('dark', isDark)
    if (mode === 'dark') apply(true)
    else if (mode === 'light') apply(false)
    else {
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      apply(media.matches)
      const handler = () => apply(media.matches)
      media.addEventListener?.('change', handler)
      return () => media.removeEventListener?.('change', handler)
    }
  }, [settings.data?.themeMode])

  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['projectTree'] }),
      client.invalidateQueries({ queryKey: ['projectDetail'] }),
      client.invalidateQueries({ queryKey: ['projectProgressMonth'] }),
      client.invalidateQueries({ queryKey: ['dailyWeek'] }),
      client.invalidateQueries({ queryKey: ['trash'] }),
      client.invalidateQueries({ queryKey: ['clockContext'] }),
    ])
  }

  const perform = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true)
    setNotice(null)
    try {
      await action()
      await refresh()
      if (success) setNotice(success)
    } catch (error) {
      setNotice(typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : String(error))
    } finally {
      setBusy(false)
    }
  }

  const projectList = projects.data ?? []
  const currentTheme = settings.data?.themeMode ?? 'system'

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">枝</div>
          <div>
            <div className="brand-name">枝迹</div>
            <div className="brand-subtitle">BranchTrace · 让行动有迹可寻</div>
          </div>
        </div>
        <nav className="main-nav" aria-label="主视图">
          <button className={view === 'project' ? 'nav-item active' : 'nav-item'} onClick={() => setView('project')}>Project <span>项目树</span></button>
          <button className={view === 'daily' ? 'nav-item active' : 'nav-item'} onClick={() => { setView('daily'); if (clock.data) setWeekStart(clock.data.weekStart) }}>Daily <span>每日轨迹</span></button>
        </nav>
        <div className="top-actions">
          <span className="today-pill">今天 {clock.data?.today ?? '加载中'}</span>
          <button className={view === 'trash' ? 'icon-button selected' : 'icon-button'} title="回收站" onClick={() => setView('trash')}>⌫</button>
          <button className={view === 'settings' ? 'icon-button selected' : 'icon-button'} title="设置" onClick={() => setView('settings')}>⚙</button>
        </div>
      </header>

      {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice(null)}>×</button></div>}

      <main className="main-content">
        {view === 'project' && (
          <ProjectView projects={projectList} busy={busy || projects.isLoading} onAction={perform} onOpenDetail={setSelectedProjectId} onOpenCalendar={setCalendarProjectId} />
        )}
        {view === 'daily' && (
          <DailyView daily={daily.data} weekStart={weekStart ?? clock.data?.weekStart ?? ''} onWeekChange={setWeekStart} busy={busy || daily.isLoading} onAction={perform} onOpenDetail={setSelectedProjectId} />
        )}
        {view === 'trash' && (
          <TrashView kind={trashKind} entries={trash.data ?? []} loading={trash.isLoading} onKindChange={setTrashKind} onAction={perform} />
        )}
        {view === 'settings' && (
          <SettingsView mode={currentTheme} onAction={perform} />
        )}
      </main>

      {selectedProjectId && (
        <ProjectDetailModal detail={detail.data} loading={detail.isLoading} onClose={() => setSelectedProjectId(null)} />
      )}
      {calendarProjectId && projectList.find((project) => project.id === calendarProjectId) && (
        <ProgressCalendarModal project={projectList.find((project) => project.id === calendarProjectId)!} busy={busy} onAction={perform} onClose={() => setCalendarProjectId(null)} />
      )}
    </div>
  )
}

function ProjectView({ projects, busy, onAction, onOpenDetail, onOpenCalendar }: { projects: ProjectDto[]; busy: boolean; onAction: (action: () => Promise<unknown>, success?: string) => Promise<void>; onOpenDetail: (id: string) => void; onOpenCalendar: (id: string) => void }) {
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const grouped = useMemo(() => {
    const map = new Map<string | null, ProjectDto[]>()
    for (const project of projects) map.set(project.parentId, [...(map.get(project.parentId) ?? []), project])
    for (const items of map.values()) items.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    return map
  }, [projects])

  const reorder = async (parentId: string | null, fromId: string, toId: string) => {
    const siblings = [...(grouped.get(parentId) ?? [])]
    const fromIndex = siblings.findIndex((item) => item.id === fromId)
    const toIndex = siblings.findIndex((item) => item.id === toId)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
    const [moved] = siblings.splice(fromIndex, 1)
    siblings.splice(toIndex, 0, moved)
    await onAction(() => api.reorderProjectSiblings(parentId, siblings.map((item) => item.id)), '项目顺序已保存')
  }

  const createRoot = async () => {
    if (!newTitle.trim()) return
    await onAction(() => api.createProject(newTitle.trim()), '项目已创建')
    setNewTitle('')
  }

  const renderChildren = (parentId: string | null, depth = 0): JSX.Element[] => {
    const children = grouped.get(parentId) ?? []
    return children.flatMap((project) => [
      <ProjectRow key={project.id} project={project} depth={depth} hasChildren={(grouped.get(project.id) ?? []).length > 0} busy={busy} onAction={onAction} onOpenDetail={onOpenDetail} onOpenCalendar={onOpenCalendar} onReorder={reorder} />, 
      ...(project.isExpanded ? renderChildren(project.id, depth + 1) : []),
    ])
  }

  return (
    <section className="view-stack">
      <div className="view-heading">
        <div>
          <p className="eyebrow">PROJECT / 结构</p>
          <h1>项目树</h1>
          <p className="heading-copy">把长期目标拆成可继续推进的枝节，状态和行动记录彼此独立。</p>
        </div>
        <div className="heading-stat"><strong>{projects.length}</strong><span>个节点</span></div>
      </div>
      <div className="create-bar card">
        <span className="create-symbol">＋</span>
        <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createRoot() }} placeholder="输入一个新的顶层项目，按 Enter 保存" aria-label="新建顶层项目" />
        <button className="primary-button" disabled={busy || !newTitle.trim()} onClick={() => void createRoot()}>新建项目</button>
      </div>
      <div className="project-toolbar">
        <span>全部项目</span><span className="toolbar-caption">同名允许并存 · 项目状态由菜单管理</span>
      </div>
      <div className="project-list card">
        {projects.length === 0 && <EmptyState title="还没有项目" copy="从一个顶层目标开始，之后可以继续拆分子项目。" />}
        {projects.length > 0 && renderChildren(null)}
      </div>
      {adding && <span aria-hidden="true" />}
    </section>
  )
}

function ProjectRow({ project, depth, hasChildren, busy, onAction, onOpenDetail, onOpenCalendar, onReorder }: { project: ProjectDto; depth: number; hasChildren: boolean; busy: boolean; onAction: (action: () => Promise<unknown>, success?: string) => Promise<void>; onOpenDetail: (id: string) => void; onOpenCalendar: (id: string) => void; onReorder: (parentId: string | null, fromId: string, toId: string) => Promise<void> }) {
  const [addingChild, setAddingChild] = useState(false)
  const [childTitle, setChildTitle] = useState('')
  const indent = { paddingLeft: `${16 + depth * 28}px` }
  const rename = async () => {
    const value = window.prompt('重命名项目', project.title)
    if (value !== null && value.trim() && value.trim() !== project.title) await onAction(() => api.renameProject(project.id, value.trim(), project.version), '项目已重命名')
  }
  const addChild = async () => {
    if (!childTitle.trim()) return
    await onAction(() => api.createProject(childTitle.trim(), project.id), '子项目已创建')
    setChildTitle(''); setAddingChild(false)
  }
  const toggleProgress = () => onAction(() => api.setProjectProgress(project.id, undefined, !project.progressedToday, project.version), project.progressedToday ? '已撤销今日推进' : '已记录今日推进')
  const changeStatus = () => {
    if (project.status === 'active') {
      const choice = window.prompt('输入 complete 完成项目，或 cancel 取消项目', 'complete')
      if (choice === 'complete') return onAction(() => api.completeProject(project.id, project.version), '项目已完成')
      if (choice === 'cancel') return onAction(() => api.cancelProject(project.id, project.version), '项目已取消')
    } else {
      return onAction(() => api.restoreProject(project.id, project.version), '项目已恢复')
    }
    return Promise.resolve()
  }
  const updateTerminalDate = async () => {
    if (project.status === 'active') return
    const current = project.completedDate ?? project.canceledDate ?? ''
    const value = window.prompt('修改终止日期（YYYY-MM-DD）', current)
    if (value?.trim()) await onAction(() => api.updateProjectTerminalDate(project.id, value.trim(), project.version), '终止日期已更新')
  }
  const moveTo = async () => {
    const target = window.prompt('输入目标父项目 ID；留空表示移到顶层', '')
    if (target !== null) await onAction(() => api.moveProject(project.id, target.trim() || null, project.version), '项目已移动')
  }
  const remove = async () => {
    try {
      const preview = await api.previewProjectTrash(project.id)
      if (window.confirm(`确认将“${project.title}”及其 ${preview.activeNodeCount} 个活跃节点移入回收站？`)) await onAction(() => api.trashProject(project.id), '项目已移入回收站')
    } catch (error) {
      window.alert(typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : String(error))
    }
  }

  return (
    <div className="project-row-wrap">
      <div className={`project-row ${project.status}`} style={indent} draggable={!busy} onDragStart={(event) => event.dataTransfer.setData('text/branchtrace-project', project.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const fromId = event.dataTransfer.getData('text/branchtrace-project'); if (fromId) void onReorder(project.parentId, fromId, project.id) }}>
        <button className="tree-toggle" onClick={() => hasChildren && void onAction(() => api.setProjectExpanded(project.id, !project.isExpanded))} aria-label={hasChildren ? (project.isExpanded ? '折叠' : '展开') : '无子项目'}>{hasChildren ? (project.isExpanded ? '⌄' : '›') : '·'}</button>
        <button className={`status-dot ${project.status}`} title={statusText[project.status]} onClick={() => void changeStatus()} aria-label={`状态：${statusText[project.status]}`} />
        <button className="project-title" onDoubleClick={() => void rename()} onClick={() => onOpenDetail(project.id)}>{project.title}</button>
        <div className="progress-history">{project.recentProgressDates.map((date) => <span key={date}>#{date.slice(5).replace('-', '')}</span>)}{project.progressCount > 3 && <em>+{project.progressCount - 3}</em>}</div>
        <button className={project.progressedToday ? 'progress-button checked' : 'progress-button'} disabled={busy || project.status !== 'active'} onClick={() => void toggleProgress()} title={project.status === 'active' ? '记录今日推进' : '终止项目不能新增推进'}>{project.progressedToday ? '✓ 今日推进' : '＋ 今日推进'}</button>
        <div className="row-actions">
          <button onClick={() => void rename()} title="重命名">✎</button>
          <button onClick={() => setAddingChild((value) => !value)} title="新建子项目">＋</button>
          <button onClick={() => void changeStatus()} title={project.status === 'active' ? '完成或取消' : '恢复'}>{project.status === 'active' ? '⋯' : '↺'}</button>
          <button onClick={() => onOpenCalendar(project.id)} title="推进日历">▦</button>
          {project.status !== 'active' && <button onClick={() => void updateTerminalDate()} title="修改终止日期">⌁</button>}
          <button onClick={() => void moveTo()} title="移动到">↗</button>
          <button className="danger-quiet" onClick={() => void remove()} title="移入回收站">⌫</button>
        </div>
      </div>
      {addingChild && <div className="inline-child" style={{ paddingLeft: `${52 + depth * 28}px` }}><input autoFocus value={childTitle} onChange={(event) => setChildTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void addChild(); if (event.key === 'Escape') setAddingChild(false) }} placeholder={`在“${project.title}”下新建子项目`} /><button onClick={() => void addChild()}>保存</button></div>}
    </div>
  )
}

function DailyView({ daily, weekStart, onWeekChange, busy, onAction, onOpenDetail }: { daily: { weekStart: string; today: string; days: DailyDayDto[] } | undefined; weekStart: string; onWeekChange: (value: string) => void; busy: boolean; onAction: (action: () => Promise<unknown>, success?: string) => Promise<void>; onOpenDetail: (id: string) => void }) {
  const moveWeek = (amount: number) => {
    const date = new Date(`${weekStart}T12:00:00`); date.setDate(date.getDate() + amount * 7)
    onWeekChange(date.toISOString().slice(0, 10))
  }
  const todayWeek = () => {
    const now = new Date(); const day = now.getDay() || 7; now.setDate(now.getDate() - day + 1); onWeekChange(now.toISOString().slice(0, 10))
  }
  return (
    <section className="view-stack daily-view">
      <div className="daily-heading">
        <div><p className="eyebrow">DAILY / 轨迹</p><h1>每日行动</h1><p className="heading-copy">一周七列，只记录实际发生的推进和需要处理的提醒。</p></div>
        <div className="week-controls"><button onClick={() => moveWeek(-1)} aria-label="上一周">←</button><button className="week-current" onClick={todayWeek}>回到本周</button><button onClick={() => moveWeek(1)} aria-label="下一周">→</button></div>
      </div>
      {!daily && <div className="card loading-card">正在整理这一周的轨迹…</div>}
      {daily && <div className="week-grid">{daily.days.map((day) => <DailyColumn key={day.date} day={day} today={daily.today} busy={busy} onAction={onAction} onOpenDetail={onOpenDetail} />)}</div>}
    </section>
  )
}

function DailyColumn({ day, today, busy, onAction, onOpenDetail }: { day: DailyDayDto; today: string; busy: boolean; onAction: (action: () => Promise<unknown>, success?: string) => Promise<void>; onOpenDetail: (id: string) => void }) {
  const [newReminder, setNewReminder] = useState('')
  const isToday = day.date === today
  const canAdd = day.date >= today
  const addReminder = async () => {
    if (!newReminder.trim()) return
    await onAction(() => api.createReminder(newReminder.trim(), day.date), '提醒已创建')
    setNewReminder('')
  }
  const reorderReminders = async (fromId: string, toId: string) => {
    const ordered = day.plannedReminders.map((item) => item.reminder.id)
    const fromIndex = ordered.indexOf(fromId)
    const toIndex = ordered.indexOf(toId)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
    const [moved] = ordered.splice(fromIndex, 1)
    ordered.splice(toIndex, 0, moved)
    await onAction(() => api.reorderReminders(day.date, ordered), '提醒顺序已保存')
  }
  return (
    <article className={`day-column ${isToday ? 'today' : ''}`}>
      <header className="day-header"><span>{formatWeekday(day.date)}</span><strong>{day.date.slice(5).replace('-', ' / ')}</strong>{isToday && <em>今天</em>}</header>
      <div className="day-body">
        {day.completedProjects.length > 0 && <DayGroup title="项目完成" tone="done">{day.completedProjects.map((item) => <ProjectDailyRow key={item.projectId} item={item} onOpenDetail={onOpenDetail} completed />)}</DayGroup>}
        {day.progressedProjects.length > 0 && <DayGroup title="项目推进" tone="progress">{day.progressedProjects.map((item) => <ProjectDailyRow key={item.projectId} item={item} onOpenDetail={onOpenDetail} />)}</DayGroup>}
        {(day.plannedReminders.length > 0 || day.overdueReminders.length > 0 || day.crossDayCompletedReminders.length > 0 || canAdd) && <DayGroup title="独立提醒" tone="reminder">
          {canAdd && <div className="reminder-create"><span>＋</span><input value={newReminder} onChange={(event) => setNewReminder(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void addReminder(); if (event.key === 'Escape') setNewReminder('') }} placeholder="添加提醒…" aria-label={`${day.date} 新建提醒`} /></div>}
          {day.plannedReminders.map((item) => <ReminderRow key={`planned-${item.reminder.id}`} item={item} busy={busy} onAction={onAction} onReorder={reorderReminders} />)}
          {day.overdueReminders.length > 0 && <div className="subgroup-label">逾期待处理</div>}
          {day.overdueReminders.map((item) => <ReminderRow key={`overdue-${item.reminder.id}`} item={item} busy={busy} onAction={onAction} overdue />)}
          {day.crossDayCompletedReminders.length > 0 && <div className="subgroup-label">跨日完成</div>}
          {day.crossDayCompletedReminders.map((item) => <ReminderRow key={`completed-${item.reminder.id}`} item={item} busy={busy} onAction={onAction} />)}
        </DayGroup>}
        {day.completedProjects.length === 0 && day.progressedProjects.length === 0 && day.plannedReminders.length === 0 && day.overdueReminders.length === 0 && day.crossDayCompletedReminders.length === 0 && !canAdd && <div className="day-empty">这一天还没有记录</div>}
      </div>
    </article>
  )
}

function DayGroup({ title, tone, children }: { title: string; tone: string; children: ReactNode }) {
  return <section className={`day-group ${tone}`}><h2>{title}</h2><div>{children}</div></section>
}

function ProjectDailyRow({ item, onOpenDetail, completed = false }: { item: ProjectDailyItem; onOpenDetail: (id: string) => void; completed?: boolean }) {
  return <button className="daily-item project-daily-item" onClick={() => onOpenDetail(item.projectId)}><span className="item-icon">{completed ? '✓' : '↗'}</span><span className="item-text"><strong>{item.title}</strong>{item.parentPath.length > 0 && <small>{item.parentPath.join(' / ')}{item.shortId ? ` · ${item.shortId}` : ''}</small>}</span>{item.progressedSameDay && <em>当天也推进</em>}</button>
}

function ReminderRow({ item, overdue = false, busy, onAction, onReorder }: { item: ReminderDailyItem; overdue?: boolean; busy: boolean; onAction: (action: () => Promise<unknown>, success?: string) => Promise<void>; onReorder?: (fromId: string, toId: string) => Promise<void> }) {
  const { reminder } = item
  const toggle = () => {
    if (reminder.status === 'canceled') return
    return onAction(() => reminder.status === 'completed' ? api.restoreReminder(reminder.id, reminder.version) : api.completeReminder(reminder.id, reminder.version), reminder.status === 'completed' ? '提醒已恢复' : '提醒已完成')
  }
  const rename = async () => {
    const value = window.prompt('重命名提醒', reminder.title)
    if (value?.trim()) await onAction(() => api.renameReminder(reminder.id, value.trim(), reminder.version), '提醒已重命名')
  }
  const schedule = async () => {
    const value = window.prompt('修改计划日期（YYYY-MM-DD）', reminder.scheduledDate)
    if (value?.trim()) await onAction(() => api.updateReminderSchedule(reminder.id, value.trim(), reminder.version), '计划日期已更新')
  }
  const completedDate = async () => {
    if (reminder.status !== 'completed') return
    const value = window.prompt('修改完成日期（YYYY-MM-DD）', reminder.completedDate ?? '')
    if (value?.trim()) await onAction(() => api.updateReminderCompletedDate(reminder.id, value.trim(), reminder.version), '完成日期已更新')
  }
  const cancel = () => onAction(() => reminder.status === 'canceled' ? api.restoreReminder(reminder.id, reminder.version) : api.cancelReminder(reminder.id, reminder.version), reminder.status === 'canceled' ? '提醒已恢复' : '提醒已取消')
  const remove = () => window.confirm(`将“${reminder.title}”移入回收站？`) && onAction(() => api.trashReminder(reminder.id), '提醒已移入回收站')
  return <div className={`reminder-row ${reminder.status} ${overdue ? 'overdue' : ''}`} draggable={Boolean(onReorder) && !busy} onDragStart={(event) => event.dataTransfer.setData('text/branchtrace-reminder', reminder.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const fromId = event.dataTransfer.getData('text/branchtrace-reminder'); if (fromId && onReorder) void onReorder(fromId, reminder.id) }}><button className="reminder-check" disabled={busy || reminder.status === 'canceled'} onClick={() => void toggle()}>{reminder.status === 'completed' ? '✓' : reminder.status === 'canceled' ? '—' : ''}</button><button className="reminder-title" onDoubleClick={() => void rename()}>{reminder.title}</button>{overdue && <span className="overdue-label">逾期</span>}<div className="mini-actions"><button onClick={() => void rename()} title="重命名">✎</button><button onClick={() => void schedule()} title="修改计划日">⌁</button>{reminder.status === 'completed' && <button onClick={() => void completedDate()} title="修改完成日">◷</button>}<button onClick={() => void cancel()} title={reminder.status === 'canceled' ? '恢复' : '取消'}>{reminder.status === 'canceled' ? '↺' : '×'}</button><button onClick={() => void remove()} title="移入回收站">⌫</button></div></div>
}

function TrashView({ kind, entries, loading, onKindChange, onAction }: { kind: 'project' | 'reminder'; entries: TrashEntryDto[]; loading: boolean; onKindChange: (kind: 'project' | 'reminder') => void; onAction: (action: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const empty = async () => {
    if (window.confirm(`确认清空${kind === 'project' ? '项目' : '提醒'}回收站？永久删除后无法恢复。`)) await onAction(() => api.emptyTrash(kind), '回收站已清空')
  }
  return <section className="view-stack narrow-view"><div className="view-heading"><div><p className="eyebrow">TRASH / 恢复</p><h1>统一回收站</h1><p className="heading-copy">软删除保留状态和历史，永久删除前请确认影响范围。</p></div><button className="danger-button" disabled={entries.length === 0} onClick={() => void empty()}>清空当前分类</button></div><div className="segmented"><button className={kind === 'project' ? 'selected' : ''} onClick={() => onKindChange('project')}>项目</button><button className={kind === 'reminder' ? 'selected' : ''} onClick={() => onKindChange('reminder')}>独立提醒</button></div><div className="trash-list card">{loading && <div className="loading-card">正在读取回收站…</div>}{!loading && entries.length === 0 && <EmptyState title="回收站是空的" copy="移入回收站的项目和提醒会在这里保留，除非手动永久删除。" />}{entries.map((entry) => <TrashRow key={entry.id} entry={entry} onAction={onAction} />)}</div></section>
}

function TrashRow({ entry, onAction }: { entry: TrashEntryDto; onAction: (action: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const restore = () => onAction(() => api.restoreTrashEntry(entry.id), '已恢复')
  const destroy = () => window.confirm(`永久删除“${entry.titleSnapshot}”？此操作无法撤销。`) && onAction(() => api.permanentlyDeleteTrashEntry(entry.id), '已永久删除')
  return <div className="trash-row"><div><strong>{entry.titleSnapshot}</strong><small>{entry.kind === 'project' ? `项目树 · ${entry.affectedCountAtDelete} 个活跃节点` : '独立提醒'} · {new Date(entry.deletedAt).toLocaleString()}</small></div><div className="trash-actions"><button onClick={() => void restore()}>恢复</button><button className="danger-quiet" onClick={() => void destroy()}>永久删除</button></div></div>
}

function SettingsView({ mode, onAction }: { mode: ThemeMode; onAction: (action: () => Promise<unknown>, success?: string) => Promise<void> }) {
  return <section className="view-stack narrow-view"><div className="view-heading"><div><p className="eyebrow">SETTINGS / 偏好</p><h1>设置</h1><p className="heading-copy">选择界面主题，设置会保存在本地数据库。</p></div></div><div className="settings-card card"><h2>主题</h2><p>跟随系统会在操作系统主题变化时自动更新。</p><div className="theme-options">{(['system', 'light', 'dark'] as ThemeMode[]).map((option) => <button key={option} className={mode === option ? 'theme-option selected' : 'theme-option'} onClick={() => void onAction(() => api.setThemeMode(option), '主题设置已保存')}><span className={`theme-swatch ${option}`} /><span>{option === 'system' ? '跟随系统' : option === 'light' ? '浅色' : '深色'}</span>{mode === option && <b>✓</b>}</button>)}</div></div><div className="settings-note"><strong>枝迹 · BranchTrace</strong><span>本地离线 MVP · 数据存储于应用专属目录</span></div></section>
}

function ProgressCalendarModal({ project, busy, onAction, onClose }: { project: ProjectDto; busy: boolean; onAction: (action: () => Promise<unknown>, success?: string) => Promise<void>; onClose: () => void }) {
  const today = new Date()
  const [month, setMonth] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`)
  const progress = useQuery({ queryKey: ['projectProgressMonth', project.id, month], queryFn: () => api.getProjectProgressMonth(project.id, month) })
  const [yearText, monthText] = month.split('-')
  const year = Number(yearText)
  const monthIndex = Number(monthText) - 1
  const firstDay = new Date(year, monthIndex, 1)
  const leading = (firstDay.getDay() || 7) - 1
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const dates = Array.from({ length: daysInMonth }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
  const recorded = new Set(progress.data ?? [])
  const todayText = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const changeMonth = (amount: number) => {
    const next = new Date(year, monthIndex + amount, 1)
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
  }
  const toggle = (date: string) => {
    const has = recorded.has(date)
    if (project.status !== 'active' && !has) return
    if (date > todayText && !has) return
    void onAction(() => api.setProjectProgress(project.id, date, !has, project.version), has ? '已撤销该日推进' : '已记录该日推进')
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="modal-card calendar-modal" role="dialog" aria-modal="true" aria-label="推进日历"><button className="modal-close" onClick={onClose}>×</button><p className="eyebrow">PROJECT / 推进日历</p><h2>{project.title}</h2><div className="calendar-toolbar"><button onClick={() => changeMonth(-1)}>←</button><strong>{year} 年 {monthIndex + 1} 月</strong><button onClick={() => changeMonth(1)}>→</button></div><div className="calendar-weekdays">{['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{Array.from({ length: leading }, (_, index) => <span key={`leading-${index}`} />)}{dates.map((date) => { const has = recorded.has(date); const future = date > todayText; const disabled = busy || (future && !has) || (project.status !== 'active' && !has); return <button key={date} className={`${has ? 'recorded' : ''} ${date === todayText ? 'today' : ''}`} disabled={disabled} onClick={() => toggle(date)}>{Number(date.slice(-2))}</button> })}</div><p className="calendar-help">绿色日期表示已推进；未来日期不能新增，终止项目只能撤销已有记录。</p></div></div>
}

function ProjectDetailModal({ detail, loading, onClose }: { detail: ProjectDetailDto | undefined; loading: boolean; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="modal-card" role="dialog" aria-modal="true" aria-label="项目详情"><button className="modal-close" onClick={onClose}>×</button>{loading && <div className="loading-card">正在读取项目详情…</div>}{detail && <><p className="eyebrow">PROJECT / 只读详情</p><h2>{detail.title}</h2><div className="detail-path">{detail.parentPath.length ? detail.parentPath.join(' / ') : '顶层项目'}</div><div className="detail-status"><span className={`status-dot ${detail.status}`} />{statusText[detail.status]}</div><div className="detail-section"><h3>推进历史</h3>{detail.progressDates.length ? <div className="date-chips">{detail.progressDates.map((date) => <span key={date}>{date}</span>)}</div> : <p className="muted">暂无推进记录</p>}</div><div className="detail-section detail-meta"><span>记录 {detail.progressCount} 天</span><span>版本 {detail.version}</span></div></>}</div></div>
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="empty-state"><div className="empty-glyph">枝</div><strong>{title}</strong><span>{copy}</span></div>
}

function formatWeekday(value: string) {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return weekdays[dateFrom(value).getDay()]
}

function dateFrom(value: string) { return new Date(`${value}T12:00:00`) }

export default function App() {
  return <QueryClientProvider client={queryClient}><AppShell /></QueryClientProvider>
}
