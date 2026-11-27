import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRangePreset,
  computeRangeSummary,
  detectRangePreset,
  formatProjectParentSummary,
  MAX_RANGE_DAYS,
  normalizeDateRange,
  shiftDateRange,
  shiftRangeToLatest,
} from '../src/range-summary.ts'

const emptyDay = (date) => ({
  date,
  completedProjects: [],
  progressedProjects: [],
  plannedReminders: [],
  overdueReminders: [],
  crossDayCompletedReminders: [],
})

test('normalizeDateRange handles reversed bounds and clamps ranges above 30 days', () => {
  assert.deepEqual(normalizeDateRange('2026-11-20', '2026-11-27', 'end'), {
    startDate: '2026-11-20',
    endDate: '2026-11-27',
    dayCount: 8,
    clamped: false,
  })

  // Exact 30-day inclusive window is allowed without clamping
  assert.deepEqual(normalizeDateRange('2026-11-01', '2026-11-30', 'start'), {
    startDate: '2026-11-01',
    endDate: '2026-11-30',
    dayCount: MAX_RANGE_DAYS,
    clamped: false,
  })

  // 31-day span clamps end when anchored to start, and start when anchored to end
  assert.deepEqual(normalizeDateRange('2026-11-01', '2026-12-01', 'start'), {
    startDate: '2026-11-01',
    endDate: '2026-11-30',
    dayCount: MAX_RANGE_DAYS,
    clamped: true,
  })
  assert.deepEqual(normalizeDateRange('2026-11-01', '2026-12-01', 'end'), {
    startDate: '2026-11-02',
    endDate: '2026-12-01',
    dayCount: MAX_RANGE_DAYS,
    clamped: true,
  })

  // Reversed dates collapse to a 1-day range on the active anchor
  assert.deepEqual(normalizeDateRange('2026-11-25', '2026-11-20', 'start'), {
    startDate: '2026-11-25',
    endDate: '2026-11-25',
    dayCount: 1,
    clamped: false,
  })
  assert.deepEqual(normalizeDateRange('2026-11-25', '2026-11-20', 'end'), {
    startDate: '2026-11-20',
    endDate: '2026-11-20',
    dayCount: 1,
    clamped: false,
  })
})

test('range presets, detection, and shifting preserve span length accurately', () => {
  const today = '2026-11-27'
  const weekStart = '2026-11-23'

  assert.deepEqual(buildRangePreset('this-week', today, weekStart), { startDate: '2026-11-23', endDate: '2026-11-29' })
  assert.deepEqual(buildRangePreset('last-7', today, weekStart), { startDate: '2026-11-21', endDate: '2026-11-27' })
  assert.deepEqual(buildRangePreset('last-14', today, weekStart), { startDate: '2026-11-14', endDate: '2026-11-27' })
  assert.deepEqual(buildRangePreset('last-30', today, weekStart), { startDate: '2026-10-29', endDate: '2026-11-27' })

  assert.equal(detectRangePreset('2026-11-21', '2026-11-27', today, weekStart), 'last-7')
  assert.equal(detectRangePreset('2026-11-23', '2026-11-29', today, weekStart), 'this-week')
  assert.equal(detectRangePreset('2026-10-29', '2026-11-27', today, weekStart), 'last-30')
  assert.equal(detectRangePreset('2026-11-10', '2026-11-20', today, weekStart), null)

  assert.deepEqual(shiftDateRange('2026-11-14', '2026-11-27', -1), { startDate: '2026-10-31', endDate: '2026-11-13' })
  assert.deepEqual(shiftDateRange('2026-11-14', '2026-11-27', 1), { startDate: '2026-11-28', endDate: '2026-12-11' })
  assert.deepEqual(shiftRangeToLatest('2026-10-01', '2026-10-10', today), { startDate: '2026-11-18', endDate: '2026-11-27' })
})

test('computeRangeSummary aggregates projects, deduplicates cross-day reminders, tracks timing, and excludes future activity', () => {
  const mon = {
    ...emptyDay('2026-11-23'),
    completedProjects: [
      { projectId: 'p1', title: 'Done + Progressed', parentPath: ['Work'], shortId: null, status: 'completed', progressedSameDay: true },
      { projectId: 'p2', title: 'Done only', parentPath: [], shortId: null, status: 'completed', progressedSameDay: false },
    ],
    progressedProjects: [
      { projectId: 'p3', title: 'Active progress', parentPath: ['Study'], shortId: null, status: 'active' },
    ],
    plannedReminders: [
      {
        reminder: { id: 'r-same', title: 'Done Mon', scheduledDate: '2026-11-23', status: 'completed', completedDate: '2026-11-23', completedActionAt: '2026-11-23T10:00:00Z', canceledDate: null, sortOrder: 1024, version: 1 },
        displayType: 'planned',
        isPlannedAndCompletedSameDay: true,
      },
      {
        reminder: { id: 'r-cross', title: 'Planned Mon done Tue', scheduledDate: '2026-11-23', status: 'completed', completedDate: '2026-11-24', completedActionAt: '2026-11-24T10:00:00Z', canceledDate: null, sortOrder: 2048, version: 1 },
        displayType: 'planned',
        isPlannedAndCompletedSameDay: false,
      },
      {
        reminder: { id: 'r-overdue-in-range', title: 'Missed Mon', scheduledDate: '2026-11-23', status: 'active', completedDate: null, completedActionAt: null, canceledDate: null, sortOrder: 3072, version: 0 },
        displayType: 'planned',
        isPlannedAndCompletedSameDay: false,
      },
    ],
  }

  const tue = {
    ...emptyDay('2026-11-24'),
    progressedProjects: [
      { projectId: 'p3', title: 'Active progress', parentPath: ['Study'], shortId: null, status: 'active' },
    ],
    plannedReminders: [
      {
        reminder: { id: 'r-today', title: 'Due today', scheduledDate: '2026-11-24', status: 'active', completedDate: null, completedActionAt: null, canceledDate: null, sortOrder: 1024, version: 0 },
        displayType: 'planned',
        isPlannedAndCompletedSameDay: false,
      },
    ],
    crossDayCompletedReminders: [
      {
        reminder: { id: 'r-cross', title: 'Planned Mon done Tue', scheduledDate: '2026-11-23', status: 'completed', completedDate: '2026-11-24', completedActionAt: '2026-11-24T10:00:00Z', canceledDate: null, sortOrder: 2048, version: 1 },
        displayType: 'completed',
        isPlannedAndCompletedSameDay: false,
      },
      {
        reminder: { id: 'r-early', title: 'Planned Wed done Tue', scheduledDate: '2026-11-25', status: 'completed', completedDate: '2026-11-24', completedActionAt: '2026-11-24T11:00:00Z', canceledDate: null, sortOrder: 1024, version: 1 },
        displayType: 'completed',
        isPlannedAndCompletedSameDay: false,
      },
    ],
  }

  const wed = {
    ...emptyDay('2026-11-25'),
    plannedReminders: [
      {
        reminder: { id: 'r-future', title: 'Due Wed', scheduledDate: '2026-11-25', status: 'active', completedDate: null, completedActionAt: null, canceledDate: null, sortOrder: 1024, version: 0 },
        displayType: 'planned',
        isPlannedAndCompletedSameDay: false,
      },
      {
        reminder: { id: 'r-canceled', title: 'Canceled Wed', scheduledDate: '2026-11-25', status: 'canceled', completedDate: null, completedActionAt: null, canceledDate: '2026-11-24', sortOrder: 2048, version: 1 },
        displayType: 'planned',
        isPlannedAndCompletedSameDay: false,
      },
    ],
  }

  const range = {
    startDate: '2026-11-23',
    endDate: '2026-11-25',
    today: '2026-11-24',
    overdueReminders: [],
    days: [mon, tue, wed],
  }

  const summary = computeRangeSummary(range)
  assert.equal(summary.totalDays, 3)
  assert.equal(summary.elapsedDays, 2)
  assert.equal(summary.completedProjectsCount, 2)
  assert.equal(summary.progressLogsCount, 3) // p1 same day + p3 Mon + p3 Tue
  assert.equal(summary.activeDaysCount, 2) // Mon + Tue
  assert.equal(summary.uniqueActiveProjectsCount, 3) // p1, p2, p3

  // Project breakdown ranks p3 first (2 active days)
  assert.equal(summary.projectBreakdown[0].projectId, 'p3')
  assert.equal(summary.projectBreakdown[0].activeDayCount, 2)
  assert.deepEqual(summary.projectBreakdown[0].progressDates, ['2026-11-23', '2026-11-24'])

  // Completed reminders deduplicated: r-same (on-time), r-cross (1d late), r-early (1d early)
  assert.equal(summary.remindersDoneCount, 3)
  assert.deepEqual(summary.reminderTiming, { onTime: 1, early: 1, late: 1 })
  assert.equal(summary.remindersUpcomingCount, 2) // r-today + r-future
  assert.equal(summary.remindersOverdueInRangeCount, 1) // r-overdue-in-range
  assert.equal(summary.remindersCanceledCount, 1) // r-canceled

  assert.equal(summary.dailyActivity.length, 3)
  assert.equal(summary.dailyActivity[0].completedCount, 2)
  assert.equal(summary.dailyActivity[0].progressCount, 2)
  assert.equal(summary.dailyActivity[1].isToday, true)
  assert.equal(summary.dailyActivity[2].isFuture, true)
})

test('formatProjectParentSummary keeps short paths readable and condenses deep breadcrumbs', () => {
  assert.equal(formatProjectParentSummary([]), '')
  assert.equal(formatProjectParentSummary(['Work']), 'Work')
  assert.equal(formatProjectParentSummary(['Work', 'Release']), 'Work / Release')
  assert.equal(formatProjectParentSummary(['Work', 'Backend', 'SQLite']), '… / SQLite')
})
