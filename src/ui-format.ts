import type { ISODate } from './types'

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

const MONTH_SHORT_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

const WEEKDAY_SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export interface ProgressMonthGroup {
  monthKey: string
  label: string
  dates: ISODate[]
}

export interface MonthCalendarLayout {
  leading: number
  dates: ISODate[]
}

export function parseIsoDate(value: ISODate): Date {
  return new Date(`${value}T12:00:00`)
}

export function toIsoDate(date: Date): ISODate {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayIsoDate(): ISODate {
  return toIsoDate(new Date())
}

export function addDays(date: ISODate, days: number): ISODate {
  const parsed = parseIsoDate(date)
  parsed.setDate(parsed.getDate() + days)
  return toIsoDate(parsed)
}

export function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number)
  const next = new Date(year, month - 1 + delta, 1, 12)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
}

export function getMonthCalendarLayout(monthKey: string): MonthCalendarLayout {
  const [year, monthNumber] = monthKey.split('-').map(Number)
  const monthIndex = monthNumber - 1
  const leading = (new Date(year, monthIndex, 1).getDay() || 7) - 1
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const dates = Array.from({ length: daysInMonth }, (_, index) => `${monthKey}-${String(index + 1).padStart(2, '0')}`)
  return { leading, dates }
}

export function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-')
  const monthIndex = Number(month) - 1
  const monthName = MONTH_NAMES[monthIndex]
  return monthName ? `${monthName} ${year}` : monthKey
}

export function formatMonthDay(date: ISODate) {
  const [, month, day] = date.split('-')
  const monthName = MONTH_SHORT_NAMES[Number(month) - 1]
  return monthName ? `${monthName} ${Number(day)}` : date
}

export function formatFullDate(date: ISODate) {
  const [year, month, day] = date.split('-')
  const monthName = MONTH_SHORT_NAMES[Number(month) - 1]
  return monthName ? `${monthName} ${Number(day)}, ${year}` : date
}

export function formatWeekdayShort(date: ISODate) {
  return WEEKDAY_SHORT_NAMES[parseIsoDate(date).getDay()]
}

export function getWeekStart(date: ISODate): ISODate {
  const parsed = parseIsoDate(date)
  const day = parsed.getDay() || 7
  parsed.setDate(parsed.getDate() - day + 1)
  return toIsoDate(parsed)
}

export function groupProgressDatesByMonth(dates: ISODate[]): ProgressMonthGroup[] {
  const unique = Array.from(new Set(dates)).sort()
  const grouped = new Map<string, ISODate[]>()
  for (const date of unique) {
    const monthKey = date.slice(0, 7)
    const bucket = grouped.get(monthKey)
    if (bucket) bucket.push(date)
    else grouped.set(monthKey, [date])
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([monthKey, monthDates]) => ({
      monthKey,
      label: formatMonthLabel(monthKey),
      dates: monthDates,
    }))
}

export function formatShortDate(date: ISODate) {
  return date.slice(5).replace('-', '/')
}

export function formatWeekRange(weekStart: ISODate, weekEnd: ISODate) {
  const startYear = weekStart.slice(0, 4)
  const endYear = weekEnd.slice(0, 4)
  if (startYear !== endYear) {
    return `${formatFullDate(weekStart)} – ${formatFullDate(weekEnd)}`
  }
  return `${formatMonthDay(weekStart)} – ${formatMonthDay(weekEnd)}, ${startYear}`
}

export function formatTrashTimestamp(isoString: string) {
  const parsed = new Date(isoString)
  if (Number.isNaN(parsed.getTime())) return isoString
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  const hours = String(parsed.getHours()).padStart(2, '0')
  const minutes = String(parsed.getMinutes()).padStart(2, '0')
  return `${year}/${month}/${day} ${hours}:${minutes}`
}

export function isWeekendDate(value: ISODate) {
  const day = parseIsoDate(value).getDay()
  return day === 0 || day === 6
}
