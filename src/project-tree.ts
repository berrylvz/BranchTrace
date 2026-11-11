import type { ProjectDto } from './types'

export const MAX_TREE_INDENT = 12
export const TREE_INDENT = 18

export interface ProjectTreeRow {
  project: ProjectDto
  depth: number
  hasChildren: boolean
  isLastSibling: boolean
  continuationDepths: number[]
}

export function createProjectTree(projects: ProjectDto[]) {
  const grouped = new Map<string | null, ProjectDto[]>()
  for (const project of projects) {
    const siblings = grouped.get(project.parentId)
    if (siblings) siblings.push(project)
    else grouped.set(project.parentId, [project])
  }
  for (const siblings of grouped.values()) siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))

  const rows: ProjectTreeRow[] = []
  const pending: Omit<ProjectTreeRow, 'hasChildren'>[] = []
  const visited = new Set<string>()
  const pushSiblings = (parentId: string | null, depth: number, continuationDepths: number[]) => {
    const siblings = grouped.get(parentId) ?? []
    for (let index = siblings.length - 1; index >= 0; index -= 1) {
      pending.push({ project: siblings[index], depth, isLastSibling: index === siblings.length - 1, continuationDepths })
    }
  }

  pushSiblings(null, 0, [])
  while (pending.length) {
    const row = pending.pop()!
    if (visited.has(row.project.id)) continue
    visited.add(row.project.id)
    const hasChildren = Boolean(grouped.get(row.project.id)?.length)
    rows.push({ ...row, hasChildren })
    if (!row.project.isExpanded || !hasChildren) continue

    // Guide metadata stays bounded even when the actual tree is thousands of levels deep.
    const continuationDepths = row.depth > 0 && row.depth <= MAX_TREE_INDENT && !row.isLastSibling
      ? [...row.continuationDepths, row.depth - 1]
      : row.continuationDepths
    pushSiblings(row.project.id, row.depth + 1, continuationDepths)
  }

  return { grouped, rows, hasBranches: rows.some((row) => row.hasChildren) }
}
