export type ProjectStatus = 'active' | 'completed' | 'canceled'
export type ReminderStatus = ProjectStatus
export type ThemeMode = 'light' | 'dark' | 'system'
export type ISODate = string

export interface ProjectDto {
  id: string
  parentId: string | null
  title: string
  status: ProjectStatus
  completedDate: ISODate | null
  canceledDate: ISODate | null
  sortOrder: number
  version: number
  isExpanded: boolean
  recentProgressDates: ISODate[]
  progressCount: number
  progressedToday: boolean
}

export interface ProjectDetailDto extends ProjectDto {
  parentPath: string[]
  progressDates: ISODate[]
}

export interface ReminderDto {
  id: string
  title: string
  scheduledDate: ISODate
  status: ReminderStatus
  completedDate: ISODate | null
  completedActionAt: string | null
  canceledDate: ISODate | null
  sortOrder: number
  version: number
}

export interface ProjectDailyItem {
  projectId: string
  title: string
  parentPath: string[]
  shortId: string | null
  status: ProjectStatus
  progressedSameDay?: boolean
}

export type ReminderDisplayType = 'planned' | 'completed' | 'overdue'

export interface ReminderDailyItem {
  reminder: ReminderDto
  displayType: ReminderDisplayType
  isPlannedAndCompletedSameDay: boolean
}

export interface DailyDayDto {
  date: ISODate
  completedProjects: ProjectDailyItem[]
  progressedProjects: ProjectDailyItem[]
  plannedReminders: ReminderDailyItem[]
  overdueReminders: ReminderDailyItem[]
  crossDayCompletedReminders: ReminderDailyItem[]
}

export interface DailyWeekDto {
  weekStart: ISODate
  today: ISODate
  days: DailyDayDto[]
}

export interface TrashEntryDto {
  id: string
  kind: 'project' | 'reminder'
  rootEntityId: string
  titleSnapshot: string
  deletedAt: string
  affectedCountAtDelete: number
  currentDescendantCount: number | null
}

export interface ClockContext {
  today: ISODate
  weekStart: ISODate
  timeZoneLabel: string
}

export interface ThemeSettings {
  themeMode: ThemeMode
}

export interface ApiError {
  code: string
  message: string
  details?: Record<string, unknown>
}
