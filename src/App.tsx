import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { BranchNodeIcon, CloseIcon, SettingsIcon, TrashIcon } from './components/icons'
import { AppErrorBoundary, errorMessage, LoadError } from './components/ui'
import type { ActionRunner, NoticeConfig } from './components/ui'
import { useGlobalShortcut } from './hooks/useGlobalShortcut'
import { ProgressCalendarModal } from './modals/ProgressCalendarModal'
import { ProjectDetailModal } from './modals/ProjectDetailModal'
import { ALL_QUERY_KEYS } from './query-keys'
import type { ApiError } from './types'
import { formatFullDate, getWeekStart, todayIsoDate } from './ui-format'
import { MonthlyView } from './views/MonthlyView'
import { ProjectView } from './views/ProjectView'
import { SettingsView } from './views/SettingsView'
import { TrashView } from './views/TrashView'
import { WeeklyView } from './views/WeeklyView'
import './index.css'

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

type View = 'project' | 'weekly' | 'monthly' | 'trash' | 'settings'

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

  useGlobalShortcut((event) => {
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
  }, { allowModifiers: true })

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
  const today = clock.data?.today ?? todayIsoDate()
  const currentMonth = today.slice(0, 7)
  const calendarProject = projectList.find((project) => project.id === calendarProjectId)

  return <div className={`app-shell ${view === 'monthly' ? 'view-monthly' : ''}`}>
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

export default function App() { return <AppErrorBoundary><QueryClientProvider client={queryClient}><AppShell /></QueryClientProvider></AppErrorBoundary> }
