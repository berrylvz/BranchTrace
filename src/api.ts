import { invoke } from '@tauri-apps/api/core'
import type {
  ApiError,
  ClockContext,
  DailyWeekDto,
  ProjectDetailDto,
  ProjectDto,
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

function saveMockState() {
  if (mockState) localStorage.setItem('branchtrace-mock', JSON.stringify(mockState))
}

function nextOrder(items: { sortOrder: number }[]) {
  return (items.reduce((max, item) => Math.max(max, item.sortOrder), 0) || 0) + 1024
}

function projectDto(project: ProjectDto): ProjectDto {
  const progress = getMockState().progress[project.id] ?? []
  const today = dateToday()
  return {
    ...project,
    recentProgressDates: progress.slice(-3),
    progressCount: progress.length,
    progressedToday: progress.includes(today),
  }
}

function mockProjectDetail(id: string): ProjectDetailDto {
  const state = getMockState()
  const project = state.projects.find((item) => item.id === id)
  if (!project) throw new Error('项目不存在')
  const byId = new Map(state.projects.map((item) => [item.id, item]))
  const path: string[] = []
  let parentId = project.parentId
  while (parentId) {
    const parent = byId.get(parentId)
    if (!parent) break
    path.unshift(parent.title)
    parentId = parent.parentId
  }
  return { ...projectDto(project), parentPath: path, progressDates: state.progress[id] ?? [] }
}

function mockDaily(weekStart: string): DailyWeekDto {
  const state = getMockState()
  const days: DailyWeekDto['days'] = Array.from({ length: 7 }, (_, offset) => ({
    date: addDays(weekStart, offset),
    completedProjects: [],
    progressedProjects: [],
    plannedReminders: [],
    overdueReminders: [],
    crossDayCompletedReminders: [],
  }))
  const index = new Map(days.map((day, position) => [day.date, position]))
  const byId = new Map(state.projects.map((item) => [item.id, item]))
  const parentPath = (project: ProjectDto) => {
    const path: string[] = []
    let parentId = project.parentId
    while (parentId) {
      const parent = byId.get(parentId)
      if (!parent) break
      path.unshift(parent.title)
      parentId = parent.parentId
    }
    return path
  }
  for (const project of state.projects) {
    if (mockProjectIsTrashed(project, state)) continue
    const base = { projectId: project.id, title: project.title, parentPath: parentPath(project), shortId: null, status: project.status }
    if (project.status === 'completed' && project.completedDate && index.has(project.completedDate)) {
      const day = days[index.get(project.completedDate)!]
      day.completedProjects.push({ ...base, progressedSameDay: (state.progress[project.id] ?? []).includes(project.completedDate) })
    }
    for (const progressDate of state.progress[project.id] ?? []) {
      const dayIndex = index.get(progressDate)
      if (dayIndex === undefined) continue
      if (!(project.status === 'completed' && project.completedDate === progressDate)) {
        days[dayIndex].progressedProjects.push(base)
      }
    }
  }
  const today = dateToday()
  for (const reminder of state.reminders) {
    if (state.trash.some((entry) => entry.kind === 'reminder' && entry.rootEntityId === reminder.id)) continue
    const plannedIndex = index.get(reminder.scheduledDate)
    const planned = { reminder, displayType: 'planned' as const, isPlannedAndCompletedSameDay: reminder.status === 'completed' && reminder.completedDate === reminder.scheduledDate }
    if (plannedIndex !== undefined) days[plannedIndex].plannedReminders.push(planned)
    if (reminder.status === 'completed' && reminder.completedDate && reminder.completedDate !== reminder.scheduledDate) {
      const completedIndex = index.get(reminder.completedDate)
      if (completedIndex !== undefined) days[completedIndex].crossDayCompletedReminders.push({ reminder, displayType: 'completed', isPlannedAndCompletedSameDay: false })
    }
    if (reminder.status === 'active' && reminder.scheduledDate < today && index.has(today)) {
      days[index.get(today)!].overdueReminders.push({ reminder, displayType: 'overdue', isPlannedAndCompletedSameDay: false })
    }
  }
  return { weekStart, today, days }
}

function mockProjectIsTrashed(project: ProjectDto, state: MockState) {
  let current: ProjectDto | undefined = project
  while (current) {
    if (state.trash.some((entry) => entry.kind === 'project' && entry.rootEntityId === current?.id)) return true
    current = current.parentId ? state.projects.find((item) => item.id === current?.parentId) : undefined
  }
  return false
}

function mockProjectSubtree(rootId: string, state: MockState) {
  const result: ProjectDto[] = []
  const visit = (parentId: string) => {
    const children = state.projects.filter((item) => item.parentId === parentId)
    for (const child of children) { result.push(child); visit(child.id) }
  }
  const root = state.projects.find((item) => item.id === rootId)
  if (root) { result.push(root); visit(root.id) }
  return result
}

async function mockCall<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const state = getMockState()
  const fail = (message: string): never => { throw new Error(message) }
  const id = () => crypto.randomUUID()
  switch (command) {
    case 'get_clock_context': {
      const today = dateToday()
      return { today, weekStart: monday(today), timeZoneLabel: Intl.DateTimeFormat().resolvedOptions().timeZone } as T
    }
    case 'get_project_tree':
      return state.projects.filter((project) => !mockProjectIsTrashed(project, state)).map(projectDto) as T
    case 'get_project_detail':
      return mockProjectDetail(String(args.projectId)) as T
    case 'get_project_progress_month':
      return (state.progress[String(args.projectId)] ?? []).filter((date) => date.startsWith(String(args.month))) as T
    case 'create_project': {
      const title = String(args.title ?? '').trim()
      if (!title) fail('名称不能为空')
      const parentId = args.parentId ? String(args.parentId) : null
      const project: ProjectDto = { id: id(), parentId, title, status: 'active', completedDate: null, canceledDate: null, sortOrder: nextOrder(state.projects.filter((item) => item.parentId === parentId)), version: 0, isExpanded: true, recentProgressDates: [], progressCount: 0, progressedToday: false }
      state.projects.push(project)
      state.progress[project.id] = []
      saveMockState()
      return project as T
    }
    case 'rename_project': {
      const project = state.projects.find((item) => item.id === String(args.projectId))
      if (!project) throw new Error('项目不存在')
      if (project.version !== Number(args.expectedVersion)) fail('数据已变化，请刷新')
      project.title = String(args.title ?? '').trim()
      project.version += 1
      saveMockState()
      return projectDto(project) as T
    }
    case 'set_project_expanded': {
      const project = state.projects.find((item) => item.id === String(args.projectId))
      if (!project) throw new Error('项目不存在')
      project.isExpanded = Boolean(args.isExpanded)
      saveMockState()
      return projectDto(project) as T
    }
    case 'reorder_project_siblings': {
      const parentId = args.parentId ? String(args.parentId) : null
      const orderedIds = Array.isArray(args.orderedIds) ? args.orderedIds.map(String) : []
      orderedIds.forEach((projectId, index) => {
        const project = state.projects.find((item) => item.id === projectId && item.parentId === parentId)
        if (project) { project.sortOrder = (index + 1) * 1024; project.version += 1 }
      })
      saveMockState()
      return state.projects.filter((project) => project.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder).map(projectDto) as T
    }
    case 'set_project_progress': {
      const project = state.projects.find((item) => item.id === String(args.projectId))
      if (!project) throw new Error('项目不存在')
      if (project.version !== Number(args.expectedVersion)) fail('数据已变化，请刷新')
      const date = args.date ? String(args.date) : dateToday()
      const dates = state.progress[project.id] ?? []
      const present = Boolean(args.present)
      if (present && !dates.includes(date)) dates.push(date)
      if (!present) state.progress[project.id] = dates.filter((item) => item !== date)
      project.version += 1
      saveMockState()
      return projectDto(project) as T
    }
    case 'complete_project':
    case 'cancel_project':
    case 'restore_project': {
      const project = state.projects.find((item) => item.id === String(args.projectId))
      if (!project) throw new Error('项目不存在')
      if (project.version !== Number(args.expectedVersion)) fail('数据已变化，请刷新')
      if (command === 'restore_project') { project.status = 'active'; project.completedDate = null; project.canceledDate = null }
      else if (command === 'complete_project') { project.status = 'completed'; project.completedDate = dateToday(); project.canceledDate = null }
      else { project.status = 'canceled'; project.canceledDate = dateToday(); project.completedDate = null }
      project.version += 1
      saveMockState()
      return projectDto(project) as T
    }
    case 'update_project_terminal_date': {
      const project = state.projects.find((item) => item.id === String(args.projectId))
      if (!project) throw new Error('项目不存在')
      if (project.version !== Number(args.expectedVersion)) fail('数据已变化，请刷新')
      const date = String(args.date)
      if (project.status === 'completed') project.completedDate = date
      if (project.status === 'canceled') project.canceledDate = date
      project.version += 1
      saveMockState()
      return projectDto(project) as T
    }
    case 'move_project': {
      const project = state.projects.find((item) => item.id === String(args.projectId))
      if (!project) throw new Error('项目不存在')
      project.parentId = args.targetParentId ? String(args.targetParentId) : null
      project.sortOrder = nextOrder(state.projects.filter((item) => item.parentId === project.parentId && item.id !== project.id))
      project.version += 1
      saveMockState()
      return projectDto(project) as T
    }
    case 'preview_project_trash': {
      const root = state.projects.find((item) => item.id === String(args.projectId))
      if (!root) throw new Error('项目不存在')
      return { activeNodeCount: mockProjectSubtree(root.id, state).length, alreadyTrashed: mockProjectIsTrashed(root, state) } as T
    }
    case 'trash_project': {
      const root = state.projects.find((item) => item.id === String(args.projectId))
      if (!root) throw new Error('项目不存在')
      const subtree = mockProjectSubtree(root.id, state)
      const entry: TrashEntryDto = { id: id(), kind: 'project', rootEntityId: root.id, titleSnapshot: root.title, deletedAt: new Date().toISOString(), affectedCountAtDelete: subtree.length, currentDescendantCount: subtree.length }
      state.trash.push(entry)
      saveMockState()
      return entry as T
    }
    case 'permanently_delete_trash_entry': {
      const entryIndex = state.trash.findIndex((entry) => entry.id === String(args.entryId))
      if (entryIndex < 0) throw new Error('回收站条目不存在')
      const [entry] = state.trash.splice(entryIndex, 1)
      if (entry.kind === 'project') {
        const ids = new Set(mockProjectSubtree(entry.rootEntityId, state).map((project) => project.id))
        state.projects = state.projects.filter((project) => !ids.has(project.id))
        for (const projectId of ids) delete state.progress[projectId]
      } else {
        state.reminders = state.reminders.filter((reminder) => reminder.id !== entry.rootEntityId)
      }
      saveMockState()
      return { deletedProjectCount: entry.kind === 'project' ? entry.affectedCountAtDelete : 0, deletedReminderCount: entry.kind === 'reminder' ? 1 : 0 } as T
    }
    case 'empty_trash': {
      const entries = state.trash.filter((entry) => entry.kind === args.kind)
      for (const entry of entries) {
        if (entry.kind === 'project') {
          const ids = new Set(mockProjectSubtree(entry.rootEntityId, state).map((project) => project.id))
          state.projects = state.projects.filter((project) => !ids.has(project.id))
          for (const projectId of ids) delete state.progress[projectId]
        } else {
          state.reminders = state.reminders.filter((reminder) => reminder.id !== entry.rootEntityId)
        }
      }
      state.trash = state.trash.filter((entry) => entry.kind !== args.kind)
      saveMockState()
      return { deletedProjectCount: entries.filter((entry) => entry.kind === 'project').reduce((sum, entry) => sum + entry.affectedCountAtDelete, 0), deletedReminderCount: entries.filter((entry) => entry.kind === 'reminder').length } as T
    }
    case 'get_daily_week':
      return mockDaily(String(args.weekStart)) as T
    case 'get_reminder': {
      const reminder = state.reminders.find((item) => item.id === String(args.reminderId))
      if (!reminder) throw new Error('提醒不存在')
      return reminder as T
    }
    case 'create_reminder': {
      const reminder: ReminderDto = { id: id(), title: String(args.title ?? '').trim(), scheduledDate: String(args.scheduledDate), status: 'active', completedDate: null, completedActionAt: null, canceledDate: null, sortOrder: nextOrder(state.reminders.filter((item) => item.scheduledDate === String(args.scheduledDate))), version: 0 }
      state.reminders.push(reminder)
      saveMockState()
      return reminder as T
    }
    case 'rename_reminder': {
      const reminder = state.reminders.find((item) => item.id === String(args.reminderId))
      if (!reminder) throw new Error('提醒不存在')
      reminder.title = String(args.title ?? '').trim(); reminder.version += 1; saveMockState(); return reminder as T
    }
    case 'update_reminder_schedule': {
      const reminder = state.reminders.find((item) => item.id === String(args.reminderId))
      if (!reminder) throw new Error('提醒不存在')
      reminder.scheduledDate = String(args.scheduledDate); reminder.version += 1; saveMockState(); return reminder as T
    }
    case 'reorder_reminders': {
      const scheduledDate = String(args.scheduledDate)
      const orderedIds = Array.isArray(args.orderedIds) ? args.orderedIds.map(String) : []
      orderedIds.forEach((reminderId, index) => {
        const reminder = state.reminders.find((item) => item.id === reminderId && item.scheduledDate === scheduledDate)
        if (reminder) { reminder.sortOrder = (index + 1) * 1024; reminder.version += 1 }
      })
      saveMockState()
      return state.reminders.filter((reminder) => reminder.scheduledDate === scheduledDate).sort((a, b) => a.sortOrder - b.sortOrder).map((reminder) => ({ ...reminder })) as T
    }
    case 'complete_reminder':
    case 'cancel_reminder':
    case 'restore_reminder': {
      const reminder = state.reminders.find((item) => item.id === String(args.reminderId))
      if (!reminder) throw new Error('提醒不存在')
      if (command === 'restore_reminder') { reminder.status = 'active'; reminder.completedDate = null; reminder.completedActionAt = null; reminder.canceledDate = null }
      else if (command === 'complete_reminder') { reminder.status = 'completed'; reminder.completedDate = dateToday(); reminder.completedActionAt = new Date().toISOString() }
      else { reminder.status = 'canceled'; reminder.canceledDate = dateToday(); reminder.completedDate = null; reminder.completedActionAt = null }
      reminder.version += 1; saveMockState(); return reminder as T
    }
    case 'update_reminder_completed_date': {
      const reminder = state.reminders.find((item) => item.id === String(args.reminderId))
      if (!reminder) throw new Error('提醒不存在')
      if (reminder.version !== Number(args.expectedVersion)) fail('数据已变化，请刷新')
      reminder.completedDate = String(args.completedDate)
      reminder.completedActionAt = new Date().toISOString()
      reminder.version += 1
      saveMockState()
      return reminder as T
    }
    case 'trash_reminder': {
      const reminder = state.reminders.find((item) => item.id === String(args.reminderId))
      if (!reminder) throw new Error('提醒不存在')
      const entry: TrashEntryDto = { id: id(), kind: 'reminder', rootEntityId: reminder.id, titleSnapshot: reminder.title, deletedAt: new Date().toISOString(), affectedCountAtDelete: 1, currentDescendantCount: null }
      state.trash.push(entry); saveMockState(); return entry as T
    }
    case 'list_trash':
      return state.trash.filter((entry) => entry.kind === args.kind) as T
    case 'restore_trash_entry': {
      const entryIndex = state.trash.findIndex((entry) => entry.id === String(args.entryId))
      if (entryIndex < 0) fail('回收站条目不存在')
      const [entry] = state.trash.splice(entryIndex, 1); saveMockState(); return { kind: entry.kind, restoredCount: entry.affectedCountAtDelete } as T
    }
    case 'get_app_settings': return { themeMode: state.themeMode } as T
    case 'set_theme_mode': state.themeMode = String(args.mode) as ThemeMode; saveMockState(); return { themeMode: state.themeMode } as T
    default:
      return {} as T
  }
}

function normalizeError(error: unknown): ApiError {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) return error as ApiError
  return { code: 'DB_ERROR', message: error instanceof Error ? error.message : String(error) }
}

export async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!tauriAvailable) return mockCall<T>(command, args)
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
