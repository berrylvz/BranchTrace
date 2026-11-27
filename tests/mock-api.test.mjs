import assert from 'node:assert/strict'
import test from 'node:test'

let moduleId = 0
async function createMockApi(initial = {}) {
  let saved = JSON.stringify({ projects: [], progress: {}, reminders: [], trash: [], themeMode: 'system', ...initial })
  let failSave = false
  globalThis.localStorage = {
    getItem: () => saved,
    setItem: (_key, value) => {
      if (failSave) throw new Error('模拟存储失败')
      saved = value
    },
  }
  const load = async () => (await import(`../src/api.ts?mock-api-test=${moduleId++}`)).api
  return {
    api: await load(),
    load,
    state: () => JSON.parse(saved),
    failSave: (next = true) => { failSave = next },
  }
}

function shiftDate(iso, days) {
  const date = new Date(`${iso}T12:00:00`)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

test('updateReminderCompletedDate updates completedDate via date param and preserves completedActionAt', async () => {
  const { api } = await createMockApi()
  const { today } = await api.getClockContext()
  const yesterday = shiftDate(today, -1)
  const tomorrow = shiftDate(today, 1)

  const created = await api.createReminder('写周报', today)
  const completed = await api.completeReminder(created.id, created.version)
  assert.equal(completed.status, 'completed')
  assert.equal(completed.completedDate, today)
  assert.ok(completed.completedActionAt)

  const updated = await api.updateReminderCompletedDate(completed.id, yesterday, completed.version)
  assert.equal(updated.completedDate, yesterday)
  assert.equal(updated.completedActionAt, completed.completedActionAt)
  assert.equal(updated.version, completed.version + 1)

  await assert.rejects(
    api.updateReminderCompletedDate(updated.id, tomorrow, updated.version),
    (error) => error.code === 'FUTURE_DATE_FORBIDDEN',
  )
})

test('setProjectProgress sorts historical dates ascending, validates state/future, and keeps version on no-op', async () => {
  const { api } = await createMockApi()
  const { today } = await api.getClockContext()
  const d1 = shiftDate(today, -5)
  const d2 = shiftDate(today, -3)
  const d3 = shiftDate(today, -1)
  const tomorrow = shiftDate(today, 1)

  const p = await api.createProject('长期目标')
  const p1 = await api.setProjectProgress(p.id, d3, true, p.version)
  const p2 = await api.setProjectProgress(p.id, d1, true, p1.version)
  const p3 = await api.setProjectProgress(p.id, d2, true, p2.version)
  assert.deepEqual(p3.recentProgressDates, [d1, d2, d3])

  const noop = await api.setProjectProgress(p.id, d2, true, p3.version)
  assert.equal(noop.version, p3.version)

  await assert.rejects(
    api.setProjectProgress(p.id, tomorrow, true, p3.version),
    (error) => error.code === 'FUTURE_DATE_FORBIDDEN',
  )

  const done = await api.completeProject(p.id, p3.version)
  await assert.rejects(
    api.setProjectProgress(p.id, today, true, done.version),
    (error) => error.code === 'INVALID_STATUS_TRANSITION',
  )
  // Terminal project can still remove existing historical progress.
  const removed = await api.setProjectProgress(p.id, d3, false, done.version)
  assert.deepEqual(removed.recentProgressDates, [d1, d2])
})

test('nested project trash batches isolate restore and clean up descendants on permanent delete', async () => {
  const { api } = await createMockApi()
  const parent = await api.createProject('父项目')
  const child = await api.createProject('子项目', parent.id)

  const childEntry = await api.trashProject(child.id)
  assert.equal(childEntry.affectedCountAtDelete, 1)

  const preview = await api.previewProjectTrash(parent.id)
  assert.equal(preview.activeNodeCount, 1)

  const parentEntry = await api.trashProject(parent.id)
  assert.equal(parentEntry.affectedCountAtDelete, 1)
  assert.equal(parentEntry.currentDescendantCount, 2)

  // Cannot restore child while parent is in trash.
  await assert.rejects(
    api.restoreTrashEntry(childEntry.id),
    (error) => error.code === 'PARENT_IN_TRASH',
  )

  // Restoring parent does not implicitly restore previously trashed child.
  const restored = await api.restoreTrashEntry(parentEntry.id)
  assert.equal(restored.restoredCount, 1)
  const activeTree = await api.getProjectTree()
  assert.deepEqual(activeTree.map((item) => item.id), [parent.id])
  const remainingTrash = await api.listTrash('project')
  assert.deepEqual(remainingTrash.map((item) => item.id), [childEntry.id])

  // Trash parent again and permanently delete: both parent and child + both trash entries must be removed.
  const parentEntry2 = await api.trashProject(parent.id)
  const deleted = await api.permanentlyDeleteTrashEntry(parentEntry2.id)
  assert.equal(deleted.deletedProjectCount, 2)
  assert.deepEqual(await api.listTrash('project'), [])
  assert.deepEqual(await api.getProjectTree(), [])
})

test('version conflict blocks stale undo and moveProject validates version and cycles', async () => {
  const { api } = await createMockApi()
  const root = await api.createProject('根')
  const child = await api.createProject('子', root.id)

  await assert.rejects(
    api.moveProject(root.id, child.id, root.version),
    (error) => error.code === 'INVALID_PARENT',
  )
  await assert.rejects(
    api.moveProject(root.id, root.id, root.version),
    (error) => error.code === 'INVALID_PARENT',
  )

  const completed = await api.completeProject(root.id, root.version)
  await api.renameProject(root.id, '已改名', completed.version)
  await assert.rejects(
    api.restoreProject(root.id, completed.version),
    (error) => error.code === 'VERSION_CONFLICT',
  )
})

test('daily week computes progressedSameDay, shortIds, overdue, and cross-day completion', async () => {
  const { api } = await createMockApi()
  const { today, weekStart } = await api.getClockContext()
  const a = await api.createProject('同名任务')
  const b = await api.createProject('同名任务')

  const aProgressed = await api.setProjectProgress(a.id, today, true, a.version)
  await api.completeProject(a.id, aProgressed.version)
  await api.setProjectProgress(b.id, today, true, b.version)

  const week = await api.getDailyWeek(weekStart)
  const todayCol = week.days.find((day) => day.date === today)
  assert.ok(todayCol)
  assert.equal(todayCol.completedProjects.length, 1)
  assert.equal(todayCol.completedProjects[0].progressedSameDay, true)
  assert.equal(todayCol.progressedProjects.length, 1)
  assert.ok(todayCol.completedProjects[0].shortId)
  assert.ok(todayCol.progressedProjects[0].shortId)
  assert.notEqual(todayCol.completedProjects[0].shortId, todayCol.progressedProjects[0].shortId)
})

test('daily range enforces 30-day limit, validates ordering, and always returns global overdue reminders', async () => {
  const { api: baseApi } = await createMockApi()
  const { today } = await baseApi.getClockContext()
  const pastOverdue = shiftDate(today, -20)
  const windowStart = shiftDate(today, -10)
  const windowEnd = shiftDate(today, -5)

  const { api } = await createMockApi({
    reminders: [{
      id: 'old-overdue',
      title: 'Overdue outside window',
      scheduledDate: pastOverdue,
      status: 'active',
      completedDate: null,
      completedActionAt: null,
      canceledDate: null,
      sortOrder: 1024,
      version: 0,
    }],
  })

  const p = await api.createProject('Range project')
  await api.setProjectProgress(p.id, windowStart, true, p.version)

  const range = await api.getDailyRange(windowStart, windowEnd)
  assert.equal(range.startDate, windowStart)
  assert.equal(range.endDate, windowEnd)
  assert.equal(range.days.length, 6)
  assert.equal(range.days[0].progressedProjects.length, 1)
  assert.deepEqual(range.overdueReminders.map((item) => item.reminder.id), ['old-overdue'])

  // 30 inclusive days succeeds
  const maxRange = await api.getDailyRange('2026-11-01', '2026-11-30')
  assert.equal(maxRange.days.length, 30)

  // 31 inclusive days fails with INVALID_DATE
  await assert.rejects(
    api.getDailyRange('2026-11-01', '2026-12-01'),
    (error) => error.code === 'INVALID_DATE',
  )

  // Reversed range fails with INVALID_DATE
  await assert.rejects(
    api.getDailyRange('2026-11-20', '2026-11-19'),
    (error) => error.code === 'INVALID_DATE',
  )
})

test('month calendar returns full Mon-Sun grid, project counts, planned, cross-day completed, and overdue reminders', async () => {
  const { api } = await createMockApi()
  const { today } = await api.getClockContext()
  const currentMonth = today.slice(0, 7)
  const tomorrow = shiftDate(today, 1)
  const pastDate = shiftDate(today, -40)

  const { api: seededApi } = await createMockApi({
    reminders: [{
      id: 'overdue-past',
      title: 'Old overdue reminder',
      scheduledDate: pastDate,
      status: 'active',
      completedDate: null,
      completedActionAt: null,
      canceledDate: null,
      sortOrder: 1024,
      version: 0,
    }],
  })

  const p1 = await seededApi.createProject('Completed and progressed')
  const p1Prog = await seededApi.setProjectProgress(p1.id, today, true, p1.version)
  await seededApi.completeProject(p1.id, p1Prog.version)

  const p2 = await seededApi.createProject('Progressed only')
  await seededApi.setProjectProgress(p2.id, today, true, p2.version)

  const rToday = await seededApi.createReminder('Due today', today)
  const rTomorrow = await seededApi.createReminder('Done early', tomorrow)
  await seededApi.completeReminder(rTomorrow.id, rTomorrow.version)

  const cal = await seededApi.getMonthCalendar(currentMonth)
  assert.equal(cal.month, currentMonth)
  assert.equal(cal.today, today)
  assert.equal(cal.days.length % 7, 0)
  assert.equal(new Date(`${cal.gridStart}T12:00:00`).getDay(), 1)
  assert.equal(new Date(`${cal.gridEnd}T12:00:00`).getDay(), 0)

  const todayCell = cal.days.find((day) => day.date === today)
  assert.ok(todayCell)
  assert.equal(todayCell.inCurrentMonth, true)
  assert.equal(todayCell.completedProjectCount, 1)
  assert.equal(todayCell.progressedProjectCount, 1)
  assert.deepEqual(todayCell.plannedReminders.map((item) => item.reminder.id), [rToday.id])
  assert.deepEqual(todayCell.crossDayCompletedReminders.map((item) => item.reminder.id), [rTomorrow.id])
  assert.deepEqual(cal.overdueReminders.map((item) => item.reminder.id), ['overdue-past'])

  const dec = await api.getMonthCalendar('2026-12')
  assert.equal(dec.gridStart, '2026-11-30')
  assert.equal(dec.gridEnd, '2027-01-03')
  assert.equal(dec.days.length, 35)
  assert.equal(dec.days[0].inCurrentMonth, false)
  assert.equal(dec.days[1].inCurrentMonth, true)
  assert.equal(dec.days[34].inCurrentMonth, false)

  await assert.rejects(
    api.getMonthCalendar('2026-13'),
    (error) => error.code === 'INVALID_DATE',
  )
})

test('invalid trash category and theme mode return INVALID_INPUT', async () => {
  const { api } = await createMockApi()
  await assert.rejects(
    api.listTrash('unknown'),
    (error) => error.code === 'INVALID_INPUT',
  )
  await assert.rejects(
    api.setThemeMode('sepia'),
    (error) => error.code === 'INVALID_INPUT',
  )
})

test('default browser mock initializes with complete showcase demo dataset', async () => {
  let saved = null
  globalThis.localStorage = {
    getItem: () => saved,
    setItem: (_key, value) => { saved = value },
  }
  const { api } = await import(`../src/api.ts?mock-demo-test=${moduleId++}`)
  const { today, weekStart } = await api.getClockContext()

  const projects = await api.getProjectTree()
  assert.equal(projects.length, 26)
  assert.ok(projects.some((p) => !p.isExpanded))
  assert.ok(projects.some((p) => p.progressCount > 3))
  assert.ok(projects.some((p) => p.status === 'canceled'))

  const week = await api.getDailyWeek(weekStart)
  const todayCol = week.days.find((day) => day.date === today)
  assert.ok(todayCol)
  assert.ok(todayCol.completedProjects.some((item) => item.progressedSameDay === true))
  assert.ok(todayCol.completedProjects.some((item) => item.shortId === 'a4c1f'))
  assert.ok(todayCol.progressedProjects.some((item) => item.shortId === 'a4c1e'))
  assert.equal(todayCol.overdueReminders.length, 3)
  assert.equal(todayCol.crossDayCompletedReminders.length, 2)

  const month = await api.getMonthCalendar(today.slice(0, 7))
  assert.equal(month.overdueReminders.length, 3)
  assert.equal(month.overdueReminders[0].reminder.title, 'Renew annual SSL certificate')

  const projectTrash = await api.listTrash('project')
  assert.equal(projectTrash.length, 4)
  const nestedParent = projectTrash.find((e) => e.titleSnapshot === 'Old Mobile Companion Idea')
  const nestedChild = projectTrash.find((e) => e.titleSnapshot === 'Push Notification Spike')
  assert.equal(nestedParent.affectedCountAtDelete, 2)
  assert.equal(nestedParent.currentDescendantCount, 3)
  await assert.rejects(
    api.restoreTrashEntry(nestedChild.id),
    (error) => error.code === 'PARENT_IN_TRASH',
  )
  const restored = await api.restoreTrashEntry(nestedParent.id)
  assert.equal(restored.restoredCount, 2)
  assert.ok((await api.listTrash('project')).some((e) => e.id === nestedChild.id))
})
