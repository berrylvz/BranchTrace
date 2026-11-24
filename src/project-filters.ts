import type { DailyWeekDto, ISODate, ProjectDto } from './types'
import { addDays, daysBetween } from './ui-format.ts'

export type ProjectFilter =
  | 'all'
  | 'active'
  | 'completed'
  | 'canceled'
  | 'logged-today'
  | 'not-logged-today'
  | 'inactive'

export interface FilterProjectTreeOptions {
  query: string
  filter: ProjectFilter
  today: ISODate
  inactiveDays: number
}

export interface FilteredProjectTreeResult {
  filteredProjects: ProjectDto[]
  matchedIds: Set<string>
  ancestorIds: Set<string>
  tempExpandedIds: Set<string>
  directMatchCount: number
  isFiltered: boolean
}

export interface ActivityTimelineDay {
  date: ISODate
  hasProgress: boolean
  isCompletedDay: boolean
  isToday: boolean
}

export function getLastProgressDate(project: Pick<ProjectDto, 'recentProgressDates' | 'progressedToday'>, today?: ISODate): ISODate | null {
  const latest = project.recentProgressDates.length > 0
    ? project.recentProgressDates[project.recentProgressDates.length - 1]
    : null
  if (project.progressedToday && today && (!latest || today > latest)) {
    return today
  }
  return latest
}

export function getProjectInactiveDays(
  project: Pick<ProjectDto, 'status' | 'progressCount' | 'recentProgressDates' | 'progressedToday'>,
  today: ISODate,
): number | null {
  if (project.status !== 'active') return null
  if (project.progressedToday) return 0
  const lastDate = getLastProgressDate(project, today)
  if (!lastDate) return null
  return Math.max(0, daysBetween(lastDate, today))
}

export function isProjectInactive(
  project: Pick<ProjectDto, 'status' | 'progressCount' | 'recentProgressDates' | 'progressedToday'>,
  today: ISODate,
  thresholdDays: number,
): boolean {
  if (project.status !== 'active') return false
  if (project.progressedToday) return false
  const lastDate = getLastProgressDate(project, today)
  if (!lastDate) return true
  return daysBetween(lastDate, today) >= thresholdDays
}

function matchesFilter(project: ProjectDto, filter: ProjectFilter, today: ISODate, inactiveDays: number): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'active':
      return project.status === 'active'
    case 'completed':
      return project.status === 'completed'
    case 'canceled':
      return project.status === 'canceled'
    case 'logged-today':
      return project.progressedToday
    case 'not-logged-today':
      return project.status === 'active' && !project.progressedToday
    case 'inactive':
      return isProjectInactive(project, today, inactiveDays)
  }
}

export function filterProjectTree(
  projects: ProjectDto[],
  options: FilterProjectTreeOptions,
): FilteredProjectTreeResult {
  const normalizedQuery = options.query.trim().toLowerCase()
  const isFiltered = normalizedQuery.length > 0 || options.filter !== 'all'

  if (!isFiltered) {
    const allIds = new Set(projects.map((item) => item.id))
    return {
      filteredProjects: projects,
      matchedIds: allIds,
      ancestorIds: new Set<string>(),
      tempExpandedIds: new Set<string>(),
      directMatchCount: projects.length,
      isFiltered: false,
    }
  }

  const byId = new Map(projects.map((item) => [item.id, item]))
  const matchedIds = new Set<string>()

  for (const project of projects) {
    const queryOk = normalizedQuery.length === 0 || project.title.toLowerCase().includes(normalizedQuery)
    const filterOk = matchesFilter(project, options.filter, options.today, options.inactiveDays)
    if (queryOk && filterOk) {
      matchedIds.add(project.id)
    }
  }

  const visibleIds = new Set<string>(matchedIds)
  const ancestorIds = new Set<string>()
  const tempExpandedIds = new Set<string>()

  for (const id of matchedIds) {
    let parentId = byId.get(id)?.parentId ?? null
    const visited = new Set<string>([id])
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      visibleIds.add(parent.id)
      tempExpandedIds.add(parent.id)
      if (!matchedIds.has(parent.id)) {
        ancestorIds.add(parent.id)
      }
      parentId = parent.parentId
    }
  }

  const filteredProjects = projects.filter((item) => visibleIds.has(item.id))

  return {
    filteredProjects,
    matchedIds,
    ancestorIds,
    tempExpandedIds,
    directMatchCount: matchedIds.size,
    isFiltered: true,
  }
}

export function collectAncestorIds(projects: ProjectDto[], projectId: string): string[] {
  const byId = new Map(projects.map((item) => [item.id, item]))
  const ancestors: string[] = []
  const visited = new Set<string>([projectId])
  let current = byId.get(projectId)?.parentId ?? null
  while (current && !visited.has(current)) {
    visited.add(current)
    const parent = byId.get(current)
    if (!parent) break
    ancestors.unshift(parent.id)
    current = parent.parentId
  }
  return ancestors
}

export function buildProgressDatesMapFromWeeks(
  weeks: readonly (DailyWeekDto | undefined)[],
): Map<string, Set<ISODate>> {
  const map = new Map<string, Set<ISODate>>()
  const record = (projectId: string, date: ISODate) => {
    let dates = map.get(projectId)
    if (!dates) {
      dates = new Set<ISODate>()
      map.set(projectId, dates)
    }
    dates.add(date)
  }

  for (const week of weeks) {
    if (!week) continue
    for (const day of week.days) {
      for (const item of day.progressedProjects) {
        record(item.projectId, day.date)
      }
      for (const item of day.completedProjects) {
        if (item.progressedSameDay) {
          record(item.projectId, day.date)
        }
      }
    }
  }

  return map
}

export function buildActivityTimeline(
  project: Pick<ProjectDto, 'id' | 'status' | 'completedDate' | 'recentProgressDates' | 'progressedToday'>,
  today: ISODate,
  windowDays: number,
  progressDatesByProject?: ReadonlyMap<string, ReadonlySet<ISODate>>,
): ActivityTimelineDay[] {
  const count = Math.max(1, Math.floor(windowDays))
  const start = addDays(today, -(count - 1))
  const progressSet = new Set<ISODate>()

  const fromWeeks = progressDatesByProject?.get(project.id)
  if (fromWeeks) {
    for (const date of fromWeeks) {
      if (date <= today) progressSet.add(date)
    }
  }
  for (const date of project.recentProgressDates) {
    if (date <= today) progressSet.add(date)
  }
  if (project.progressedToday) {
    progressSet.add(today)
  }

  const completedDate = project.status === 'completed' ? project.completedDate : null
  const cells: ActivityTimelineDay[] = []
  for (let offset = 0; offset < count; offset += 1) {
    const date = addDays(start, offset)
    cells.push({
      date,
      hasProgress: progressSet.has(date),
      isCompletedDay: completedDate === date,
      isToday: date === today,
    })
  }
  return cells
}
