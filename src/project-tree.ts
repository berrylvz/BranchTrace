import type { ProjectDto } from './types'

export const MAX_TREE_INDENT = 12
export const TREE_INDENT = 24
export const TREE_TOGGLE_WIDTH = 28

export interface ProjectTreeRow {
  project: ProjectDto
  depth: number
  hasChildren: boolean
  isLastSibling: boolean
  continuationDepths: number[]
}

export type ProjectDisplayItem =
  | { kind: 'project'; row: ProjectTreeRow; visuallyExpanded: boolean; showDownGuide: boolean }
  | { kind: 'child-input'; parent: ProjectDto; depth: number; continuationDepths: number[] }

export function createProjectTree(projects: ProjectDto[], tempExpandedIds?: ReadonlySet<string>) {
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
    const expanded = row.project.isExpanded || Boolean(tempExpandedIds?.has(row.project.id))
    if (!expanded || !hasChildren) continue

    // Guide metadata stays bounded even when the actual tree is thousands of levels deep.
    const continuationDepths = row.depth > 0 && row.depth <= MAX_TREE_INDENT && !row.isLastSibling
      ? [...row.continuationDepths, row.depth - 1]
      : row.continuationDepths
    pushSiblings(row.project.id, row.depth + 1, continuationDepths)
  }

  return { grouped, rows, hasBranches: rows.some((row) => row.hasChildren) }
}

export function buildProjectDisplayItems(
  rows: ProjectTreeRow[],
  addingChildParentId: string | null,
  tempExpandedIds?: ReadonlySet<string>,
): ProjectDisplayItem[] {
  const parentIndex = addingChildParentId ? rows.findIndex((row) => row.project.id === addingChildParentId) : -1
  if (parentIndex < 0) {
    return rows.map((row) => {
      const visuallyExpanded = row.project.isExpanded || Boolean(tempExpandedIds?.has(row.project.id))
      return { kind: 'project', row, visuallyExpanded, showDownGuide: row.hasChildren && visuallyExpanded }
    })
  }

  const parentRow = rows[parentIndex]
  let insertAfterIndex = parentIndex
  let lastDirectChildIndex = -1
  for (let index = parentIndex + 1; index < rows.length; index += 1) {
    if (rows[index].depth <= parentRow.depth) break
    insertAfterIndex = index
    if (rows[index].depth === parentRow.depth + 1) lastDirectChildIndex = index
  }

  const childContinuationDepths = parentRow.depth > 0 && parentRow.depth <= MAX_TREE_INDENT && !parentRow.isLastSibling
    ? [...parentRow.continuationDepths, parentRow.depth - 1]
    : parentRow.continuationDepths

  const items: ProjectDisplayItem[] = []
  for (let index = 0; index < rows.length; index += 1) {
    let row = rows[index]
    const isParent = index === parentIndex
    const visuallyExpanded = row.project.isExpanded || Boolean(tempExpandedIds?.has(row.project.id)) || isParent

    // Keep the parent's vertical branch line unbroken past its existing last child down to the inline input.
    if (lastDirectChildIndex >= 0 && index === lastDirectChildIndex) {
      row = { ...row, isLastSibling: false }
    } else if (lastDirectChildIndex >= 0 && index > lastDirectChildIndex && index <= insertAfterIndex && parentRow.depth < MAX_TREE_INDENT) {
      if (!row.continuationDepths.includes(parentRow.depth)) {
        row = { ...row, continuationDepths: [...row.continuationDepths, parentRow.depth] }
      }
    }

    items.push({
      kind: 'project',
      row,
      visuallyExpanded,
      showDownGuide: isParent || (row.hasChildren && visuallyExpanded),
    })

    if (index === insertAfterIndex) {
      items.push({
        kind: 'child-input',
        parent: parentRow.project,
        depth: parentRow.depth + 1,
        continuationDepths: childContinuationDepths,
      })
    }
  }

  return items
}

export function computeReorderedIds(
  ids: string[],
  fromId: string,
  targetId: string,
  position: 'before' | 'after',
): string[] | null {
  if (fromId === targetId) return null
  if (!ids.includes(fromId) || !ids.includes(targetId)) return null
  const next = ids.filter((id) => id !== fromId)
  const targetIndex = next.indexOf(targetId)
  next.splice(position === 'before' ? targetIndex : targetIndex + 1, 0, fromId)
  if (next.every((id, index) => id === ids[index])) return null
  return next
}
