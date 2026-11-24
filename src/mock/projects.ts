import type { ProjectDetailDto, ProjectDto } from '../types'
import { todayIsoDate } from '../ui-format.ts'
import {
  activeProjectById,
  buildParentPath,
  checkReorderMembership,
  checkVersion,
  mockFail,
  nextId,
  nextOrder,
  projectDto,
  projectIsTrashed,
  sortedDates,
  treeOrder,
  validateIsoDate,
  validateMonth,
  validateTitle,
} from './store.ts'
import type { MockCommandHandler, MockState, MockStore } from './store.ts'

function ensureTerminalDateNotBeforeProgress(state: MockState, projectId: string, terminalDate: string) {
  const dates = sortedDates(state.progress[projectId])
  const latest = dates[dates.length - 1]
  if (latest && latest > terminalDate) {
    mockFail(
      'TERMINAL_DATE_BEFORE_PROGRESS',
      `End date cannot be earlier than the latest progress date (${latest}). Remove later progress entries first.`,
      { latestProgressDate: latest },
    )
  }
}

function transitionProjectStatus(
  store: MockStore,
  state: MockState,
  args: Record<string, unknown>,
  target: 'completed' | 'canceled' | 'active',
): ProjectDto {
  const project = activeProjectById(state, String(args.projectId))
  checkVersion(args.expectedVersion, project.version)
  const today = todayIsoDate()
  let updated: ProjectDto
  if (target === 'active') {
    if (project.status === 'active') {
      mockFail('INVALID_STATUS_TRANSITION', 'Project is already active')
    }
    updated = { ...project, status: 'active', completedDate: null, canceledDate: null, version: project.version + 1 }
  } else {
    if (project.status !== 'active') {
      mockFail('INVALID_STATUS_TRANSITION', 'Only active projects can be completed or canceled')
    }
    ensureTerminalDateNotBeforeProgress(state, project.id, today)
    updated = target === 'completed'
      ? { ...project, status: 'completed', completedDate: today, canceledDate: null, version: project.version + 1 }
      : { ...project, status: 'canceled', completedDate: null, canceledDate: today, version: project.version + 1 }
  }
  const nextState = store.updateProject(state, project.id, updated)
  return projectDto(updated, nextState)
}

export const projectHandlers: Record<string, MockCommandHandler> = {
  get_project_tree: (_store, state) => (
    treeOrder(state.projects.filter((project) => !projectIsTrashed(project, state)))
      .map((project) => projectDto(project, state))
  ),

  get_project_detail: (_store, state, args): ProjectDetailDto => {
    const id = String(args.projectId)
    const activeProjects = state.projects.filter((item) => !projectIsTrashed(item, state))
    const project = activeProjects.find((item) => item.id === id)
    if (!project) mockFail('NOT_FOUND', 'Project not found')
    const byId = new Map(activeProjects.map((item) => [item.id, item]))
    return {
      ...projectDto(project, state),
      parentPath: buildParentPath(project, byId),
      progressDates: sortedDates(state.progress[id]),
    }
  },

  get_project_progress_month: (_store, state, args) => {
    const month = validateMonth(args.month)
    const project = activeProjectById(state, String(args.projectId))
    return sortedDates(state.progress[project.id]).filter((date) => date.startsWith(month))
  },

  create_project: (store, state, args) => {
    const title = validateTitle(args.title)
    const parentId = args.parentId ? String(args.parentId) : null
    if (parentId !== null && !state.projects.some((item) => item.id === parentId && !projectIsTrashed(item, state))) {
      mockFail('INVALID_PARENT', 'Parent project does not exist or is in Trash')
    }
    const siblings = state.projects.filter((item) => item.parentId === parentId && !projectIsTrashed(item, state))
    const project: ProjectDto = {
      id: nextId(),
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
    store.saveState(nextState)
    return projectDto(project, nextState)
  },

  rename_project: (store, state, args) => {
    const title = validateTitle(args.title)
    const project = activeProjectById(state, String(args.projectId))
    checkVersion(args.expectedVersion, project.version)
    const updated: ProjectDto = { ...project, title, version: project.version + 1 }
    const nextState = store.updateProject(state, project.id, updated)
    return projectDto(updated, nextState)
  },

  set_project_expanded: (store, state, args) => {
    const project = activeProjectById(state, String(args.projectId))
    const updated: ProjectDto = { ...project, isExpanded: Boolean(args.isExpanded) }
    const nextState = store.updateProject(state, project.id, updated)
    return projectDto(updated, nextState)
  },

  set_all_projects_expanded: (store, state, args) => {
    const isExpanded = Boolean(args.isExpanded)
    const projects = state.projects.map((project) => (
      projectIsTrashed(project, state) ? project : { ...project, isExpanded }
    ))
    const nextState: MockState = { ...state, projects }
    store.saveState(nextState)
    return treeOrder(projects.filter((project) => !projectIsTrashed(project, nextState)))
      .map((project) => projectDto(project, nextState))
  },

  reorder_project_siblings: (store, state, args) => {
    const parentId = args.parentId ? String(args.parentId) : null
    const orderedIds = Array.isArray(args.orderedIds) ? args.orderedIds.map(String) : []
    const current = state.projects
      .filter((item) => item.parentId === parentId && !projectIsTrashed(item, state))
      .map((item) => item.id)
    checkReorderMembership(current, orderedIds, 'Reorder list must include all projects in the same level')
    const orderIndex = new Map(orderedIds.map((projectId, idx) => [projectId, (idx + 1) * 1024]))
    const nextState: MockState = {
      ...state,
      projects: state.projects.map((item) => {
        const sortOrder = orderIndex.get(item.id)
        return sortOrder !== undefined ? { ...item, sortOrder, version: item.version + 1 } : item
      }),
    }
    store.saveState(nextState)
    return orderedIds
      .map((projectId) => nextState.projects.find((item) => item.id === projectId)!)
      .map((project) => projectDto(project, nextState))
  },

  move_project: (store, state, args) => {
    const project = activeProjectById(state, String(args.projectId))
    checkVersion(args.expectedVersion, project.version)
    const targetParentId = args.targetParentId ? String(args.targetParentId) : null
    const activeProjects = state.projects.filter((item) => !projectIsTrashed(item, state))
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
    const nextState = store.updateProject(state, project.id, updated)
    return projectDto(updated, nextState)
  },

  set_project_progress: (store, state, args) => {
    const project = activeProjectById(state, String(args.projectId))
    checkVersion(args.expectedVersion, project.version)
    const today = todayIsoDate()
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
    store.saveState(nextState)
    return projectDto(updated, nextState)
  },

  complete_project: (store, state, args) => transitionProjectStatus(store, state, args, 'completed'),
  cancel_project: (store, state, args) => transitionProjectStatus(store, state, args, 'canceled'),
  restore_project: (store, state, args) => transitionProjectStatus(store, state, args, 'active'),

  update_project_terminal_date: (store, state, args) => {
    const project = activeProjectById(state, String(args.projectId))
    checkVersion(args.expectedVersion, project.version)
    if (project.status === 'active') {
      mockFail('INVALID_STATUS_TRANSITION', 'Active projects do not have an end date')
    }
    const date = validateIsoDate(args.date)
    if (date > todayIsoDate()) {
      mockFail('FUTURE_DATE_FORBIDDEN', 'End date cannot be in the future')
    }
    ensureTerminalDateNotBeforeProgress(state, project.id, date)
    const updated: ProjectDto = project.status === 'completed'
      ? { ...project, completedDate: date, version: project.version + 1 }
      : { ...project, canceledDate: date, version: project.version + 1 }
    const nextState = store.updateProject(state, project.id, updated)
    return projectDto(updated, nextState)
  },
}
