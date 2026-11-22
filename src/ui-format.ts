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

export interface ProgressMonthGroup {
  monthKey: string
  label: string
  dates: ISODate[]
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
  return WEEKDAY_SHORT_NAMES[new Date(`${date}T12:00:00`).getDay()]
}

export function getWeekStart(date: ISODate): ISODate {
  const parsed = new Date(`${date}T12:00:00`)
  const day = parsed.getDay() || 7
  parsed.setDate(parsed.getDate() - day + 1)
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const dayOfMonth = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${dayOfMonth}`
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
  const day = new Date(`${value}T12:00:00`).getDay()
  return day === 0 || day === 6
}
