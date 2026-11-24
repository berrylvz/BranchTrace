import { createApiError } from '../api-error.ts'
import type { ProjectDto, ReminderDto, ThemeMode, TrashEntryDto } from '../types'
import { todayIsoDate } from '../ui-format.ts'
import { createDemoMockState } from './demo.ts'

export interface MockState {
  projects: ProjectDto[]
  progress: Record<string, string[]>
  reminders: ReminderDto[]
  trash: TrashEntryDto[]
  trashBatches?: Record<string, string[]>
  themeMode: ThemeMode
}

export interface MockStore {
  getState: () => MockState
  saveState: (next: MockState) => void
  updateProject: (state: MockState, projectId: string, updated: ProjectDto) => MockState
  updateReminder: (state: MockState, reminderId: string, updated: ReminderDto) => MockState
}

export type MockCommandHandler = (
  store: MockStore,
  state: MockState,
  args: Record<string, unknown>,
) => unknown

const mockDefault = (): MockState => createDemoMockState()

export function createMockStore(): MockStore {
  let cached: MockState | null = null

  const getState = (): MockState => {
    if (cached) return cached
    try {
      const saved = localStorage.getItem('branchtrace-mock')
      cached = saved ? JSON.parse(saved) as MockState : mockDefault()
    } catch {
      cached = mockDefault()
    }
    return cached
  }

  const saveState = (next: MockState) => {
    // Commit in-memory cache only after persistence succeeds, matching native transaction rollback.
    localStorage.setItem('branchtrace-mock', JSON.stringify(next))
    cached = next
  }

  const updateProject = (state: MockState, projectId: string, updated: ProjectDto): MockState => {
    const nextState: MockState = {
      ...state,
      projects: state.projects.map((item) => item.id === projectId ? updated : item),
    }
    saveState(nextState)
    return nextState
  }

  const updateReminder = (state: MockState, reminderId: string, updated: ReminderDto): MockState => {
    const nextState: MockState = {
      ...state,
      reminders: state.reminders.map((item) => item.id === reminderId ? updated : item),
    }
    saveState(nextState)
    return nextState
  }

  return { getState, saveState, updateProject, updateReminder }
}

export function mockFail(code: string, message: string, details?: Record<string, unknown>): never {
  throw createApiError(code, message, details)
}

export function nextId() {
  return crypto.randomUUID()
}

export function validateTitle(raw: unknown): string {
  const trimmed = String(raw ?? '').trim()
  const length = [...trimmed].length
  if (length === 0 || length > 500) {
    mockFail('INVALID_TITLE', 'Title cannot be empty and must be 500 characters or fewer')
  }
  return trimmed
}

export function validateIsoDate(raw: unknown): string {
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

export function validateMonth(raw: unknown): string {
  const value = String(raw ?? '')
  if (!/^\d{4}-\d{2}$/.test(value)) {
    mockFail('INVALID_DATE', 'Month must use YYYY-MM format')
  }
  validateIsoDate(`${value}-01`)
  return value
}

export function checkVersion(expected: unknown, actual: number) {
  const expectedNumber = Number(expected)
  if (expectedNumber !== actual) {
    mockFail('VERSION_CONFLICT', 'This item was modified elsewhere. Please refresh and try again.', {
      expectedVersion: expectedNumber,
      actualVersion: actual,
    })
  }
}

export function checkReorderMembership(current: string[], orderedIds: string[], message: string) {
  const expected = [...current].sort()
  const supplied = [...orderedIds].sort()
  if (expected.length !== supplied.length || expected.some((value, idx) => value !== supplied[idx])) {
    mockFail('REORDER_MEMBERSHIP_MISMATCH', message)
  }
}

export function nextOrder(items: { sortOrder: number }[]) {
  return (items.reduce((max, item) => Math.max(max, item.sortOrder), 0) || 0) + 1024
}

export function sortedDates(dates: string[] | undefined): string[] {
  return [...new Set(dates ?? [])].sort()
}

export function projectDto(project: ProjectDto, state: MockState): ProjectDto {
  const progress = sortedDates(state.progress[project.id])
  const today = todayIsoDate()
  return {
    ...project,
    recentProgressDates: progress.slice(-3),
    progressCount: progress.length,
    progressedToday: progress.includes(today),
  }
}

export function projectIsTrashed(project: ProjectDto, state: MockState): boolean {
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

export function reminderIsTrashed(reminderId: string, state: MockState): boolean {
  return state.trash.some((entry) => entry.kind === 'reminder' && entry.rootEntityId === reminderId)
}

export function activeProjectById(state: MockState, id: string): ProjectDto {
  const project = state.projects.find((item) => item.id === id && !projectIsTrashed(item, state))
  if (!project) mockFail('NOT_FOUND', 'Project not found')
  return project
}

export function activeReminderById(state: MockState, id: string): ReminderDto {
  const reminder = state.reminders.find((item) => item.id === id && !reminderIsTrashed(item.id, state))
  if (!reminder) mockFail('NOT_FOUND', 'Reminder not found')
  return reminder
}

export function projectSubtree(rootId: string, state: MockState): ProjectDto[] {
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

export function treeOrder(projects: ProjectDto[]): ProjectDto[] {
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

export function buildParentPath(project: ProjectDto, byId: Map<string, ProjectDto>): string[] {
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
