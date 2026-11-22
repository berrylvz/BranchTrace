import type { ProjectDto, ProjectStatus } from './types'

export interface MoveTreeOption {
  value: string
  title: string
  label: string
  depth: number
  path: string[]
  shortId: string | null
  status: ProjectStatus | null
}

function collectExcludedIds(projectId: string, projects: ProjectDto[]) {
  const children = new Map<string, string[]>()
  for (const project of projects) {
    if (project.parentId) children.set(project.parentId, [...(children.get(project.parentId) ?? []), project.id])
  }
  const excluded = new Set<string>()
  const pending = [projectId]
  while (pending.length) {
    const id = pending.pop()!
    if (excluded.has(id)) continue
    excluded.add(id)
    pending.push(...(children.get(id) ?? []))
  }
  return excluded
}

function buildPath(project: ProjectDto, byId: Map<string, ProjectDto>) {
  const path: string[] = []
  const visited = new Set<string>()
  let current: ProjectDto | undefined = project
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    path.unshift(current.title)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path
}

function resolveShortId(id: string, matches: string[]) {
  if (matches.length <= 1) return null
  let length = Math.min(4, id.length)
  while (length < id.length && matches.some((other) => other !== id && other.startsWith(id.slice(0, length)))) length += 1
  return id.slice(0, length)
}

export function createMoveOptions(projectId: string, projects: ProjectDto[]) {
  const byId = new Map(projects.map((project) => [project.id, project]))
  const excluded = collectExcludedIds(projectId, projects)

  const candidates = projects.filter((project) => !excluded.has(project.id)).map((project) => ({
    value: project.id,
    label: buildPath(project, byId).join(' / '),
  }))
  const matchingPaths = new Map<string, string[]>()
  for (const candidate of candidates) matchingPaths.set(candidate.label, [...(matchingPaths.get(candidate.label) ?? []), candidate.value])

  return [{ value: '', label: 'Top level' }, ...candidates.map((candidate) => {
    const shortId = resolveShortId(candidate.value, matchingPaths.get(candidate.label)!)
    return shortId ? { ...candidate, label: `${candidate.label} · ${shortId}` } : candidate
  })]
}

export function createMoveTreeOptions(projectId: string, projects: ProjectDto[]): MoveTreeOption[] {
  const byId = new Map(projects.map((project) => [project.id, project]))
  const excluded = collectExcludedIds(projectId, projects)

  const grouped = new Map<string | null, ProjectDto[]>()
  for (const project of projects) {
    if (excluded.has(project.id)) continue
    const key = project.parentId && byId.has(project.parentId) && !excluded.has(project.parentId) ? project.parentId : null
    const siblings = grouped.get(key)
    if (siblings) siblings.push(project)
    else grouped.set(key, [project])
  }
  for (const siblings of grouped.values()) siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))

  const ordered: { project: ProjectDto; depth: number; path: string[]; fullLabel: string }[] = []
  const visited = new Set<string>()
  const pending: { project: ProjectDto; depth: number }[] = []
  const pushChildren = (parentId: string | null, depth: number) => {
    const siblings = grouped.get(parentId) ?? []
    for (let index = siblings.length - 1; index >= 0; index -= 1) {
      pending.push({ project: siblings[index], depth })
    }
  }

  pushChildren(null, 0)
  while (pending.length) {
    const entry = pending.pop()!
    if (visited.has(entry.project.id)) continue
    visited.add(entry.project.id)
    const path = buildPath(entry.project, byId)
    ordered.push({ project: entry.project, depth: entry.depth, path: path.slice(0, -1), fullLabel: path.join(' / ') })
    pushChildren(entry.project.id, entry.depth + 1)
  }

  // Include malformed cyclic nodes without hanging.
  for (const project of projects) {
    if (excluded.has(project.id) || visited.has(project.id)) continue
    visited.add(project.id)
    const path = buildPath(project, byId)
    ordered.push({ project, depth: 0, path: path.slice(0, -1), fullLabel: path.join(' / ') })
  }

  const matchingPaths = new Map<string, string[]>()
  for (const item of ordered) {
    matchingPaths.set(item.fullLabel, [...(matchingPaths.get(item.fullLabel) ?? []), item.project.id])
  }

  return [
    { value: '', title: 'Top level (root project)', label: 'Top level', depth: 0, path: [], shortId: null, status: null },
    ...ordered.map((item) => {
      const shortId = resolveShortId(item.project.id, matchingPaths.get(item.fullLabel)!)
      return {
        value: item.project.id,
        title: item.project.title,
        label: shortId ? `${item.fullLabel} · ${shortId}` : item.fullLabel,
        depth: item.depth + 1,
        path: item.path,
        shortId,
        status: item.project.status,
      }
    }),
  ]
}
