import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeCellReminderVisibility,
  computeMonthCellMetrics,
  computeOverdueStripLayout,
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
