import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeCellReminderVisibility,
  computeMonthCellMetrics,
  computeOverdueStripLayout,
  getCellRemindersForDisplayMode,
  getMonthWeekCount,
} from '../src/monthly-layout.ts'

test('getMonthWeekCount computes 4, 5, or 6 calendar rows accurately', () => {
  assert.equal(getMonthWeekCount(28), 4)
  assert.equal(getMonthWeekCount(35), 5)
  assert.equal(getMonthWeekCount(42), 6)
  assert.equal(getMonthWeekCount(0), 5)
})

test('computeMonthCellMetrics selects responsive density tiers and width flags', () => {
  const wideTall = computeMonthCellMetrics(198, 120)
  assert.equal(wideTall.density, 'comfortable')
  assert.equal(wideTall.inlineStats, true)
  assert.equal(wideTall.inlineStatsWithToday, true)
  assert.equal(wideTall.showDateHint, true)
  assert.equal(wideTall.compactDetails, false)

  const laptop = computeMonthCellMetrics(176, 92)
  assert.equal(laptop.density, 'cozy')
  assert.equal(laptop.inlineStats, true)
  assert.equal(laptop.inlineStatsWithToday, false)
  assert.equal(laptop.showDateHint, true)
  assert.equal(laptop.compactDetails, false)

  const midWidth = computeMonthCellMetrics(150, 92)
  assert.equal(midWidth.density, 'cozy')
  assert.equal(midWidth.inlineStats, false)
  assert.equal(midWidth.inlineStatsWithToday, false)
  assert.equal(midWidth.showDateHint, false)
  assert.equal(midWidth.compactDetails, false)

  const minWindow = computeMonthCellMetrics(121, 70)
  assert.equal(minWindow.density, 'compact')
  assert.equal(minWindow.inlineStats, false)
  assert.equal(minWindow.showDateHint, false)
  assert.equal(minWindow.compactDetails, false)

  const narrow = computeMonthCellMetrics(95, 68)
  assert.equal(narrow.compactDetails, true)
})

test('computeCellReminderVisibility fits items without overflow and reserves room for +N more', () => {
  // 1440x920 with 6-row month and overdue bar (~115px cell height, inline stats)
  const metrics = computeMonthCellMetrics(198, 115)
  assert.deepEqual(computeCellReminderVisibility(0, 115, false, metrics), {
    visibleCount: 0,
    hiddenCount: 0,
    showMoreRow: false,
    showHeaderReminderCount: false,
  })
  assert.deepEqual(computeCellReminderVisibility(3, 115, false, metrics), {
    visibleCount: 3,
    hiddenCount: 0,
    showMoreRow: false,
    showHeaderReminderCount: false,
  })
  assert.deepEqual(computeCellReminderVisibility(5, 115, false, metrics), {
    visibleCount: 2,
    hiddenCount: 3,
    showMoreRow: true,
    showHeaderReminderCount: false,
  })
})

test('computeCellReminderVisibility adapts on minimum height windows with separate stats rows', () => {
  // 900x620 with 6-row month and overdue bar (~71px cell height)
  const metrics = computeMonthCellMetrics(121, 71)
  // Without separate stats row: innerHeight=61, avail=40 -> fits 2 items or 1 item + more
  assert.deepEqual(computeCellReminderVisibility(2, 71, false, metrics), {
    visibleCount: 2,
    hiddenCount: 0,
    showMoreRow: false,
    showHeaderReminderCount: false,
  })
  assert.deepEqual(computeCellReminderVisibility(4, 71, false, metrics), {
    visibleCount: 1,
    hiddenCount: 3,
    showMoreRow: true,
    showHeaderReminderCount: false,
  })

  // With separate stats row: avail=22 -> fits 1 item, or shows "5 reminders" summary pill
  assert.deepEqual(computeCellReminderVisibility(1, 71, true, metrics), {
    visibleCount: 1,
    hiddenCount: 0,
    showMoreRow: false,
    showHeaderReminderCount: false,
  })
  assert.deepEqual(computeCellReminderVisibility(5, 71, true, metrics), {
    visibleCount: 0,
    hiddenCount: 5,
    showMoreRow: true,
    showHeaderReminderCount: false,
  })

  // Ultra-short extreme viewport (~46px cell): collapses reminder indicator into header badge
  const tinyMetrics = computeMonthCellMetrics(121, 46)
  assert.deepEqual(computeCellReminderVisibility(3, 46, true, tinyMetrics), {
    visibleCount: 0,
    hiddenCount: 3,
    showMoreRow: false,
    showHeaderReminderCount: true,
  })
})

test('computeOverdueStripLayout fits single-row overdue items and switches to +N more on overflow', () => {
  assert.deepEqual(computeOverdueStripLayout(0, 1190), { visibleCount: 0, hiddenCount: 0 })
  assert.deepEqual(computeOverdueStripLayout(3, 1190), { visibleCount: 3, hiddenCount: 0 })
  assert.deepEqual(computeOverdueStripLayout(5, 1190), { visibleCount: 5, hiddenCount: 0 })
  assert.deepEqual(computeOverdueStripLayout(6, 1190), { visibleCount: 4, hiddenCount: 2 })
  assert.deepEqual(computeOverdueStripLayout(3, 650), { visibleCount: 2, hiddenCount: 1 })
  assert.deepEqual(computeOverdueStripLayout(3, 180), { visibleCount: 0, hiddenCount: 3 })
})

test('getCellRemindersForDisplayMode filters Planned, Actual, and Both without duplicate reminder IDs', () => {
  const day = {
    plannedReminders: [
      {
        reminder: { id: 'r-active', title: 'Active', scheduledDate: '2026-11-24', status: 'active', completedDate: null, completedActionAt: null, canceledDate: null, sortOrder: 1024, version: 0 },
        displayType: 'planned',
        isPlannedAndCompletedSameDay: false,
      },
      {
        reminder: { id: 'r-same-done', title: 'Done same day', scheduledDate: '2026-11-24', status: 'completed', completedDate: '2026-11-24', completedActionAt: '2026-11-24T10:00:00Z', canceledDate: null, sortOrder: 2048, version: 1 },
        displayType: 'planned',
        isPlannedAndCompletedSameDay: true,
      },
      {
        reminder: { id: 'r-done-other', title: 'Done later', scheduledDate: '2026-11-24', status: 'completed', completedDate: '2026-11-26', completedActionAt: '2026-11-26T10:00:00Z', canceledDate: null, sortOrder: 3072, version: 1 },
        displayType: 'planned',
        isPlannedAndCompletedSameDay: false,
      },
    ],
    crossDayCompletedReminders: [
      {
        reminder: { id: 'r-cross', title: 'Planned earlier', scheduledDate: '2026-11-20', status: 'completed', completedDate: '2026-11-24', completedActionAt: '2026-11-24T09:00:00Z', canceledDate: null, sortOrder: 1024, version: 1 },
        displayType: 'completed',
        isPlannedAndCompletedSameDay: false,
      },
    ],
  }

  assert.deepEqual(
    getCellRemindersForDisplayMode(day, 'both').map((e) => e.item.reminder.id),
    ['r-active', 'r-same-done', 'r-done-other', 'r-cross'],
  )
  assert.deepEqual(
    getCellRemindersForDisplayMode(day, 'planned').map((e) => e.item.reminder.id),
    ['r-active', 'r-same-done', 'r-done-other'],
  )
  assert.deepEqual(
    getCellRemindersForDisplayMode(day, 'actual').map((e) => e.item.reminder.id),
    ['r-same-done', 'r-cross'],
  )
})
