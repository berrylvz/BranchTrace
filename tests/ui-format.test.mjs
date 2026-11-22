import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatFullDate,
  formatMonthDay,
  formatMonthLabel,
  formatShortDate,
  formatTrashTimestamp,
  formatWeekdayShort,
  formatWeekRange,
  getWeekStart,
  groupProgressDatesByMonth,
  isWeekendDate,
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
