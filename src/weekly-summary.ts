import type { DailyWeekDto, ISODate, ReminderDailyItem } from './types'
import { daysBetween, formatWeekdayShort } from './ui-format.ts'

export interface DailyActivityBar {
  date: ISODate
  weekday: string
  completedCount: number
  progressCount: number
  totalCount: number
  isToday: boolean
  isFuture: boolean
}

export interface WeeklyOverviewStats {
  completedProjects: number
  progressLogs: number
  activeDays: number
  remindersDone: number
  upcomingReminders: number
  dailyActivity: DailyActivityBar[]
}

export interface WeeklyOverdueEntry {
  item: ReminderDailyItem
  overdueDays: number
}

export function computeWeeklyOverview(weekly: DailyWeekDto): WeeklyOverviewStats {
  let completedProjects = 0
  let progressLogs = 0
  let activeDays = 0
  let upcomingReminders = 0
  const completedReminderIds = new Set<string>()
  const dailyActivity: DailyActivityBar[] = []

  for (const day of weekly.days) {
    const isFuture = day.date > weekly.today
    const isToday = day.date === weekly.today

    const dayCompleted = isFuture ? 0 : day.completedProjects.length
    const sameDayProgressed = isFuture
      ? 0
      : day.completedProjects.filter((item) => item.progressedSameDay).length
    const dayProgress = isFuture ? 0 : day.progressedProjects.length + sameDayProgressed

    completedProjects += dayCompleted
    progressLogs += dayProgress
    if (!isFuture && (dayCompleted > 0 || dayProgress > 0)) {
      activeDays += 1
    }

    if (!isFuture) {
      for (const item of day.plannedReminders) {
        if (item.isPlannedAndCompletedSameDay) {
          completedReminderIds.add(item.reminder.id)
        }
      }
      for (const item of day.crossDayCompletedReminders) {
        completedReminderIds.add(item.reminder.id)
      }
    }

    for (const item of day.plannedReminders) {
      if (item.reminder.status === 'active' && item.reminder.scheduledDate >= weekly.today) {
        upcomingReminders += 1
      }
    }

    dailyActivity.push({
      date: day.date,
      weekday: formatWeekdayShort(day.date),
      completedCount: dayCompleted,
      progressCount: dayProgress,
      totalCount: dayCompleted + dayProgress,
      isToday,
      isFuture,
    })
  }

  return {
    completedProjects,
    progressLogs,
    activeDays,
    remindersDone: completedReminderIds.size,
    upcomingReminders,
    dailyActivity,
  }
}

export function extractWeeklyOverdue(weekly: DailyWeekDto): WeeklyOverdueEntry[] {
  const todayCol = weekly.days.find((day) => day.date === weekly.today)
  if (!todayCol || todayCol.overdueReminders.length === 0) return []
  return todayCol.overdueReminders.map((item) => ({
    item,
    overdueDays: Math.max(1, daysBetween(item.reminder.scheduledDate, weekly.today)),
  }))
}

export function formatProjectParentSummary(parentPath: string[]): string {
  if (parentPath.length === 0) return ''
  if (parentPath.length === 1) return parentPath[0]
  if (parentPath.length === 2) return `${parentPath[0]} / ${parentPath[1]}`
  return `… / ${parentPath[parentPath.length - 1]}`
}
