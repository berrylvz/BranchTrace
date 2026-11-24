import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildActivityTimeline,
  buildProgressDatesMapFromWeeks,
  collectAncestorIds,
  filterProjectTree,
  isProjectInactive,
} from '../src/project-filters.ts'

const makeProject = (overrides) => ({
  id: 'p1',
  parentId: null,
  title: 'Project',
  status: 'active',
  completedDate: null,
  canceledDate: null,
  sortOrder: 1024,
  version: 0,
  isExpanded: true,
  recentProgressDates: [],
  progressCount: 0,
  progressedToday: false,
  ...overrides,
})

test('filterProjectTree preserves ancestor chains and auto-expands without mutating persisted isExpanded', () => {
  const root = makeProject({ id: 'root', title: 'Platform', isExpanded: false })
  const mid = makeProject({ id: 'mid', parentId: 'root', title: 'Backend', isExpanded: false })
  const leaf = makeProject({ id: 'leaf', parentId: 'mid', title: 'SQLite Migration', progressedToday: true, recentProgressDates: ['2026-11-24'], progressCount: 1 })
  const other = makeProject({ id: 'other', title: 'Unrelated' })

  const result = filterProjectTree([root, mid, leaf, other], {
    query: 'sqlite',
    filter: 'all',
    today: '2026-11-24',
    inactiveDays: 14,
  })

  assert.equal(result.isFiltered, true)
  assert.equal(result.directMatchCount, 1)
  assert.deepEqual(result.filteredProjects.map((p) => p.id), ['root', 'mid', 'leaf'])
  assert.deepEqual([...result.ancestorIds].sort(), ['mid', 'root'])
  assert.deepEqual([...result.tempExpandedIds].sort(), ['mid', 'root'])
  assert.equal(root.isExpanded, false)
  assert.equal(mid.isExpanded, false)
  assert.deepEqual(collectAncestorIds([root, mid, leaf, other], 'leaf'), ['root', 'mid'])
})

test('isProjectInactive respects configurable thresholds and excludes completed or canceled projects', () => {
  const today = '2026-11-24'
  const fresh = makeProject({ id: 'fresh', recentProgressDates: ['2026-11-20'], progressCount: 1 })
  const tenDaysAgo = makeProject({ id: 'stale10', recentProgressDates: ['2026-11-14'], progressCount: 2 })
  const neverLogged = makeProject({ id: 'never', recentProgressDates: [], progressCount: 0 })
  const completed = makeProject({ id: 'done', status: 'completed', completedDate: '2026-10-01', recentProgressDates: ['2026-10-01'], progressCount: 1 })
  const canceled = makeProject({ id: 'canceled', status: 'canceled', canceledDate: '2026-10-01' })

  assert.equal(isProjectInactive(fresh, today, 7), false)
  assert.equal(isProjectInactive(tenDaysAgo, today, 7), true)
  assert.equal(isProjectInactive(tenDaysAgo, today, 14), false)
  assert.equal(isProjectInactive(neverLogged, today, 30), true)
  assert.equal(isProjectInactive(completed, today, 7), false)
  assert.equal(isProjectInactive(canceled, today, 7), false)

  const filtered = filterProjectTree([fresh, tenDaysAgo, neverLogged, completed, canceled], {
    query: '',
    filter: 'inactive',
    today,
    inactiveDays: 7,
  })
  assert.deepEqual(filtered.filteredProjects.map((p) => p.id), ['stale10', 'never'])
})

test('buildActivityTimeline merges week cache and recentProgressDates with binary cells and no future dates', () => {
  const project = makeProject({
    id: 'p-track',
    status: 'completed',
    completedDate: '2026-11-23',
    recentProgressDates: ['2026-11-22', '2026-11-23'],
    progressCount: 4,
    progressedToday: false,
  })

  const weeks = [{
    weekStart: '2026-11-16',
    today: '2026-11-24',
    days: [
      {
        date: '2026-11-18',
        completedProjects: [],
        progressedProjects: [{ projectId: 'p-track', title: 'Track', parentPath: [], shortId: null, status: 'completed' }],
        plannedReminders: [],
        overdueReminders: [],
        crossDayCompletedReminders: [],
      },
      {
        date: '2026-11-23',
        completedProjects: [{ projectId: 'p-track', title: 'Track', parentPath: [], shortId: null, status: 'completed', progressedSameDay: true }],
        progressedProjects: [],
        plannedReminders: [],
        overdueReminders: [],
        crossDayCompletedReminders: [],
      },
    ],
  }]

  const progressMap = buildProgressDatesMapFromWeeks(weeks)
  const cells = buildActivityTimeline(project, '2026-11-24', 7, progressMap)

  assert.equal(cells.length, 7)
  assert.equal(cells[0].date, '2026-11-18')
  assert.equal(cells[6].date, '2026-11-24')
  assert.equal(cells[6].isToday, true)
  assert.equal(cells.find((c) => c.date === '2026-11-18')?.hasProgress, true)
  assert.equal(cells.find((c) => c.date === '2026-11-22')?.hasProgress, true)
  assert.equal(cells.find((c) => c.date === '2026-11-23')?.hasProgress, true)
  assert.equal(cells.find((c) => c.date === '2026-11-23')?.isCompletedDay, true)
  assert.equal(cells.find((c) => c.date === '2026-11-19')?.hasProgress, false)
  assert.equal(cells.find((c) => c.date === '2026-11-17'), undefined)
})
