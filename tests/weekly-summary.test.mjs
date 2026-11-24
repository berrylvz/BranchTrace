import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeWeeklyOverview,
  extractWeeklyOverdue,
  formatProjectParentSummary,
} from '../src/weekly-summary.ts'

const emptyDay = (date) => ({
  date,
  completedProjects: [],
  progressedProjects: [],
  plannedReminders: [],
  overdueReminders: [],
  crossDayCompletedReminders: [],
})

test('computeWeeklyOverview deduplicates cross-day reminders, distinguishes same-day progress, and excludes future activity', () => {
  const mon = {
    ...emptyDay('2026-11-23'),
    completedProjects: [
      { projectId: 'p1', title: 'Done + Progressed', parentPath: [], shortId: null, status: 'completed', progressedSameDay: true },
      { projectId: 'p2', title: 'Done only', parentPath: [], shortId: null, status: 'completed', progressedSameDay: false },
    ],
    progressedProjects: [
      { projectId: 'p3', title: 'Active progress', parentPath: [], shortId: null, status: 'active' },
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
    ],
  }

  const tue = {
    ...emptyDay('2026-11-24'),
    progressedProjects: [
      { projectId: 'p3', title: 'Active progress', parentPath: [], shortId: null, status: 'active' },
    ],
    plannedReminders: [
      {
        reminder: { id: 'r-today', title: 'Due today', scheduledDate: '2026-11-24', status: 'active', completedDate: null, completedActionAt: null, canceledDate: null, sortOrder: 1024, version: 0 },
        displayType: 'planned',
        isPlannedAndCompletedSameDay: false,
      },
    ],
    overdueReminders: [
      {
        reminder: { id: 'r-overdue', title: 'Old task', scheduledDate: '2026-11-20', status: 'active', completedDate: null, completedActionAt: null, canceledDate: null, sortOrder: 1024, version: 0 },
        displayType: 'overdue',
        isPlannedAndCompletedSameDay: false,
      },
    ],
    crossDayCompletedReminders: [
      {
        reminder: { id: 'r-cross', title: 'Planned Mon done Tue', scheduledDate: '2026-11-23', status: 'completed', completedDate: '2026-11-24', completedActionAt: '2026-11-24T10:00:00Z', canceledDate: null, sortOrder: 2048, version: 1 },
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
    ],
  }

  const weekly = {
    weekStart: '2026-11-23',
    today: '2026-11-24',
    days: [
      mon,
      tue,
      wed,
      emptyDay('2026-11-26'),
      emptyDay('2026-11-27'),
      emptyDay('2026-11-28'),
      emptyDay('2026-11-29'),
    ],
  }

  const overview = computeWeeklyOverview(weekly)
  assert.equal(overview.completedProjects, 2)
  assert.equal(overview.progressLogs, 3) // p1 (same day) + p3 (Mon) + p3 (Tue)
  assert.equal(overview.activeDays, 2) // Mon + Tue
  assert.equal(overview.remindersDone, 2) // r-same + r-cross (deduplicated)
  assert.equal(overview.upcomingReminders, 2) // r-today + r-future (excludes overdue)
  assert.equal(overview.dailyActivity.length, 7)
  assert.equal(overview.dailyActivity[0].completedCount, 2)
  assert.equal(overview.dailyActivity[0].progressCount, 2)
  assert.equal(overview.dailyActivity[1].isToday, true)
  assert.equal(overview.dailyActivity[2].isFuture, true)

  const overdue = extractWeeklyOverdue(weekly)
  assert.equal(overdue.length, 1)
  assert.equal(overdue[0].item.reminder.id, 'r-overdue')
  assert.equal(overdue[0].overdueDays, 4)

  // Historical week has no today column -> no current overdue mixed in
  const historical = { ...weekly, weekStart: '2026-11-09', days: [emptyDay('2026-11-09')] }
  assert.deepEqual(extractWeeklyOverdue(historical), [])
})

test('formatProjectParentSummary keeps short paths readable and condenses deep breadcrumbs', () => {
  assert.equal(formatProjectParentSummary([]), '')
  assert.equal(formatProjectParentSummary(['Work']), 'Work')
  assert.equal(formatProjectParentSummary(['Work', 'Release']), 'Work / Release')
  assert.equal(formatProjectParentSummary(['Work', 'Backend', 'SQLite']), '… / SQLite')
})
