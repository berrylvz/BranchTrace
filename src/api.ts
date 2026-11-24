import { invoke } from '@tauri-apps/api/core'
import { normalizeError } from './api-error.ts'
import type {
  ClockContext,
  DailyWeekDto,
  MonthCalendarDto,
  ProjectDetailDto,
  ProjectDto,
  ReminderDto,
  ThemeMode,
  ThemeSettings,
  TrashEntryDto,
} from './types'

const tauriAvailable = typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)

type MockCaller = <T>(command: string, args?: Record<string, unknown>) => Promise<T>
let mockCallerPromise: Promise<MockCaller> | null = null

function loadMockCaller(): Promise<MockCaller> {
  if (!mockCallerPromise) {
    mockCallerPromise = import('./mock/index.ts').then(({ createMockCaller }) => createMockCaller())
  }
  return mockCallerPromise
}

export async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!tauriAvailable) {
    try {
      const mockCall = await loadMockCaller()
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
