import type { ProjectDto } from './types'

export function createMoveOptions(projectId: string, projects: ProjectDto[]) {
  const children = new Map<string, string[]>()
  const byId = new Map(projects.map((project) => [project.id, project]))
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

  const candidates = projects.filter((project) => !excluded.has(project.id)).map((project) => {
    const path: string[] = []
    const visited = new Set<string>()
    let current: ProjectDto | undefined = project
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      path.unshift(current.title)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    return { value: project.id, label: path.join(' / ') }
  })
  const matchingPaths = new Map<string, string[]>()
  for (const candidate of candidates) matchingPaths.set(candidate.label, [...(matchingPaths.get(candidate.label) ?? []), candidate.value])

  return [{ value: '', label: '顶层' }, ...candidates.map((candidate) => {
    const matches = matchingPaths.get(candidate.label)!
    if (matches.length === 1) return candidate
    let length = Math.min(4, candidate.value.length)
    while (length < candidate.value.length && matches.some((id) => id !== candidate.value && id.startsWith(candidate.value.slice(0, length)))) length += 1
    return { ...candidate, label: `${candidate.label} · ${candidate.value.slice(0, length)}` }
  })]
}
