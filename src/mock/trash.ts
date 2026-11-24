import type { TrashEntryDto } from '../types'
import {
  activeProjectById,
  activeReminderById,
  mockFail,
  nextId,
  projectIsTrashed,
  projectSubtree,
} from './store.ts'
import type { MockCommandHandler, MockState } from './store.ts'

function validateTrashKind(raw: unknown): 'project' | 'reminder' {
  const kind = String(raw)
  if (kind !== 'project' && kind !== 'reminder') {
    mockFail('INVALID_INPUT', 'Invalid trash category')
  }
  return kind
}

function withCleanBatches(state: MockState, nextBatches: Record<string, string[]> | undefined): MockState {
  if (!nextBatches || Object.keys(nextBatches).length === 0) {
    const { trashBatches: _unused, ...rest } = state
    return rest
  }
  return { ...state, trashBatches: nextBatches }
}

function removeProjectIdsFromState(
  state: MockState,
  deletedIds: Set<string>,
  removedTrashIds: Set<string>,
): MockState {
  const nextProgress = { ...state.progress }
  for (const projectId of deletedIds) delete nextProgress[projectId]
  const nextBatches = state.trashBatches ? { ...state.trashBatches } : undefined
  if (nextBatches) {
    for (const trashId of removedTrashIds) delete nextBatches[trashId]
  }
  return withCleanBatches({
    ...state,
    projects: state.projects.filter((project) => !deletedIds.has(project.id)),
    progress: nextProgress,
    trash: state.trash.filter((item) => !removedTrashIds.has(item.id)),
  }, nextBatches)
}

export const trashHandlers: Record<string, MockCommandHandler> = {
  preview_project_trash: (_store, state, args) => {
    const root = activeProjectById(state, String(args.projectId))
    const activeNodeCount = projectSubtree(root.id, state).filter((item) => !projectIsTrashed(item, state)).length
    return { activeNodeCount }
  },

  trash_project: (store, state, args) => {
    const root = activeProjectById(state, String(args.projectId))
    const subtree = projectSubtree(root.id, state)
    const activeIds = subtree.filter((item) => !projectIsTrashed(item, state)).map((item) => item.id)
    const activeSet = new Set(activeIds)
    const entry: TrashEntryDto = {
      id: nextId(),
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
    store.saveState(nextState)
    return entry
  },

  trash_reminder: (store, state, args) => {
    const reminder = activeReminderById(state, String(args.reminderId))
    const entry: TrashEntryDto = {
      id: nextId(),
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
    store.saveState(nextState)
    return entry
  },

  list_trash: (_store, state, args) => {
    const kind = validateTrashKind(args.kind)
    return state.trash
      .filter((entry) => entry.kind === kind)
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || b.id.localeCompare(a.id))
      .map((entry) => ({
        ...entry,
        currentDescendantCount: kind === 'project' ? projectSubtree(entry.rootEntityId, state).length : null,
      }))
  },

  restore_trash_entry: (store, state, args) => {
    const entry = state.trash.find((item) => item.id === String(args.entryId))
    if (!entry) mockFail('NOT_FOUND', 'Trash entry not found')
    if (entry.kind === 'project') {
      const root = state.projects.find((item) => item.id === entry.rootEntityId)
      if (root?.parentId) {
        const parent = state.projects.find((item) => item.id === root.parentId)
        if (parent && projectIsTrashed(parent, state)) {
          mockFail('PARENT_IN_TRASH', 'Restore the parent project first')
        }
      }
      const batchMembers = state.trashBatches?.[entry.id]
      const restoredIds = new Set(
        batchMembers ?? projectSubtree(entry.rootEntityId, state).map((item) => item.id),
      )
      const nextBatches = state.trashBatches ? { ...state.trashBatches } : undefined
      if (nextBatches) delete nextBatches[entry.id]
      const nextState = withCleanBatches({
        ...state,
        projects: state.projects.map((item) => restoredIds.has(item.id) ? { ...item, version: item.version + 1 } : item),
        trash: state.trash.filter((item) => item.id !== entry.id),
      }, nextBatches)
      store.saveState(nextState)
      return { kind: 'project', restoredCount: restoredIds.size }
    }
    const existed = state.reminders.some((item) => item.id === entry.rootEntityId)
    const nextState: MockState = {
      ...state,
      reminders: state.reminders.map((item) => item.id === entry.rootEntityId ? { ...item, version: item.version + 1 } : item),
      trash: state.trash.filter((item) => item.id !== entry.id),
    }
    store.saveState(nextState)
    return { kind: 'reminder', restoredCount: existed ? 1 : 0 }
  },

  permanently_delete_trash_entry: (store, state, args) => {
    const entry = state.trash.find((item) => item.id === String(args.entryId))
    if (!entry) mockFail('NOT_FOUND', 'Trash entry not found')
    if (entry.kind === 'project') {
      const ids = new Set(projectSubtree(entry.rootEntityId, state).map((project) => project.id))
      const removedTrashIds = new Set(
        state.trash
          .filter((item) => item.id === entry.id || (item.kind === 'project' && ids.has(item.rootEntityId)))
          .map((item) => item.id),
      )
      const nextState = removeProjectIdsFromState(state, ids, removedTrashIds)
      store.saveState(nextState)
      return { deletedProjectCount: ids.size, deletedReminderCount: 0 }
    }
    const existed = state.reminders.some((reminder) => reminder.id === entry.rootEntityId)
    const nextState: MockState = {
      ...state,
      reminders: state.reminders.filter((reminder) => reminder.id !== entry.rootEntityId),
      trash: state.trash.filter((item) => item.id !== entry.id),
    }
    store.saveState(nextState)
    return { deletedProjectCount: 0, deletedReminderCount: existed ? 1 : 0 }
  },

  empty_trash: (store, state, args) => {
    const kind = validateTrashKind(args.kind)
    const entries = state.trash.filter((entry) => entry.kind === kind)
    if (kind === 'project') {
      const deletedIds = new Set<string>()
      for (const entry of entries) {
        for (const project of projectSubtree(entry.rootEntityId, state)) {
          deletedIds.add(project.id)
        }
      }
      const removedTrashIds = new Set(entries.map((entry) => entry.id))
      const nextState = removeProjectIdsFromState(state, deletedIds, removedTrashIds)
      store.saveState(nextState)
      return { deletedProjectCount: deletedIds.size, deletedReminderCount: 0 }
    }
    const reminderIds = new Set(entries.map((entry) => entry.rootEntityId))
    const deletedReminderCount = state.reminders.filter((reminder) => reminderIds.has(reminder.id)).length
    const nextState: MockState = {
      ...state,
      reminders: state.reminders.filter((reminder) => !reminderIds.has(reminder.id)),
      trash: state.trash.filter((entry) => entry.kind !== 'reminder'),
    }
    store.saveState(nextState)
    return { deletedProjectCount: 0, deletedReminderCount }
  },
}
