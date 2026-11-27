import type {
  DailyRangeDto,
  ISODate,
  ProjectStatus,
  ReminderDailyItem,
} from './types'
import {
  addDays,
  daysBetween,
  describeReminderCompletionTiming,
  formatWeekdayShort,
  isWeekendDate,
} from './ui-format.ts'

export const MAX_RANGE_DAYS = 30

export type RangePresetId = 'this-week' | 'last-7' | 'last-14' | 'last-30'

export interface DateRangeBounds {
  startDate: ISODate
  endDate: ISODate
}

export interface NormalizedDateRange extends DateRangeBounds {
  dayCount: number
  clamped: boolean
}

export interface RangeDailyBar {
  date: ISODate
  weekday: string
  dayNumber: number
  completedCount: number
  progressCount: number
  remindersDoneCount: number
  totalProjectCount: number
  isToday: boolean
  isFuture: boolean
  isWeekend: boolean
}

export interface RangeCompletedProject {
  projectId: string
  title: string
  parentPath: string[]
  shortId: string | null
  completedDate: ISODate
  progressedSameDay: boolean
}

export interface RangeProjectBreakdownItem {
  projectId: string
  title: string
  parentPath: string[]
  shortId: string | null
  status: ProjectStatus
  progressDates: ISODate[]
  completedDate: ISODate | null
  activeDayCount: number
}

export interface RangeReminderTiming {
  onTime: number
  early: number
  late: number
}

export interface RangeReminderGroups {
  upcoming: ReminderDailyItem[]
  overdueInRange: ReminderDailyItem[]
  completed: ReminderDailyItem[]
  canceled: ReminderDailyItem[]
}

export interface RangeSummaryStats {
  totalDays: number
  elapsedDays: number
  completedProjectsCount: number
  progressLogsCount: number
  uniqueActiveProjectsCount: number
  activeDaysCount: number
  remindersDoneCount: number
  remindersUpcomingCount: number
  remindersOverdueInRangeCount: number
  remindersCanceledCount: number
  reminderTiming: RangeReminderTiming
  dailyActivity: RangeDailyBar[]
  completedProjects: RangeCompletedProject[]
  projectBreakdown: RangeProjectBreakdownItem[]
  reminderGroups: RangeReminderGroups
}

export function normalizeDateRange(
  startDate: ISODate,
  endDate: ISODate,
  anchor: 'start' | 'end' = 'end',
): NormalizedDateRange {
  if (startDate > endDate) {
    const fixed = anchor === 'start' ? startDate : endDate
    return { startDate: fixed, endDate: fixed, dayCount: 1, clamped: false }
  }
  const span = daysBetween(startDate, endDate) + 1
  if (span > MAX_RANGE_DAYS) {
    if (anchor === 'start') {
      return {
        startDate,
        endDate: addDays(startDate, MAX_RANGE_DAYS - 1),
        dayCount: MAX_RANGE_DAYS,
        clamped: true,
      }
    }
    return {
      startDate: addDays(endDate, -(MAX_RANGE_DAYS - 1)),
      endDate,
      dayCount: MAX_RANGE_DAYS,
      clamped: true,
    }
  }
  return { startDate, endDate, dayCount: span, clamped: false }
}

export function buildRangePreset(
  preset: RangePresetId,
  today: ISODate,
  weekStart: ISODate,
): DateRangeBounds {
  if (preset === 'this-week') {
    return { startDate: weekStart, endDate: addDays(weekStart, 6) }
  }
  if (preset === 'last-14') {
    return { startDate: addDays(today, -13), endDate: today }
  }
  if (preset === 'last-30') {
    return { startDate: addDays(today, -29), endDate: today }
  }
  return { startDate: addDays(today, -6), endDate: today }
}

export function detectRangePreset(
  startDate: ISODate,
  endDate: ISODate,
  today: ISODate,
  weekStart: ISODate,
): RangePresetId | null {
  const candidates: RangePresetId[] = ['last-7', 'this-week', 'last-14', 'last-30']
  for (const preset of candidates) {
    const bounds = buildRangePreset(preset, today, weekStart)
    if (bounds.startDate === startDate && bounds.endDate === endDate) return preset
  }
  return null
}

export function shiftDateRange(
  startDate: ISODate,
  endDate: ISODate,
  direction: -1 | 1,
): DateRangeBounds {
  const span = Math.max(1, daysBetween(startDate, endDate) + 1)
  return {
    startDate: addDays(startDate, direction * span),
    endDate: addDays(endDate, direction * span),
  }
}

export function shiftRangeToLatest(
  startDate: ISODate,
  endDate: ISODate,
  today: ISODate,
): DateRangeBounds {
  const span = Math.min(MAX_RANGE_DAYS, Math.max(1, daysBetween(startDate, endDate) + 1))
  return {
    startDate: addDays(today, -(span - 1)),
    endDate: today,
  }
}

export function computeRangeSummary(range: DailyRangeDto): RangeSummaryStats {
  let elapsedDays = 0
  let completedProjectsCount = 0
  let progressLogsCount = 0
  let activeDaysCount = 0

  const dailyActivity: RangeDailyBar[] = []
  const completedProjects: RangeCompletedProject[] = []
  const projectMap = new Map<string, {
    projectId: string
    title: string
    parentPath: string[]
    shortId: string | null
    status: ProjectStatus
    progressDates: Set<ISODate>
    completedDate: ISODate | null
  }>()

  const completedRemindersMap = new Map<string, ReminderDailyItem>()
  const plannedRemindersMap = new Map<string, ReminderDailyItem>()

  const upsertProject = (
    projectId: string,
    title: string,
    parentPath: string[],
    shortId: string | null,
    status: ProjectStatus,
  ) => {
    const existing = projectMap.get(projectId)
    if (existing) {
      if (!existing.shortId && shortId) existing.shortId = shortId
      return existing
    }
    const created = {
      projectId,
      title,
      parentPath,
      shortId,
      status,
      progressDates: new Set<ISODate>(),
      completedDate: null as ISODate | null,
    }
    projectMap.set(projectId, created)
    return created
  }

  for (const day of range.days) {
    const isFuture = day.date > range.today
    const isToday = day.date === range.today
    const isWeekend = isWeekendDate(day.date)
    if (!isFuture) elapsedDays += 1

    let dayCompleted = 0
    let dayProgress = 0
    const dayCompletedReminderIds = new Set<string>()

    if (!isFuture) {
      dayCompleted = day.completedProjects.length
      for (const item of day.completedProjects) {
        const progressedSameDay = Boolean(item.progressedSameDay)
        if (progressedSameDay) dayProgress += 1
        completedProjects.push({
          projectId: item.projectId,
          title: item.title,
          parentPath: item.parentPath,
          shortId: item.shortId,
          completedDate: day.date,
          progressedSameDay,
        })
        const entry = upsertProject(item.projectId, item.title, item.parentPath, item.shortId, item.status)
        entry.completedDate = day.date
        if (progressedSameDay) entry.progressDates.add(day.date)
      }

      dayProgress += day.progressedProjects.length
      for (const item of day.progressedProjects) {
        const entry = upsertProject(item.projectId, item.title, item.parentPath, item.shortId, item.status)
        entry.progressDates.add(day.date)
      }

      completedProjectsCount += dayCompleted
      progressLogsCount += dayProgress
      if (dayCompleted > 0 || dayProgress > 0) activeDaysCount += 1

      for (const item of day.plannedReminders) {
        if (item.isPlannedAndCompletedSameDay) {
          dayCompletedReminderIds.add(item.reminder.id)
          if (!completedRemindersMap.has(item.reminder.id)) {
            completedRemindersMap.set(item.reminder.id, item)
          }
        }
      }
      for (const item of day.crossDayCompletedReminders) {
        dayCompletedReminderIds.add(item.reminder.id)
        if (!completedRemindersMap.has(item.reminder.id)) {
          completedRemindersMap.set(item.reminder.id, item)
        }
      }
    }

    for (const item of day.plannedReminders) {
      if (!plannedRemindersMap.has(item.reminder.id)) {
        plannedRemindersMap.set(item.reminder.id, item)
      }
    }

    dailyActivity.push({
      date: day.date,
      weekday: formatWeekdayShort(day.date),
      dayNumber: Number(day.date.slice(-2)),
      completedCount: dayCompleted,
      progressCount: dayProgress,
      remindersDoneCount: dayCompletedReminderIds.size,
      totalProjectCount: dayCompleted + dayProgress,
      isToday,
      isFuture,
      isWeekend,
    })
  }

  completedProjects.sort(
    (a, b) => b.completedDate.localeCompare(a.completedDate)
      || a.title.localeCompare(b.title)
      || a.projectId.localeCompare(b.projectId),
  )

  const projectBreakdown: RangeProjectBreakdownItem[] = Array.from(projectMap.values())
    .map((entry) => {
      const progressDates = Array.from(entry.progressDates).sort()
      const activeDates = new Set(progressDates)
      if (entry.completedDate) activeDates.add(entry.completedDate)
      return {
        projectId: entry.projectId,
        title: entry.title,
        parentPath: entry.parentPath,
        shortId: entry.shortId,
        status: entry.status,
        progressDates,
        completedDate: entry.completedDate,
        activeDayCount: activeDates.size,
      }
    })
    .sort((a, b) => {
      const byActive = b.activeDayCount - a.activeDayCount
      if (byActive !== 0) return byActive
      const byLogs = b.progressDates.length - a.progressDates.length
      if (byLogs !== 0) return byLogs
      const latestA = a.completedDate ?? a.progressDates[a.progressDates.length - 1] ?? ''
      const latestB = b.completedDate ?? b.progressDates[b.progressDates.length - 1] ?? ''
      const byLatest = latestB.localeCompare(latestA)
      if (byLatest !== 0) return byLatest
      return a.title.localeCompare(b.title) || a.projectId.localeCompare(b.projectId)
    })

  const reminderTiming: RangeReminderTiming = { onTime: 0, early: 0, late: 0 }
  const completedReminders = Array.from(completedRemindersMap.values()).sort((a, b) => {
    const byDate = (b.reminder.completedDate ?? '').localeCompare(a.reminder.completedDate ?? '')
    if (byDate !== 0) return byDate
    const byAction = (b.reminder.completedActionAt ?? '').localeCompare(a.reminder.completedActionAt ?? '')
    if (byAction !== 0) return byAction
    return a.reminder.id.localeCompare(b.reminder.id)
  })
  for (const item of completedReminders) {
    const timing = describeReminderCompletionTiming(item.reminder)
    if (!timing) continue
    if (timing.tone === 'on-time') reminderTiming.onTime += 1
    else if (timing.tone === 'early') reminderTiming.early += 1
    else reminderTiming.late += 1
  }

  const upcoming: ReminderDailyItem[] = []
  const overdueInRange: ReminderDailyItem[] = []
  const canceled: ReminderDailyItem[] = []

  for (const item of plannedRemindersMap.values()) {
    if (item.reminder.status === 'active') {
      if (item.reminder.scheduledDate < range.today) overdueInRange.push(item)
      else upcoming.push(item)
    } else if (item.reminder.status === 'canceled') {
      canceled.push(item)
    }
  }

  const sortByScheduledAsc = (a: ReminderDailyItem, b: ReminderDailyItem) =>
    a.reminder.scheduledDate.localeCompare(b.reminder.scheduledDate)
    || a.reminder.sortOrder - b.reminder.sortOrder
    || a.reminder.id.localeCompare(b.reminder.id)

  upcoming.sort(sortByScheduledAsc)
  overdueInRange.sort(sortByScheduledAsc)
  canceled.sort((a, b) =>
    b.reminder.scheduledDate.localeCompare(a.reminder.scheduledDate)
    || a.reminder.sortOrder - b.reminder.sortOrder
    || a.reminder.id.localeCompare(b.reminder.id),
  )

  return {
    totalDays: range.days.length,
    elapsedDays,
    completedProjectsCount,
    progressLogsCount,
    uniqueActiveProjectsCount: projectBreakdown.length,
    activeDaysCount,
    remindersDoneCount: completedReminders.length,
    remindersUpcomingCount: upcoming.length,
    remindersOverdueInRangeCount: overdueInRange.length,
    remindersCanceledCount: canceled.length,
    reminderTiming,
    dailyActivity,
    completedProjects,
    projectBreakdown,
    reminderGroups: {
      upcoming,
      overdueInRange,
      completed: completedReminders,
      canceled,
    },
  }
}

export function formatProjectParentSummary(parentPath: string[]): string {
  if (parentPath.length === 0) return ''
  if (parentPath.length === 1) return parentPath[0]
  if (parentPath.length === 2) return `${parentPath[0]} / ${parentPath[1]}`
  return `… / ${parentPath[parentPath.length - 1]}`
}
