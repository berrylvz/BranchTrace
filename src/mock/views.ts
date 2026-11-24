import type { DailyWeekDto, MonthCalendarDto, ProjectDailyItem, ReminderDailyItem } from '../types'
import { addDays, getWeekStart, parseIsoDate, todayIsoDate, toIsoDate } from '../ui-format.ts'
import {
  buildParentPath,
  mockFail,
  projectIsTrashed,
  reminderIsTrashed,
  sortedDates,
  treeOrder,
  validateIsoDate,
  validateMonth,
} from './store.ts'
import type { MockCommandHandler, MockState } from './store.ts'

function applyShortIds(completed: ProjectDailyItem[], progressed: ProjectDailyItem[]) {
  const all = [...completed, ...progressed]
  const groups = new Map<string, string[]>()
  for (const item of all) {
    const key = JSON.stringify([item.parentPath, item.title])
    const list = groups.get(key)
    if (list) list.push(item.projectId)
    else groups.set(key, [item.projectId])
  }
  for (const item of all) {
    const ids = groups.get(JSON.stringify([item.parentPath, item.title]))
    if (!ids || ids.length <= 1) continue
    const chars = [...item.projectId]
    let chosen = item.projectId
    for (let length = 1; length <= chars.length; length += 1) {
      const prefix = chars.slice(0, length).join('')
      const matches = ids.filter((other) => [...other].slice(0, length).join('') === prefix).length
      if (matches === 1) {
        chosen = prefix
        break
      }
    }
    item.shortId = chosen
  }
}

function comparePlanned(a: ReminderDailyItem, b: ReminderDailyItem) {
  return a.reminder.sortOrder - b.reminder.sortOrder || a.reminder.id.localeCompare(b.reminder.id)
}

function compareOverdue(a: ReminderDailyItem, b: ReminderDailyItem) {
  return a.reminder.scheduledDate.localeCompare(b.reminder.scheduledDate)
    || a.reminder.sortOrder - b.reminder.sortOrder
    || a.reminder.id.localeCompare(b.reminder.id)
}

function compareCrossDayCompleted(a: ReminderDailyItem, b: ReminderDailyItem) {
  return (a.reminder.completedActionAt ?? '').localeCompare(b.reminder.completedActionAt ?? '')
    || a.reminder.id.localeCompare(b.reminder.id)
}

function bucketReminders(
  state: MockState,
  today: string,
  dayIndexes: Map<string, number>,
  onPlanned: (dayIndex: number, item: ReminderDailyItem) => void,
  onCrossDayCompleted: (dayIndex: number, item: ReminderDailyItem) => void,
  onOverdue: (item: ReminderDailyItem) => void,
) {
  for (const reminder of state.reminders) {
    if (reminderIsTrashed(reminder.id, state)) continue
    const plannedIndex = dayIndexes.get(reminder.scheduledDate)
    if (plannedIndex !== undefined) {
      onPlanned(plannedIndex, {
        reminder: { ...reminder },
        displayType: 'planned',
        isPlannedAndCompletedSameDay: reminder.status === 'completed' && reminder.completedDate === reminder.scheduledDate,
      })
    }
    if (reminder.status === 'completed' && reminder.completedDate && reminder.completedDate !== reminder.scheduledDate) {
      const completedIndex = dayIndexes.get(reminder.completedDate)
      if (completedIndex !== undefined) {
        onCrossDayCompleted(completedIndex, {
          reminder: { ...reminder },
          displayType: 'completed',
          isPlannedAndCompletedSameDay: false,
        })
      }
    }
    if (reminder.status === 'active' && reminder.scheduledDate < today) {
      onOverdue({
        reminder: { ...reminder },
        displayType: 'overdue',
        isPlannedAndCompletedSameDay: false,
      })
    }
  }
}

function buildDailyWeek(state: MockState, weekStart: string): DailyWeekDto {
  const validatedStart = validateIsoDate(weekStart)
  if (parseIsoDate(validatedStart).getDay() !== 1) {
    mockFail('INVALID_DATE', 'Week start date must be a Monday')
  }
  const days: DailyWeekDto['days'] = Array.from({ length: 7 }, (_, offset) => ({
    date: addDays(validatedStart, offset),
    completedProjects: [],
    progressedProjects: [],
    plannedReminders: [],
    overdueReminders: [],
    crossDayCompletedReminders: [],
  }))
  const index = new Map(days.map((day, position) => [day.date, position]))
  const activeProjects = treeOrder(state.projects.filter((project) => !projectIsTrashed(project, state)))
  const byId = new Map(activeProjects.map((item) => [item.id, item]))
  for (const project of activeProjects) {
    const dates = sortedDates(state.progress[project.id])
    const base = {
      projectId: project.id,
      title: project.title,
      parentPath: buildParentPath(project, byId),
      shortId: null,
      status: project.status,
    }
    if (project.status === 'completed' && project.completedDate && index.has(project.completedDate)) {
      const day = days[index.get(project.completedDate)!]
      day.completedProjects.push({ ...base, progressedSameDay: dates.includes(project.completedDate) })
    }
    for (const progressDate of dates) {
      const dayIndex = index.get(progressDate)
      if (dayIndex === undefined) continue
      if (!(project.status === 'completed' && project.completedDate === progressDate)) {
        days[dayIndex].progressedProjects.push({ ...base })
      }
    }
  }

  const today = todayIsoDate()
  const todayIndex = index.get(today)
  bucketReminders(
    state,
    today,
    index,
    (dayIndex, item) => days[dayIndex].plannedReminders.push(item),
    (dayIndex, item) => days[dayIndex].crossDayCompletedReminders.push(item),
    (item) => {
      if (todayIndex !== undefined) days[todayIndex].overdueReminders.push(item)
    },
  )

  for (const day of days) {
    day.completedProjects.sort((a, b) => a.title.localeCompare(b.title) || a.projectId.localeCompare(b.projectId))
    day.progressedProjects.sort((a, b) => a.title.localeCompare(b.title) || a.projectId.localeCompare(b.projectId))
    day.plannedReminders.sort(comparePlanned)
    day.overdueReminders.sort(compareOverdue)
    day.crossDayCompletedReminders.sort(compareCrossDayCompleted)
    applyShortIds(day.completedProjects, day.progressedProjects)
  }
  return { weekStart: validatedStart, today, days }
}

function buildMonthCalendar(state: MockState, month: string): MonthCalendarDto {
  const validatedMonth = validateMonth(month)
  const [year, monthNumber] = validatedMonth.split('-').map(Number)
  const firstDay = `${validatedMonth}-01`
  const lastDate = new Date(year, monthNumber, 0, 12)
  const lastDay = toIsoDate(lastDate)
  const gridStart = getWeekStart(firstDay)
  const lastWeekday = lastDate.getDay() || 7
  const gridEnd = addDays(lastDay, 7 - lastWeekday)

  const days: MonthCalendarDto['days'] = []
  let cursor = gridStart
  while (cursor <= gridEnd) {
    days.push({
      date: cursor,
      inCurrentMonth: cursor.startsWith(validatedMonth),
      completedProjectCount: 0,
      progressedProjectCount: 0,
      plannedReminders: [],
      crossDayCompletedReminders: [],
    })
    cursor = addDays(cursor, 1)
  }

  const index = new Map(days.map((day, position) => [day.date, position]))
  const activeProjects = state.projects.filter((project) => !projectIsTrashed(project, state))
  for (const project of activeProjects) {
    const completedOn = project.status === 'completed' ? project.completedDate : null
    if (completedOn && index.has(completedOn)) {
      days[index.get(completedOn)!].completedProjectCount += 1
    }
    for (const progressDate of sortedDates(state.progress[project.id])) {
      const dayIndex = index.get(progressDate)
      if (dayIndex === undefined) continue
      if (completedOn !== progressDate) {
        days[dayIndex].progressedProjectCount += 1
      }
    }
  }

  const today = todayIsoDate()
  const overdueReminders: ReminderDailyItem[] = []
  bucketReminders(
    state,
    today,
    index,
    (dayIndex, item) => days[dayIndex].plannedReminders.push(item),
    (dayIndex, item) => days[dayIndex].crossDayCompletedReminders.push(item),
    (item) => overdueReminders.push(item),
  )

  for (const day of days) {
    day.plannedReminders.sort(comparePlanned)
    day.crossDayCompletedReminders.sort(compareCrossDayCompleted)
  }
  overdueReminders.sort(compareOverdue)

  return { month: validatedMonth, gridStart, gridEnd, today, overdueReminders, days }
}

export const viewHandlers: Record<string, MockCommandHandler> = {
  get_clock_context: () => {
    const today = todayIsoDate()
    return { today, weekStart: getWeekStart(today), timeZoneLabel: Intl.DateTimeFormat().resolvedOptions().timeZone }
  },
  get_daily_week: (_store, state, args) => buildDailyWeek(state, String(args.weekStart)),
  get_month_calendar: (_store, state, args) => buildMonthCalendar(state, String(args.month)),
}
