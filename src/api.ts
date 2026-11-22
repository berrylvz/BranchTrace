import { invoke } from '@tauri-apps/api/core'
import type {
  ApiError,
  ClockContext,
  DailyWeekDto,
  MonthCalendarDto,
  ProjectDailyItem,
  ProjectDetailDto,
  ProjectDto,
  ReminderDailyItem,
  ReminderDto,
  ThemeMode,
  ThemeSettings,
  TrashEntryDto,
} from './types'

const tauriAvailable = typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)

const dateToday = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const dateFrom = (value: string) => new Date(`${value}T12:00:00`)
const iso = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
const monday = (value: string) => {
  const date = dateFrom(value)
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1)
  return iso(date)
}
const addDays = (value: string, amount: number) => {
  const date = dateFrom(value)
  date.setDate(date.getDate() + amount)
  return iso(date)
}

interface MockState {
  projects: ProjectDto[]
  progress: Record<string, string[]>
  reminders: ReminderDto[]
  trash: TrashEntryDto[]
  trashBatches?: Record<string, string[]>
  themeMode: ThemeMode
}

const mockDefault = (): MockState => ({ projects: [], progress: {}, reminders: [], trash: [], themeMode: 'system' })
let mockState: MockState | null = null

function getMockState(): MockState {
  if (mockState) return mockState
  try {
    const saved = localStorage.getItem('branchtrace-mock')
    mockState = saved ? JSON.parse(saved) as MockState : mockDefault()
  } catch {
    mockState = mockDefault()
  }
  return mockState
}

function saveMockState(state = mockState) {
  if (!state) return
  localStorage.setItem('branchtrace-mock', JSON.stringify(state))
  mockState = state
}

function createApiError(code: string, message: string, details?: Record<string, unknown>): Error & ApiError {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) })
}

function mockFail(code: string, message: string, details?: Record<string, unknown>): never {
  throw createApiError(code, message, details)
}

function validateTitle(raw: unknown): string {
  const trimmed = String(raw ?? '').trim()
  const length = [...trimmed].length
  if (length === 0 || length > 500) {
    mockFail('INVALID_TITLE', 'Title cannot be empty and must be 500 characters or fewer')
  }
  return trimmed
}

function validateIsoDate(raw: unknown): string {
  const value = String(raw ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    mockFail('INVALID_DATE', `Invalid date: ${value}`)
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    mockFail('INVALID_DATE', `Invalid date: ${value}`)
  }
  return value
}

function validateMonth(raw: unknown): string {
  const value = String(raw ?? '')
  if (!/^\d{4}-\d{2}$/.test(value)) {
    mockFail('INVALID_DATE', 'Month must use YYYY-MM format')
  }
  validateIsoDate(`${value}-01`)
  return value
}

function checkVersion(expected: unknown, actual: number) {
  const expectedNumber = Number(expected)
  if (expectedNumber !== actual) {
    mockFail('VERSION_CONFLICT', 'This item was modified elsewhere. Please refresh and try again.', { expectedVersion: expectedNumber, actualVersion: actual })
  }
}

function nextOrder(items: { sortOrder: number }[]) {
  return (items.reduce((max, item) => Math.max(max, item.sortOrder), 0) || 0) + 1024
}

function sortedDates(dates: string[] | undefined): string[] {
  return [...new Set(dates ?? [])].sort()
}

function projectDto(project: ProjectDto, state = getMockState()): ProjectDto {
  const progress = sortedDates(state.progress[project.id])
  const today = dateToday()
  return {
    ...project,
    recentProgressDates: progress.slice(-3),
    progressCount: progress.length,
    progressedToday: progress.includes(today),
  }
}

function mockProjectIsTrashed(project: ProjectDto, state: MockState): boolean {
  const batches = state.trashBatches
  for (const entry of state.trash) {
    if (entry.kind !== 'project') continue
    const batchMembers = batches?.[entry.id]
    if (batchMembers) {
      if (batchMembers.includes(project.id)) return true
    } else {
      let current: ProjectDto | undefined = project
      const visited = new Set<string>()
      while (current && !visited.has(current.id)) {
        visited.add(current.id)
        if (entry.rootEntityId === current.id) return true
        current = current.parentId ? state.projects.find((item) => item.id === current?.parentId) : undefined
      }
    }
  }
  return false
}

function mockReminderIsTrashed(reminderId: string, state: MockState): boolean {
  return state.trash.some((entry) => entry.kind === 'reminder' && entry.rootEntityId === reminderId)
}

function mockProjectSubtree(rootId: string, state: MockState): ProjectDto[] {
  const childrenByParent = new Map<string, ProjectDto[]>()
  const byId = new Map<string, ProjectDto>()
  for (const item of state.projects) {
    byId.set(item.id, item)
    if (item.parentId) {
      const list = childrenByParent.get(item.parentId)
      if (list) list.push(item)
      else childrenByParent.set(item.parentId, [item])
    }
  }
  const root = byId.get(rootId)
  if (!root) return []
  const result: ProjectDto[] = []
  const stack: ProjectDto[] = [root]
  const visited = new Set<string>()
  while (stack.length) {
    const node = stack.pop()!
    if (visited.has(node.id)) continue
    visited.add(node.id)
    result.push(node)
    const children = childrenByParent.get(node.id) ?? []
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index])
    }
  }
  return result
}

function mockTreeOrder(projects: ProjectDto[]): ProjectDto[] {
  const groups = new Map<string | null, ProjectDto[]>()
  for (const project of projects) {
    const siblings = groups.get(project.parentId)
    if (siblings) siblings.push(project)
    else groups.set(project.parentId, [project])
  }
  for (const siblings of groups.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  }
  const result: ProjectDto[] = []
  const visited = new Set<string>()
  const stack: ProjectDto[] = []
  const roots = groups.get(null) ?? []
  for (let index = roots.length - 1; index >= 0; index -= 1) stack.push(roots[index])
  while (stack.length) {
    const node = stack.pop()!
    if (visited.has(node.id)) continue
    visited.add(node.id)
    result.push(node)
    const children = groups.get(node.id) ?? []
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index])
  }
  if (result.length !== projects.length) {
    for (const project of projects) {
      if (!visited.has(project.id)) result.push(project)
    }
  }
  return result
}

function applyShortIds(completed: ProjectDailyItem[], progressed: ProjectDailyItem[]) {
  const all = [...completed, ...progressed]
  const groups = new Map<string, string[]>()
  for (const item of all) {
    const key = JSON.stringify([item.parentPath, item.title])
    const list = groups.get(key)
    if (list) list.push(item.projectId)
    else groups.set(key, [item.projectId])
  }
  for (const item of all) {
    const ids = groups.get(JSON.stringify([item.parentPath, item.title]))
    if (!ids || ids.length <= 1) continue
    const chars = [...item.projectId]
    let chosen = item.projectId
    for (let length = 1; length <= chars.length; length += 1) {
      const prefix = chars.slice(0, length).join('')
      const matches = ids.filter((other) => [...other].slice(0, length).join('') === prefix).length
      if (matches === 1) {
        chosen = prefix
        break
      }
    }
    item.shortId = chosen
  }
}

function mockProjectDetail(id: string): ProjectDetailDto {
  const state = getMockState()
  const activeProjects = state.projects.filter((item) => !mockProjectIsTrashed(item, state))
  const project = activeProjects.find((item) => item.id === id)
  if (!project) mockFail('NOT_FOUND', 'Project not found')
  const byId = new Map(activeProjects.map((item) => [item.id, item]))
  const path: string[] = []
  const visited = new Set<string>([project.id])
  let parentId = project.parentId
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    path.unshift(parent.title)
    parentId = parent.parentId
  }
  return { ...projectDto(project, state), parentPath: path, progressDates: sortedDates(state.progress[id]) }
}

function mockDaily(weekStart: string): DailyWeekDto {
  const validatedStart = validateIsoDate(weekStart)
  if (dateFrom(validatedStart).getDay() !== 1) {
    mockFail('INVALID_DATE', 'Week start date must be a Monday')
  }
  const state = getMockState()
  const days: DailyWeekDto['days'] = Array.from({ length: 7 }, (_, offset) => ({
    date: addDays(validatedStart, offset),
    completedProjects: [],
    progressedProjects: [],
    plannedReminders: [],
    overdueReminders: [],
    crossDayCompletedReminders: [],
  }))
  const index = new Map(days.map((day, position) => [day.date, position]))
  const activeProjects = mockTreeOrder(state.projects.filter((project) => !mockProjectIsTrashed(project, state)))
  const byId = new Map(activeProjects.map((item) => [item.id, item]))
  const parentPath = (project: ProjectDto) => {
    const path: string[] = []
    const visited = new Set<string>([project.id])
    let parentId = project.parentId
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      path.unshift(parent.title)
      parentId = parent.parentId
    }
    return path
  }
  for (const project of activeProjects) {
    const dates = sortedDates(state.progress[project.id])
    const base = { projectId: project.id, title: project.title, parentPath: parentPath(project), shortId: null, status: project.status }
    if (project.status === 'completed' && project.completedDate && index.has(project.completedDate)) {
      const day = days[index.get(project.completedDate)!]
      day.completedProjects.push({ ...base, progressedSameDay: dates.includes(project.completedDate) })
    }
    for (const progressDate of dates) {
      const dayIndex = index.get(progressDate)
      if (dayIndex === undefined) continue
      if (!(project.status === 'completed' && project.completedDate === progressDate)) {
        days[dayIndex].progressedProjects.push({ ...base })
      }
    }
  }
  const today = dateToday()
  const todayIndex = index.get(today)
  for (const reminder of state.reminders) {
    if (mockReminderIsTrashed(reminder.id, state)) continue
    const plannedIndex = index.get(reminder.scheduledDate)
    const planned = {
      reminder: { ...reminder },
      displayType: 'planned' as const,
      isPlannedAndCompletedSameDay: reminder.status === 'completed' && reminder.completedDate === reminder.scheduledDate,
    }
    if (plannedIndex !== undefined) days[plannedIndex].plannedReminders.push(planned)
    if (reminder.status === 'completed' && reminder.completedDate && reminder.completedDate !== reminder.scheduledDate) {
      const completedIndex = index.get(reminder.completedDate)
      if (completedIndex !== undefined) {
        days[completedIndex].crossDayCompletedReminders.push({
          reminder: { ...reminder },
          displayType: 'completed',
          isPlannedAndCompletedSameDay: false,
        })
      }
    }
    if (reminder.status === 'active' && reminder.scheduledDate < today && todayIndex !== undefined) {
      days[todayIndex].overdueReminders.push({
        reminder: { ...reminder },
        displayType: 'overdue',
        isPlannedAndCompletedSameDay: false,
      })
    }
  }
  for (const day of days) {
    day.completedProjects.sort((a, b) => a.title.localeCompare(b.title) || a.projectId.localeCompare(b.projectId))
    day.progressedProjects.sort((a, b) => a.title.localeCompare(b.title) || a.projectId.localeCompare(b.projectId))
    day.plannedReminders.sort((a, b) => a.reminder.sortOrder - b.reminder.sortOrder || a.reminder.id.localeCompare(b.reminder.id))
    day.overdueReminders.sort((a, b) => a.reminder.scheduledDate.localeCompare(b.reminder.scheduledDate) || a.reminder.sortOrder - b.reminder.sortOrder || a.reminder.id.localeCompare(b.reminder.id))
    day.crossDayCompletedReminders.sort((a, b) => (a.reminder.completedActionAt ?? '').localeCompare(b.reminder.completedActionAt ?? '') || a.reminder.id.localeCompare(b.reminder.id))
    applyShortIds(day.completedProjects, day.progressedProjects)
  }
  return { weekStart: validatedStart, today, days }
}

function mockMonthCalendar(month: string): MonthCalendarDto {
  const validatedMonth = validateMonth(month)
  const [year, monthNumber] = validatedMonth.split('-').map(Number)
  const firstDay = `${validatedMonth}-01`
  const lastDate = new Date(year, monthNumber, 0, 12)
  const lastDay = iso(lastDate)
  const gridStart = monday(firstDay)
  const lastWeekday = lastDate.getDay() || 7
  const gridEnd = addDays(lastDay, 7 - lastWeekday)

  const days: MonthCalendarDto['days'] = []
  let cursor = gridStart
  while (cursor <= gridEnd) {
    days.push({
      date: cursor,
      inCurrentMonth: cursor.startsWith(validatedMonth),
      completedProjectCount: 0,
      progressedProjectCount: 0,
      plannedReminders: [],
      crossDayCompletedReminders: [],
    })
    cursor = addDays(cursor, 1)
  }

  const state = getMockState()
  const index = new Map(days.map((day, position) => [day.date, position]))
  const activeProjects = state.projects.filter((project) => !mockProjectIsTrashed(project, state))
  for (const project of activeProjects) {
    const completedOn = project.status === 'completed' ? project.completedDate : null
    if (completedOn && index.has(completedOn)) {
      days[index.get(completedOn)!].completedProjectCount += 1
    }
    for (const progressDate of sortedDates(state.progress[project.id])) {
      const dayIndex = index.get(progressDate)
      if (dayIndex === undefined) continue
      if (completedOn !== progressDate) {
        days[dayIndex].progressedProjectCount += 1
      }
    }
  }

  const today = dateToday()
  const overdueReminders: ReminderDailyItem[] = []
  for (const reminder of state.reminders) {
    if (mockReminderIsTrashed(reminder.id, state)) continue
    const plannedIndex = index.get(reminder.scheduledDate)
    if (plannedIndex !== undefined) {
      days[plannedIndex].plannedReminders.push({
        reminder: { ...reminder },
        displayType: 'planned',
        isPlannedAndCompletedSameDay: reminder.status === 'completed' && reminder.completedDate === reminder.scheduledDate,
      })
    }
    if (reminder.status === 'completed' && reminder.completedDate && reminder.completedDate !== reminder.scheduledDate) {
      const completedIndex = index.get(reminder.completedDate)
      if (completedIndex !== undefined) {
        days[completedIndex].crossDayCompletedReminders.push({
          reminder: { ...reminder },
          displayType: 'completed',
          isPlannedAndCompletedSameDay: false,
        })
      }
    }
    if (reminder.status === 'active' && reminder.scheduledDate < today) {
      overdueReminders.push({
        reminder: { ...reminder },
        displayType: 'overdue',
        isPlannedAndCompletedSameDay: false,
      })
    }
  }

  for (const day of days) {
    day.plannedReminders.sort((a, b) => a.reminder.sortOrder - b.reminder.sortOrder || a.reminder.id.localeCompare(b.reminder.id))
    day.crossDayCompletedReminders.sort((a, b) => (a.reminder.completedActionAt ?? '').localeCompare(b.reminder.completedActionAt ?? '') || a.reminder.id.localeCompare(b.reminder.id))
  }
  overdueReminders.sort((a, b) => a.reminder.scheduledDate.localeCompare(b.reminder.scheduledDate) || a.reminder.sortOrder - b.reminder.sortOrder || a.reminder.id.localeCompare(b.reminder.id))

  return { month: validatedMonth, gridStart, gridEnd, today, overdueReminders, days }
}

function activeProjectById(state: MockState, id: string): ProjectDto {
  const project = state.projects.find((item) => item.id === id && !mockProjectIsTrashed(item, state))
  if (!project) mockFail('NOT_FOUND', 'Project not found')
  return project
}

function activeReminderById(state: MockState, id: string): ReminderDto {
  const reminder = state.reminders.find((item) => item.id === id && !mockReminderIsTrashed(item.id, state))
  if (!reminder) mockFail('NOT_FOUND', 'Reminder not found')
  return reminder
}

async function mockCall<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const state = getMockState()
  const id = () => crypto.randomUUID()
  switch (command) {
    case 'get_clock_context': {
      const today = dateToday()
      return { today, weekStart: monday(today), timeZoneLabel: Intl.DateTimeFormat().resolvedOptions().timeZone } as T
    }
    case 'get_project_tree':
      return mockTreeOrder(state.projects.filter((project) => !mockProjectIsTrashed(project, state))).map((project) => projectDto(project, state)) as T
    case 'get_project_detail':
      return mockProjectDetail(String(args.projectId)) as T
    case 'get_project_progress_month': {
      const month = validateMonth(args.month)
      const project = activeProjectById(state, String(args.projectId))
      return sortedDates(state.progress[project.id]).filter((date) => date.startsWith(month)) as T
    }
    case 'create_project': {
      const title = validateTitle(args.title)
      const parentId = args.parentId ? String(args.parentId) : null
      if (parentId !== null && !state.projects.some((item) => item.id === parentId && !mockProjectIsTrashed(item, state))) {
        mockFail('INVALID_PARENT', 'Parent project does not exist or is in Trash')
      }
      const siblings = state.projects.filter((item) => item.parentId === parentId && !mockProjectIsTrashed(item, state))
      const project: ProjectDto = {
        id: id(),
        parentId,
        title,
        status: 'active',
        completedDate: null,
        canceledDate: null,
        sortOrder: nextOrder(siblings),
        version: 0,
        isExpanded: true,
        recentProgressDates: [],
        progressCount: 0,
        progressedToday: false,
      }
      const nextState: MockState = {
        ...state,
        projects: [...state.projects, project],
        progress: { ...state.progress, [project.id]: [] },
      }
      saveMockState(nextState)
      return projectDto(project, nextState) as T
    }
    case 'rename_project': {
      const title = validateTitle(args.title)
      const project = activeProjectById(state, String(args.projectId))
      checkVersion(args.expectedVersion, project.version)
      const updated: ProjectDto = { ...project, title, version: project.version + 1 }
      const nextState: MockState = {
        ...state,
        projects: state.projects.map((item) => item.id === project.id ? updated : item),
      }
      saveMockState(nextState)
      return projectDto(updated, nextState) as T
    }
    case 'set_project_expanded': {
      const project = activeProjectById(state, String(args.projectId))
      const updated: ProjectDto = { ...project, isExpanded: Boolean(args.isExpanded) }
      const nextState: MockState = {
        ...state,
        projects: state.projects.map((item) => item.id === project.id ? updated : item),
      }
      saveMockState(nextState)
      return projectDto(updated, nextState) as T
    }
    case 'set_all_projects_expanded': {
      const projects = state.projects.map((project) => mockProjectIsTrashed(project, state) ? project : { ...project, isExpanded: Boolean(args.isExpanded) })
      // Commit memory only after persistence succeeds, matching the native transaction.
      const nextState: MockState = { ...state, projects }
      saveMockState(nextState)
      return mockTreeOrder(projects.filter((project) => !mockProjectIsTrashed(project, nextState))).map((project) => projectDto(project, nextState)) as T
    }
    case 'reorder_project_siblings': {
      const parentId = args.parentId ? String(args.parentId) : null
      const orderedIds = Array.isArray(args.orderedIds) ? args.orderedIds.map(String) : []
      const current = state.projects
        .filter((item) => item.parentId === parentId && !mockProjectIsTrashed(item, state))
        .map((item) => item.id)
        .sort()
      const supplied = [...orderedIds].sort()
      if (current.length !== orderedIds.length || current.some((value, idx) => value !== supplied[idx])) {
        mockFail('REORDER_MEMBERSHIP_MISMATCH', 'Reorder list must include all projects in the same level')
      }
      const orderIndex = new Map(orderedIds.map((projectId, idx) => [projectId, (idx + 1) * 1024]))
      const nextState: MockState = {
        ...state,
        projects: state.projects.map((item) => {
          const sortOrder = orderIndex.get(item.id)
          return sortOrder !== undefined ? { ...item, sortOrder, version: item.version + 1 } : item
        }),
      }
      saveMockState(nextState)
      return orderedIds
        .map((projectId) => nextState.projects.find((item) => item.id === projectId)!)
        .map((project) => projectDto(project, nextState)) as T
    }
    case 'move_project': {
      const project = activeProjectById(state, String(args.projectId))
      checkVersion(args.expectedVersion, project.version)
      const targetParentId = args.targetParentId ? String(args.targetParentId) : null
      const activeProjects = state.projects.filter((item) => !mockProjectIsTrashed(item, state))
      const byId = new Map(activeProjects.map((item) => [item.id, item]))
      if (targetParentId !== null) {
        if (!byId.has(targetParentId)) {
          mockFail('INVALID_PARENT', 'Target project does not exist or is in Trash')
        }
        let current: string | null = targetParentId
        const visited = new Set<string>()
        while (current) {
          if (current === project.id) {
            mockFail('INVALID_PARENT', 'Cannot move a project into itself or its descendants')
          }
          if (visited.has(current)) {
            mockFail('DB_ERROR', 'Project tree contains a cycle')
          }
          visited.add(current)
          current = byId.get(current)?.parentId ?? null
        }
      }
      const sortOrder = nextOrder(activeProjects.filter((item) => item.parentId === targetParentId))
      const updated: ProjectDto = { ...project, parentId: targetParentId, sortOrder, version: project.version + 1 }
      const nextState: MockState = {
        ...state,
        projects: state.projects.map((item) => item.id === project.id ? updated : item),
      }
      saveMockState(nextState)
      return projectDto(updated, nextState) as T
    }
    case 'set_project_progress': {
      const project = activeProjectById(state, String(args.projectId))
      checkVersion(args.expectedVersion, project.version)
      const today = dateToday()
      const date = args.date ? validateIsoDate(args.date) : today
      const present = Boolean(args.present)
      const existing = sortedDates(state.progress[project.id])
      let nextDates = existing
      let changed = false
      if (present) {
        if (project.status !== 'active') {
          mockFail('INVALID_STATUS_TRANSITION', 'Cannot log new progress for a completed or canceled project')
        }
        if (date > today) {
          mockFail('FUTURE_DATE_FORBIDDEN', 'Cannot log progress for a future date')
        }
        if (!existing.includes(date)) {
          nextDates = [...existing, date].sort()
          changed = true
        }
      } else if (existing.includes(date)) {
        nextDates = existing.filter((item) => item !== date)
        changed = true
      }
      const updated = changed ? { ...project, version: project.version + 1 } : project
      const nextState: MockState = {
        ...state,
        projects: changed ? state.projects.map((item) => item.id === project.id ? updated : item) : state.projects,
        progress: { ...state.progress, [project.id]: nextDates },
      }
      saveMockState(nextState)
      return projectDto(updated, nextState) as T
    }
    case 'complete_project':
    case 'cancel_project':
    case 'restore_project': {
      const project = activeProjectById(state, String(args.projectId))
      checkVersion(args.expectedVersion, project.version)
      const today = dateToday()
      let updated: ProjectDto
      if (command === 'restore_project') {
        if (project.status === 'active') {
          mockFail('INVALID_STATUS_TRANSITION', 'Project is already active')
        }
        updated = { ...project, status: 'active', completedDate: null, canceledDate: null, version: project.version + 1 }
      } else {
        if (project.status !== 'active') {
          mockFail('INVALID_STATUS_TRANSITION', 'Only active projects can be completed or canceled')
        }
        const dates = sortedDates(state.progress[project.id])
        const latest = dates[dates.length - 1]
        if (latest && latest > today) {
          mockFail('TERMINAL_DATE_BEFORE_PROGRESS', `End date cannot be earlier than the latest progress date (${latest}). Remove later progress entries first.`, { latestProgressDate: latest })
        }
        updated = command === 'complete_project'
          ? { ...project, status: 'completed', completedDate: today, canceledDate: null, version: project.version + 1 }
          : { ...project, status: 'canceled', completedDate: null, canceledDate: today, version: project.version + 1 }
      }
      const nextState: MockState = {
        ...state,
        projects: state.projects.map((item) => item.id === project.id ? updated : item),
      }
      saveMockState(nextState)
      return projectDto(updated, nextState) as T
    }
    case 'update_project_terminal_date': {
      const project = activeProjectById(state, String(args.projectId))
      checkVersion(args.expectedVersion, project.version)
      if (project.status === 'active') {
        mockFail('INVALID_STATUS_TRANSITION', 'Active projects do not have an end date')
      }
      const date = validateIsoDate(args.date)
      const today = dateToday()
      if (date > today) {
        mockFail('FUTURE_DATE_FORBIDDEN', 'End date cannot be in the future')
      }
      const dates = sortedDates(state.progress[project.id])
      const latest = dates[dates.length - 1]
      if (latest && latest > date) {
        mockFail('TERMINAL_DATE_BEFORE_PROGRESS', `End date cannot be earlier than the latest progress date (${latest}). Remove later progress entries first.`, { latestProgressDate: latest })
      }
      const updated: ProjectDto = project.status === 'completed'
        ? { ...project, completedDate: date, version: project.version + 1 }
        : { ...project, canceledDate: date, version: project.version + 1 }
      const nextState: MockState = {
        ...state,
        projects: state.projects.map((item) => item.id === project.id ? updated : item),
      }
      saveMockState(nextState)
      return projectDto(updated, nextState) as T
    }
    case 'preview_project_trash': {
      const root = activeProjectById(state, String(args.projectId))
      const activeNodeCount = mockProjectSubtree(root.id, state).filter((item) => !mockProjectIsTrashed(item, state)).length
      return { activeNodeCount } as T
    }
    case 'trash_project': {
      const root = activeProjectById(state, String(args.projectId))
      const subtree = mockProjectSubtree(root.id, state)
      const activeIds = subtree.filter((item) => !mockProjectIsTrashed(item, state)).map((item) => item.id)
      const activeSet = new Set(activeIds)
      const entry: TrashEntryDto = {
        id: id(),
        kind: 'project',
        rootEntityId: root.id,
        titleSnapshot: root.title,
        deletedAt: new Date().toISOString(),
        affectedCountAtDelete: activeIds.length,
        currentDescendantCount: subtree.length,
      }
      const nextState: MockState = {
        ...state,
        projects: state.projects.map((item) => activeSet.has(item.id) ? { ...item, version: item.version + 1 } : item),
        trash: [...state.trash, entry],
        trashBatches: { ...(state.trashBatches ?? {}), [entry.id]: activeIds },
      }
      saveMockState(nextState)
      return entry as T
    }
    case 'permanently_delete_trash_entry': {
      const entry = state.trash.find((item) => item.id === String(args.entryId))
      if (!entry) mockFail('NOT_FOUND', 'Trash entry not found')
      if (entry.kind === 'project') {
        const ids = new Set(mockProjectSubtree(entry.rootEntityId, state).map((project) => project.id))
        const removedTrashIds = new Set(
          state.trash
            .filter((item) => item.id === entry.id || (item.kind === 'project' && ids.has(item.rootEntityId)))
            .map((item) => item.id),
        )
        const nextProgress = { ...state.progress }
        for (const projectId of ids) delete nextProgress[projectId]
        const nextBatches = state.trashBatches ? { ...state.trashBatches } : undefined
        if (nextBatches) {
          for (const trashId of removedTrashIds) delete nextBatches[trashId]
        }
        const nextState: MockState = {
          ...state,
          projects: state.projects.filter((project) => !ids.has(project.id)),
          progress: nextProgress,
          trash: state.trash.filter((item) => !removedTrashIds.has(item.id)),
          ...(nextBatches && Object.keys(nextBatches).length > 0 ? { trashBatches: nextBatches } : {}),
        }
        if (!nextBatches || Object.keys(nextBatches).length === 0) delete nextState.trashBatches
        saveMockState(nextState)
        return { deletedProjectCount: ids.size, deletedReminderCount: 0 } as T
      }
      const existed = state.reminders.some((reminder) => reminder.id === entry.rootEntityId)
      const nextState: MockState = {
        ...state,
        reminders: state.reminders.filter((reminder) => reminder.id !== entry.rootEntityId),
        trash: state.trash.filter((item) => item.id !== entry.id),
      }
      saveMockState(nextState)
      return { deletedProjectCount: 0, deletedReminderCount: existed ? 1 : 0 } as T
    }
    case 'empty_trash': {
      const kind = String(args.kind)
      if (kind !== 'project' && kind !== 'reminder') {
        mockFail('INVALID_STATUS_TRANSITION', 'Invalid trash category')
      }
      const entries = state.trash.filter((entry) => entry.kind === kind)
      if (kind === 'project') {
        const deletedIds = new Set<string>()
        for (const entry of entries) {
          for (const project of mockProjectSubtree(entry.rootEntityId, state)) {
            deletedIds.add(project.id)
          }
        }
        const nextProgress = { ...state.progress }
        for (const projectId of deletedIds) delete nextProgress[projectId]
        const removedTrashIds = new Set(entries.map((entry) => entry.id))
        const nextBatches = state.trashBatches ? { ...state.trashBatches } : undefined
        if (nextBatches) {
          for (const trashId of removedTrashIds) delete nextBatches[trashId]
        }
        const nextState: MockState = {
          ...state,
          projects: state.projects.filter((project) => !deletedIds.has(project.id)),
          progress: nextProgress,
          trash: state.trash.filter((entry) => entry.kind !== 'project'),
          ...(nextBatches && Object.keys(nextBatches).length > 0 ? { trashBatches: nextBatches } : {}),
        }
        if (!nextBatches || Object.keys(nextBatches).length === 0) delete nextState.trashBatches
        saveMockState(nextState)
        return { deletedProjectCount: deletedIds.size, deletedReminderCount: 0 } as T
      }
      const reminderIds = new Set(entries.map((entry) => entry.rootEntityId))
      const deletedReminderCount = state.reminders.filter((reminder) => reminderIds.has(reminder.id)).length
      const nextState: MockState = {
        ...state,
        reminders: state.reminders.filter((reminder) => !reminderIds.has(reminder.id)),
        trash: state.trash.filter((entry) => entry.kind !== 'reminder'),
      }
      saveMockState(nextState)
      return { deletedProjectCount: 0, deletedReminderCount } as T
    }
    case 'get_daily_week':
      return mockDaily(String(args.weekStart)) as T
    case 'get_month_calendar':
      return mockMonthCalendar(String(args.month)) as T
    case 'get_reminder':
      return { ...activeReminderById(state, String(args.reminderId)) } as T
    case 'create_reminder': {
      const title = validateTitle(args.title)
      const scheduledDate = validateIsoDate(args.scheduledDate)
      if (scheduledDate < dateToday()) {
        mockFail('SCHEDULE_IN_PAST', 'Scheduled date must be today or in the future')
      }
      const siblings = state.reminders.filter((item) => item.scheduledDate === scheduledDate && !mockReminderIsTrashed(item.id, state))
      const reminder: ReminderDto = {
        id: id(),
        title,
        scheduledDate,
        status: 'active',
        completedDate: null,
        completedActionAt: null,
        canceledDate: null,
        sortOrder: nextOrder(siblings),
        version: 0,
      }
      const nextState: MockState = {
        ...state,
        reminders: [...state.reminders, reminder],
      }
      saveMockState(nextState)
      return { ...reminder } as T
    }
    case 'rename_reminder': {
      const title = validateTitle(args.title)
      const reminder = activeReminderById(state, String(args.reminderId))
      checkVersion(args.expectedVersion, reminder.version)
      const updated: ReminderDto = { ...reminder, title, version: reminder.version + 1 }
      const nextState: MockState = {
        ...state,
        reminders: state.reminders.map((item) => item.id === reminder.id ? updated : item),
      }
      saveMockState(nextState)
      return { ...updated } as T
    }
    case 'update_reminder_schedule': {
      const reminder = activeReminderById(state, String(args.reminderId))
      checkVersion(args.expectedVersion, reminder.version)
      const scheduledDate = validateIsoDate(args.scheduledDate)
      if (scheduledDate < dateToday()) {
        mockFail('SCHEDULE_IN_PAST', 'Scheduled date must be today or in the future')
      }
      const sortOrder = nextOrder(state.reminders.filter((item) => item.scheduledDate === scheduledDate && !mockReminderIsTrashed(item.id, state)))
      const updated: ReminderDto = { ...reminder, scheduledDate, sortOrder, version: reminder.version + 1 }
      const nextState: MockState = {
        ...state,
        reminders: state.reminders.map((item) => item.id === reminder.id ? updated : item),
      }
      saveMockState(nextState)
      return { ...updated } as T
    }
    case 'reorder_reminders': {
      const scheduledDate = validateIsoDate(args.scheduledDate)
      const orderedIds = Array.isArray(args.orderedIds) ? args.orderedIds.map(String) : []
      const current = state.reminders
        .filter((item) => item.scheduledDate === scheduledDate && !mockReminderIsTrashed(item.id, state))
        .map((item) => item.id)
        .sort()
      const supplied = [...orderedIds].sort()
      if (current.length !== orderedIds.length || current.some((value, idx) => value !== supplied[idx])) {
        mockFail('REORDER_MEMBERSHIP_MISMATCH', 'Reorder list must include all reminders for that scheduled date')
      }
      const orderIndex = new Map(orderedIds.map((reminderId, idx) => [reminderId, (idx + 1) * 1024]))
      const nextState: MockState = {
        ...state,
        reminders: state.reminders.map((item) => {
          const sortOrder = orderIndex.get(item.id)
          return sortOrder !== undefined ? { ...item, sortOrder, version: item.version + 1 } : item
        }),
      }
      saveMockState(nextState)
      return orderedIds.map((reminderId) => ({ ...nextState.reminders.find((item) => item.id === reminderId)! })) as T
    }
    case 'complete_reminder':
    case 'cancel_reminder':
    case 'restore_reminder': {
      const reminder = activeReminderById(state, String(args.reminderId))
      checkVersion(args.expectedVersion, reminder.version)
      const today = dateToday()
      let updated: ReminderDto
      if (command === 'restore_reminder') {
        if (reminder.status === 'active') {
          mockFail('INVALID_STATUS_TRANSITION', 'Reminder is already active')
        }
        updated = { ...reminder, status: 'active', completedDate: null, completedActionAt: null, canceledDate: null, version: reminder.version + 1 }
      } else if (command === 'complete_reminder') {
        if (reminder.status !== 'active') {
          mockFail('INVALID_STATUS_TRANSITION', 'Only active reminders can be completed')
        }
        updated = { ...reminder, status: 'completed', completedDate: today, completedActionAt: new Date().toISOString(), canceledDate: null, version: reminder.version + 1 }
      } else {
        if (reminder.status !== 'active') {
          mockFail('INVALID_STATUS_TRANSITION', 'Only active reminders can be canceled')
        }
        updated = { ...reminder, status: 'canceled', completedDate: null, completedActionAt: null, canceledDate: today, version: reminder.version + 1 }
      }
      const nextState: MockState = {
        ...state,
        reminders: state.reminders.map((item) => item.id === reminder.id ? updated : item),
      }
      saveMockState(nextState)
      return { ...updated } as T
    }
    case 'update_reminder_completed_date': {
      const reminder = activeReminderById(state, String(args.reminderId))
      checkVersion(args.expectedVersion, reminder.version)
      if (reminder.status !== 'completed') {
        mockFail('INVALID_STATUS_TRANSITION', 'Only completed reminders can update their completed date')
      }
      const date = validateIsoDate(args.date)
      if (date > dateToday()) {
        mockFail('FUTURE_DATE_FORBIDDEN', 'Completed date cannot be in the future')
      }
      const updated: ReminderDto = { ...reminder, completedDate: date, version: reminder.version + 1 }
      const nextState: MockState = {
        ...state,
        reminders: state.reminders.map((item) => item.id === reminder.id ? updated : item),
      }
      saveMockState(nextState)
      return { ...updated } as T
    }
    case 'trash_reminder': {
      const reminder = activeReminderById(state, String(args.reminderId))
      const entry: TrashEntryDto = {
        id: id(),
        kind: 'reminder',
        rootEntityId: reminder.id,
        titleSnapshot: reminder.title,
        deletedAt: new Date().toISOString(),
        affectedCountAtDelete: 1,
        currentDescendantCount: null,
      }
      const nextState: MockState = {
        ...state,
        reminders: state.reminders.map((item) => item.id === reminder.id ? { ...item, version: item.version + 1 } : item),
        trash: [...state.trash, entry],
      }
      saveMockState(nextState)
      return entry as T
    }
    case 'list_trash': {
      const kind = String(args.kind)
      if (kind !== 'project' && kind !== 'reminder') {
        mockFail('INVALID_STATUS_TRANSITION', 'Invalid trash category')
      }
      return state.trash
        .filter((entry) => entry.kind === kind)
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || b.id.localeCompare(a.id))
        .map((entry) => ({
          ...entry,
          currentDescendantCount: kind === 'project' ? mockProjectSubtree(entry.rootEntityId, state).length : null,
        })) as T
    }
    case 'restore_trash_entry': {
      const entry = state.trash.find((item) => item.id === String(args.entryId))
      if (!entry) mockFail('NOT_FOUND', 'Trash entry not found')
      if (entry.kind === 'project') {
        const root = state.projects.find((item) => item.id === entry.rootEntityId)
        if (root?.parentId) {
          const parent = state.projects.find((item) => item.id === root.parentId)
          if (parent && mockProjectIsTrashed(parent, state)) {
            mockFail('PARENT_IN_TRASH', 'Restore the parent project first')
          }
        }
        const batchMembers = state.trashBatches?.[entry.id]
        const restoredIds = new Set(
          batchMembers ?? mockProjectSubtree(entry.rootEntityId, state).map((item) => item.id),
        )
        const nextBatches = state.trashBatches ? { ...state.trashBatches } : undefined
        if (nextBatches) delete nextBatches[entry.id]
        const nextState: MockState = {
          ...state,
          projects: state.projects.map((item) => restoredIds.has(item.id) ? { ...item, version: item.version + 1 } : item),
          trash: state.trash.filter((item) => item.id !== entry.id),
          ...(nextBatches && Object.keys(nextBatches).length > 0 ? { trashBatches: nextBatches } : {}),
        }
        if (!nextBatches || Object.keys(nextBatches).length === 0) delete nextState.trashBatches
        saveMockState(nextState)
        return { kind: 'project', restoredCount: restoredIds.size } as T
      }
      const existed = state.reminders.some((item) => item.id === entry.rootEntityId)
      const nextState: MockState = {
        ...state,
        reminders: state.reminders.map((item) => item.id === entry.rootEntityId ? { ...item, version: item.version + 1 } : item),
        trash: state.trash.filter((item) => item.id !== entry.id),
      }
      saveMockState(nextState)
      return { kind: 'reminder', restoredCount: existed ? 1 : 0 } as T
    }
    case 'get_app_settings':
      return { themeMode: state.themeMode } as T
    case 'set_theme_mode': {
      const mode = String(args.mode)
      if (!['light', 'dark', 'system'].includes(mode)) {
        mockFail('INVALID_STATUS_TRANSITION', 'Invalid theme mode')
      }
      const nextState: MockState = { ...state, themeMode: mode as ThemeMode }
      saveMockState(nextState)
      return { themeMode: nextState.themeMode } as T
    }
    default:
      mockFail('DB_ERROR', `Unknown command: ${command}`)
  }
}

function normalizeError(error: unknown): Error & ApiError {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    const apiError = error as ApiError
    return error instanceof Error
      ? Object.assign(error, { code: String(apiError.code), ...(apiError.details ? { details: apiError.details } : {}) })
      : createApiError(String(apiError.code), String(apiError.message), apiError.details)
  }
  return createApiError('DB_ERROR', error instanceof Error ? error.message : String(error))
}

export async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!tauriAvailable) {
    try {
      return await mockCall<T>(command, args)
    } catch (error) {
      throw normalizeError(error)
    }
  }
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw normalizeError(error)
  }
}

export const api = {
  getClockContext: () => call<ClockContext>('get_clock_context'),
  getProjectTree: () => call<ProjectDto[]>('get_project_tree'),
  getProjectDetail: (projectId: string) => call<ProjectDetailDto>('get_project_detail', { projectId }),
  getProjectProgressMonth: (projectId: string, month: string) => call<string[]>('get_project_progress_month', { projectId, month }),
  createProject: (title: string, parentId?: string | null) => call<ProjectDto>('create_project', { title, parentId }),
  renameProject: (projectId: string, title: string, expectedVersion: number) => call<ProjectDto>('rename_project', { projectId, title, expectedVersion }),
  setProjectExpanded: (projectId: string, isExpanded: boolean) => call<ProjectDto>('set_project_expanded', { projectId, isExpanded }),
  setAllProjectsExpanded: (isExpanded: boolean) => call<ProjectDto[]>('set_all_projects_expanded', { isExpanded }),
  reorderProjectSiblings: (parentId: string | null, orderedIds: string[]) => call<ProjectDto[]>('reorder_project_siblings', { parentId, orderedIds }),
  moveProject: (projectId: string, targetParentId: string | null, expectedVersion: number) => call<ProjectDto>('move_project', { projectId, targetParentId, expectedVersion }),
  setProjectProgress: (projectId: string, date: string | undefined, present: boolean, expectedVersion: number) => call<ProjectDto>('set_project_progress', { projectId, date, present, expectedVersion }),
  completeProject: (projectId: string, expectedVersion: number) => call<ProjectDto>('complete_project', { projectId, expectedVersion }),
  cancelProject: (projectId: string, expectedVersion: number) => call<ProjectDto>('cancel_project', { projectId, expectedVersion }),
  restoreProject: (projectId: string, expectedVersion: number) => call<ProjectDto>('restore_project', { projectId, expectedVersion }),
  updateProjectTerminalDate: (projectId: string, date: string, expectedVersion: number) => call<ProjectDto>('update_project_terminal_date', { projectId, date, expectedVersion }),
  getReminder: (reminderId: string) => call<ReminderDto>('get_reminder', { reminderId }),
  createReminder: (title: string, scheduledDate: string) => call<ReminderDto>('create_reminder', { title, scheduledDate }),
  renameReminder: (reminderId: string, title: string, expectedVersion: number) => call<ReminderDto>('rename_reminder', { reminderId, title, expectedVersion }),
  updateReminderSchedule: (reminderId: string, scheduledDate: string, expectedVersion: number) => call<ReminderDto>('update_reminder_schedule', { reminderId, scheduledDate, expectedVersion }),
  completeReminder: (reminderId: string, expectedVersion: number) => call<ReminderDto>('complete_reminder', { reminderId, expectedVersion }),
  cancelReminder: (reminderId: string, expectedVersion: number) => call<ReminderDto>('cancel_reminder', { reminderId, expectedVersion }),
  restoreReminder: (reminderId: string, expectedVersion: number) => call<ReminderDto>('restore_reminder', { reminderId, expectedVersion }),
  updateReminderCompletedDate: (reminderId: string, date: string, expectedVersion: number) => call<ReminderDto>('update_reminder_completed_date', { reminderId, date, expectedVersion }),
  reorderReminders: (scheduledDate: string, orderedIds: string[]) => call<ReminderDto[]>('reorder_reminders', { scheduledDate, orderedIds }),
  getDailyWeek: (weekStart: string) => call<DailyWeekDto>('get_daily_week', { weekStart }),
  getMonthCalendar: (month: string) => call<MonthCalendarDto>('get_month_calendar', { month }),
  previewProjectTrash: (projectId: string) => call<{ activeNodeCount: number }>('preview_project_trash', { projectId }),
  trashProject: (projectId: string) => call<TrashEntryDto>('trash_project', { projectId }),
  trashReminder: (reminderId: string) => call<TrashEntryDto>('trash_reminder', { reminderId }),
  listTrash: (kind: 'project' | 'reminder') => call<TrashEntryDto[]>('list_trash', { kind }),
  restoreTrashEntry: (entryId: string) => call<{ kind: string; restoredCount: number }>('restore_trash_entry', { entryId }),
  permanentlyDeleteTrashEntry: (entryId: string) => call<{ deletedProjectCount: number; deletedReminderCount: number }>('permanently_delete_trash_entry', { entryId }),
  emptyTrash: (kind: 'project' | 'reminder') => call<{ deletedProjectCount: number; deletedReminderCount: number }>('empty_trash', { kind }),
  getAppSettings: () => call<ThemeSettings>('get_app_settings'),
  setThemeMode: (mode: ThemeMode) => call<ThemeSettings>('set_theme_mode', { mode }),
}
