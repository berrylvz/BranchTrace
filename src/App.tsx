import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import {
  BranchNodeIcon,
  CalendarDaysIcon,
  CloseIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
  TrashIcon,
} from './components/icons'
import { ProjectDetailPanel } from './components/ProjectDetailPanel'
import { AppErrorBoundary, errorMessage, LoadError } from './components/ui'
import type { ActionRunner, NoticeConfig } from './components/ui'
import { useAppUpdater } from './hooks/useAppUpdater'
import { useGlobalShortcut } from './hooks/useGlobalShortcut'
import { ProgressCalendarModal } from './modals/ProgressCalendarModal'
import { loadDisplayDensity, saveDisplayDensity } from './preferences'
import type { DisplayDensity } from './preferences'
import { ALL_QUERY_KEYS, SETTINGS_KEYS } from './query-keys'
import { buildRangePreset } from './range-summary'
import type { DateRangeBounds } from './range-summary'
import type { ApiError } from './types'
import { formatFullDate, getWeekStart, todayIsoDate } from './ui-format'
import { CalendarView } from './views/CalendarView'
import type { CalendarMode } from './views/CalendarView'
import { ProjectView } from './views/ProjectView'
import { SettingsView } from './views/SettingsView'
import { TrashView } from './views/TrashView'

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

type View = 'project' | 'calendar' | 'trash' | 'settings'

function AppShell() {
  const client = useQueryClient()
  const [view, setView] = useState<View>('project')
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('month')
  const [density, setDensity] = useState<DisplayDensity>(() => loadDisplayDensity())
  const [effectiveDark, setEffectiveDark] = useState(false)
  const [month, setMonth] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRangeBounds | null>(null)
  const [trashKind, setTrashKind] = useState<'project' | 'reminder'>('project')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [calendarProjectId, setCalendarProjectId] = useState<string | null>(null)
  const [notice, setNotice] = useState<NoticeConfig | null>(null)
  const [noticePaused, setNoticePaused] = useState(false)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [focusCreateTick, setFocusCreateTick] = useState(0)
  const [focusSearchTick, setFocusSearchTick] = useState(0)
  const [focusCalendarCreateTick, setFocusCalendarCreateTick] = useState(0)
  const [addChildRequest, setAddChildRequest] = useState<{ parentId: string; tick: number } | null>(null)
  const [locateTarget, setLocateTarget] = useState<{ projectId: string; tick: number } | null>(null)
  const actionLock = useRef(false)
  const previousClock = useRef<{ today: string; weekStart: string } | null>(null)

  const clock = useQuery({ queryKey: ['clockContext'], queryFn: api.getClockContext, refetchInterval: 60_000 })
  const projects = useQuery({ queryKey: ['projectTree'], queryFn: api.getProjectTree })
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getAppSettings })
  const monthly = useQuery({
    queryKey: ['monthCalendar', month],
    queryFn: () => api.getMonthCalendar(month!),
    enabled: view === 'calendar' && calendarMode === 'month' && Boolean(month),
  })
  const dailyRange = useQuery({
    queryKey: ['dailyRange', dateRange?.startDate, dateRange?.endDate],
    queryFn: () => api.getDailyRange(dateRange!.startDate, dateRange!.endDate),
    enabled: view === 'calendar' && calendarMode === 'range' && Boolean(dateRange),
  })
  const trash = useQuery({ queryKey: ['trash', trashKind], queryFn: () => api.listTrash(trashKind), enabled: view === 'trash' })
  const detail = useQuery({ queryKey: ['projectDetail', selectedProjectId], queryFn: () => api.getProjectDetail(selectedProjectId!), enabled: Boolean(selectedProjectId) })
  const updater = useAppUpdater({
    onAvailable: (update) => {
      setNotice({
        message: `BranchTrace v${update.version} is available`,
        durationMs: 7000,
        action: {
          label: 'Review Update',
          onClick: () => setView('settings'),
        },
      })
    },
  })

  useEffect(() => {
    document.documentElement.dataset.density = density
  }, [density])

  useEffect(() => {
    const current = clock.data
    if (!current) return
    const previous = previousClock.current
    previousClock.current = { today: current.today, weekStart: current.weekStart }
    const currentMonthKey = current.today.slice(0, 7)
    const defaultRange = buildRangePreset('last-7', current.today, current.weekStart)
    if (!previous) {
      setMonth((currentMonth) => currentMonth ?? currentMonthKey)
      setDateRange((currentRange) => currentRange ?? defaultRange)
      return
    }
    if (previous.today !== current.today || previous.weekStart !== current.weekStart) {
      const previousMonthKey = previous.today.slice(0, 7)
      const previousDefaultRange = buildRangePreset('last-7', previous.today, previous.weekStart)
      setMonth((currentMonth) => (!currentMonth || currentMonth === previousMonthKey ? currentMonthKey : currentMonth))
      setDateRange((currentRange) => (
        !currentRange
        || (currentRange.startDate === previousDefaultRange.startDate && currentRange.endDate === previousDefaultRange.endDate)
          ? defaultRange
          : currentRange
      ))
      void Promise.all(
        ['projectTree', 'dailyWeek', 'dailyRange', 'monthCalendar', 'projectDetail', 'projectProgressMonth']
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
      setEffectiveDark(dark)
      document.documentElement.classList.toggle('dark', dark)
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#121916' : '#f6f8f7')
    }
    apply()
    if (mode !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.data?.themeMode])

  const openCalendarView = useCallback(() => {
    setCalendarMode('month')
    setView('calendar')
    void client
      .fetchQuery({ queryKey: ['clockContext'], queryFn: api.getClockContext, staleTime: 0 })
      .then((fresh) => {
        const freshMonth = fresh.today.slice(0, 7)
        setMonth((current) => current ?? freshMonth)
        setDateRange((current) => current ?? buildRangePreset('last-7', fresh.today, fresh.weekStart))
        return Promise.all([
          client.invalidateQueries({ queryKey: ['monthCalendar'] }),
          client.invalidateQueries({ queryKey: ['dailyRange'] }),
          client.invalidateQueries({ queryKey: ['projectTree'] }),
        ])
      })
      .catch(() => {
        if (clock.data) {
          setMonth((current) => current ?? clock.data!.today.slice(0, 7))
          setDateRange((current) => current ?? buildRangePreset('last-7', clock.data!.today, clock.data!.weekStart))
        }
      })
  }, [client, clock.data])

  const locateProject = useCallback((projectId: string) => {
    setView('project')
    setSelectedProjectId(projectId)
    setLocateTarget({ projectId, tick: Date.now() })
  }, [])

  const startAddChildFromPanel = useCallback((parentId: string) => {
    setView('project')
    setAddChildRequest({ parentId, tick: Date.now() })
  }, [])

  const handleDensityChange = useCallback((next: DisplayDensity) => {
    setDensity(next)
    saveDisplayDensity(next)
  }, [])

  useGlobalShortcut((event) => {
    const mod = event.ctrlKey || event.metaKey
    const lower = event.key.toLowerCase()

    if (mod && !event.altKey && !event.shiftKey && (lower === 'k' || lower === 'f')) {
      event.preventDefault()
      setView('project')
      setFocusSearchTick((tick) => tick + 1)
      return
    }
    if (mod && !event.altKey && !event.shiftKey && lower === 'n') {
      event.preventDefault()
      if (view === 'calendar') {
        setFocusCalendarCreateTick((tick) => tick + 1)
      } else {
        setView('project')
        setFocusCreateTick((tick) => tick + 1)
      }
      return
    }
    if (!event.altKey && !event.shiftKey && (event.key === '1' || event.key === '2')) {
      event.preventDefault()
      if (event.key === '1') setView('project')
      else openCalendarView()
      return
    }
    if (!mod && !event.altKey && !event.shiftKey && lower === 'n') {
      event.preventDefault()
      if (view === 'calendar') {
        setFocusCalendarCreateTick((tick) => tick + 1)
      } else {
        setView('project')
        setFocusCreateTick((tick) => tick + 1)
      }
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
        setNotice({ message: 'Saved, but refreshing the view failed. Please reopen this page.', error: true })
      }
      return { ok: true, data }
    } finally {
      actionLock.current = false
      setPendingKey(null)
    }
  }, [invalidateKeys])

  const toggleThemeQuick = () => {
    const nextMode = effectiveDark ? 'light' : 'dark'
    void perform(
      () => api.setThemeMode(nextMode),
      nextMode === 'dark' ? 'Switched to Dark theme' : 'Switched to Light theme',
      { key: 'settings:theme', invalidate: SETTINGS_KEYS },
    )
  }

  const startupError = ([projects.error, settings.error, monthly.error, dailyRange.error, trash.error] as unknown[]).find(isStartupError)
  if (startupError) {
    return <StartupErrorView error={startupError} />
  }

  const projectList = projects.data ?? []
  const today = clock.data?.today ?? todayIsoDate()
  const currentWeekStart = clock.data?.weekStart ?? getWeekStart(today)
  const currentMonth = today.slice(0, 7)
  const effectiveRange = dateRange ?? buildRangePreset('last-7', today, currentWeekStart)
  const calendarProject = projectList.find((project) => project.id === calendarProjectId)

  return <div className={`app-shell ${view === 'calendar' ? 'view-calendar' : ''}`}>
    <header className="topbar">
      <div className="brand-block">
        <span className="brand-mark" aria-hidden="true"><BranchNodeIcon size={15} /></span>
        <span className="brand-name">BranchTrace</span>
      </div>
      <nav className="main-nav" aria-label="Primary views">
        <button type="button" data-focus-fallback className={`nav-item ${view === 'project' ? 'active' : ''}`} aria-current={view === 'project' ? 'page' : undefined} onClick={() => setView('project')}>
          <BranchNodeIcon size={15} /><span>Projects</span>
        </button>
        <button type="button" className={`nav-item ${view === 'calendar' ? 'active' : ''}`} aria-current={view === 'calendar' ? 'page' : undefined} onClick={openCalendarView}>
          <CalendarDaysIcon size={15} /><span>Calendar</span>
        </button>
      </nav>
      <div className="top-actions">
        <time className="today-text" dateTime={today} title={`Today: ${today}`}>{formatFullDate(today)}</time>
        <span className="top-divider" aria-hidden="true" />
        <div className="utility-nav" role="group" aria-label="Utilities">
          <button
            type="button"
            className="utility-button"
            disabled={pendingKey === 'settings:theme'}
            aria-label={effectiveDark ? 'Switch to light theme' : 'Switch to dark theme'}
            title={effectiveDark ? 'Switch to Light theme' : 'Switch to Dark theme'}
            onClick={toggleThemeQuick}
          >{effectiveDark ? <SunIcon size={16} /> : <MoonIcon size={16} />}</button>
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
            aria-label={updater.hasUpdateAvailable ? 'Settings (update available)' : 'Settings'}
            aria-current={view === 'settings' ? 'page' : undefined}
            title={updater.hasUpdateAvailable ? 'Settings — Update available' : 'Settings'}
            onClick={() => setView('settings')}
          >
            <SettingsIcon size={16} />
            {updater.hasUpdateAvailable && <span className="utility-badge-dot" aria-hidden="true" />}
          </button>
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

    <div className="workspace-body">
      <main className="main-content">
        {view === 'project' && <>
          {projects.isError && <LoadError error={projects.error} retry={() => void projects.refetch()} />}
          <ProjectView
            projects={projectList}
            loading={projects.isLoading}
            pendingKey={pendingKey}
            today={today}
            selectedProjectId={selectedProjectId}
            focusCreateTick={focusCreateTick}
            focusSearchTick={focusSearchTick}
            addChildRequest={addChildRequest}
            locateTarget={locateTarget}
            onClearAddChildRequest={() => setAddChildRequest(null)}
            onAction={perform}
            onOpenDetail={setSelectedProjectId}
            onOpenCalendar={setCalendarProjectId}
          />
        </>}
        {view === 'calendar' && <>
          {clock.isError && <LoadError error={clock.error} retry={() => void clock.refetch()} />}
          {calendarMode === 'month' && monthly.isError && <LoadError error={monthly.error} retry={() => void monthly.refetch()} />}
          {calendarMode === 'range' && dailyRange.isError && <LoadError error={dailyRange.error} retry={() => void dailyRange.refetch()} />}
          <CalendarView
            mode={calendarMode}
            calendar={monthly.data}
            rangeData={dailyRange.data}
            month={month ?? currentMonth}
            currentMonth={currentMonth}
            rangeBounds={effectiveRange}
            today={today}
            weekStart={currentWeekStart}
            pendingKey={pendingKey}
            focusCreateTick={focusCalendarCreateTick}
            onModeChange={setCalendarMode}
            onMonthChange={setMonth}
            onRangeChange={setDateRange}
            onOpenProjectDetail={setSelectedProjectId}
            onAction={perform}
          />
        </>}
        {view === 'trash' && <>
          {trash.isError && <LoadError error={trash.error} retry={() => void trash.refetch()} />}
          <TrashView kind={trashKind} entries={trash.data ?? []} loading={trash.isLoading} pendingKey={pendingKey} onKindChange={setTrashKind} onAction={perform} />
        </>}
        {view === 'settings' && <>
          {settings.isError && <LoadError error={settings.error} retry={() => void settings.refetch()} />}
          <SettingsView
            mode={settings.data?.themeMode ?? 'system'}
            density={density}
            pending={pendingKey === 'settings:theme' || settings.isLoading}
            updater={updater}
            onDensityChange={handleDensityChange}
            onAction={perform}
          />
        </>}
      </main>

      {selectedProjectId && <ProjectDetailPanel
        detail={detail.data}
        projects={projectList}
        loading={detail.isLoading}
        error={detail.error}
        today={today}
        pendingKey={pendingKey}
        showLocateButton={view !== 'project'}
        overlay={view === 'calendar'}
        retry={() => void detail.refetch()}
        onClose={() => setSelectedProjectId(null)}
        onLocate={locateProject}
        onOpenCalendar={setCalendarProjectId}
        onStartAddChild={startAddChildFromPanel}
        onAction={perform}
      />}
    </div>

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
