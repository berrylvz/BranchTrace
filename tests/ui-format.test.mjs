import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDays,
  daysBetween,
  describeReminderCompletionTiming,
  formatFullDate,
  formatMonthDay,
  formatMonthLabel,
  formatOverdueDuration,
  formatShortDate,
  formatTrashTimestamp,
  formatWeekdayShort,
  formatWeekRange,
  getMonthCalendarLayout,
  getRecentWeekStarts,
  getWeekStart,
  groupProgressDatesByMonth,
  isWeekendDate,
  parseIsoDate,
  shiftMonth,
  toIsoDate,
} from '../src/ui-format.ts'

test('groupProgressDatesByMonth groups by descending year-month and sorts dates ascending within each month', () => {
  const groups = groupProgressDatesByMonth([
    '2026-09-12',
    '2026-11-09',
    '2026-11-03',
    '2026-11-09',
    '2026-10-01',
    '2025-12-28',
  ])
  assert.deepEqual(groups, [
    { monthKey: '2026-11', label: 'November 2026', dates: ['2026-11-03', '2026-11-09'] },
    { monthKey: '2026-10', label: 'October 2026', dates: ['2026-10-01'] },
    { monthKey: '2026-09', label: 'September 2026', dates: ['2026-09-12'] },
    { monthKey: '2025-12', label: 'December 2025', dates: ['2025-12-28'] },
  ])
  assert.deepEqual(groupProgressDatesByMonth([]), [])
})

test('formatWeekRange and date formatters output English dates and handle cross-year ranges', () => {
  assert.equal(formatWeekRange('2026-11-09', '2026-11-15'), 'Nov 9 – Nov 15, 2026')
  assert.equal(formatWeekRange('2025-12-29', '2026-01-04'), 'Dec 29, 2025 – Jan 4, 2026')
  assert.equal(formatMonthLabel('2026-11'), 'November 2026')
  assert.equal(formatMonthDay('2026-03-07'), 'Mar 7')
  assert.equal(formatFullDate('2026-03-07'), 'Mar 7, 2026')
  assert.equal(formatShortDate('2026-03-07'), '03/07')
  assert.equal(formatWeekdayShort('2026-11-22'), 'Sun')
  assert.equal(formatWeekdayShort('2026-11-16'), 'Mon')
})

test('getWeekStart resolves Monday for any day of the week including month/year boundaries', () => {
  assert.equal(getWeekStart('2026-11-16'), '2026-11-16') // Monday
  assert.equal(getWeekStart('2026-11-22'), '2026-11-16') // Sunday
  assert.equal(getWeekStart('2026-01-01'), '2025-12-29') // Cross-year Thursday
  assert.equal(getWeekStart('2026-11-01'), '2026-10-26') // Cross-month Sunday
})

test('formatTrashTimestamp produces compact YYYY/MM/DD HH:mm and falls back on invalid input', () => {
  const localIso = new Date(2026, 10, 9, 8, 5, 30).toISOString()
  assert.equal(formatTrashTimestamp(localIso), '2026/11/09 08:05')
  assert.equal(formatTrashTimestamp('not-a-date'), 'not-a-date')
})

test('isWeekendDate detects Saturday and Sunday accurately', () => {
  assert.equal(isWeekendDate('2026-11-09'), false) // Monday
  assert.equal(isWeekendDate('2026-11-13'), false) // Friday
  assert.equal(isWeekendDate('2026-11-14'), true) // Saturday
  assert.equal(isWeekendDate('2026-11-15'), true) // Sunday
})

test('date math helpers handle month, leap-year, and year boundaries', () => {
  assert.equal(toIsoDate(parseIsoDate('2026-03-07')), '2026-03-07')
  assert.equal(addDays('2025-12-30', 3), '2026-01-02')
  assert.equal(addDays('2026-01-02', -3), '2025-12-30')
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.equal(shiftMonth('2026-12', 1), '2027-01')

  const febLeap = getMonthCalendarLayout('2024-02')
  assert.equal(febLeap.leading, 3) // 2024-02-01 is Thursday (Mon=0..Thu=3)
  assert.equal(febLeap.dates.length, 29)
  assert.equal(febLeap.dates[0], '2024-02-01')
  assert.equal(febLeap.dates[28], '2024-02-29')

  const dec = getMonthCalendarLayout('2026-12')
  assert.equal(dec.leading, 1) // 2026-12-01 is Tuesday
  assert.equal(dec.dates.length, 31)
})

test('daysBetween, getRecentWeekStarts, completion timing, and overdue duration handle calendar boundaries', () => {
  assert.equal(daysBetween('2026-11-20', '2026-11-23'), 3)
  assert.equal(daysBetween('2026-11-25', '2026-11-23'), -2)
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2) // Leap year
  assert.equal(daysBetween('2025-12-30', '2026-01-02'), 3) // Cross year

  assert.deepEqual(getRecentWeekStarts('2026-11-24', 7), ['2026-11-16', '2026-11-23'])
  assert.deepEqual(getRecentWeekStarts('2026-11-29', 7), ['2026-11-23'])
  assert.deepEqual(getRecentWeekStarts('2026-11-24', 14), ['2026-11-09', '2026-11-16', '2026-11-23'])
  assert.deepEqual(getRecentWeekStarts('2026-01-03', 14), ['2025-12-15', '2025-12-22', '2025-12-29'])
  assert.equal(getRecentWeekStarts('2026-11-24', 30).length, 5)

  assert.deepEqual(
    describeReminderCompletionTiming({ status: 'completed', scheduledDate: '2026-11-23', completedDate: '2026-11-23' }),
    { label: 'Completed on time', shortLabel: 'On time', tone: 'on-time', deltaDays: 0 },
  )
  assert.deepEqual(
    describeReminderCompletionTiming({ status: 'completed', scheduledDate: '2026-11-25', completedDate: '2026-11-23' }),
    { label: 'Completed 2 days early', shortLabel: '2d early', tone: 'early', deltaDays: -2 },
  )
  assert.deepEqual(
    describeReminderCompletionTiming({ status: 'completed', scheduledDate: '2026-11-20', completedDate: '2026-11-23' }),
    { label: 'Completed 3 days late', shortLabel: '3d late', tone: 'late', deltaDays: 3 },
  )
  assert.equal(
    describeReminderCompletionTiming({ status: 'active', scheduledDate: '2026-11-23', completedDate: null }),
    null,
  )

  assert.equal(formatOverdueDuration('2026-11-23', '2026-11-24'), '1 day overdue')
  assert.equal(formatOverdueDuration('2026-11-20', '2026-11-24'), '4 days overdue')
})
