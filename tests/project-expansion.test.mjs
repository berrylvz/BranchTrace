import assert from 'node:assert/strict'
import test from 'node:test'

const project = (id, parentId = null, status = 'active') => ({
  id, parentId, title: id, status, completedDate: status === 'completed' ? '2026-01-01' : null,
  canceledDate: status === 'canceled' ? '2026-01-01' : null, sortOrder: 1024, version: 7,
  isExpanded: true, recentProgressDates: [], progressCount: 0, progressedToday: false,
})

let moduleId = 0
async function mockApi(state) {
  let saved = JSON.stringify({ projects: [], progress: {}, reminders: [], trash: [], themeMode: 'system', ...state })
  let failSave = false
  globalThis.localStorage = {
    getItem: () => saved,
    setItem: (_key, value) => { if (failSave) throw new Error('模拟存储失败'); saved = value },
  }
  const load = async () => (await import(`../src/api.ts?expansion-test=${moduleId++}`)).api
  return { api: await load(), load, state: () => JSON.parse(saved), failSave: () => { failSave = true } }
}

test('bulk expansion persists all normal nodes including hidden descendants and terminal projects', async () => {
  const projects = [project('root'), project('child', 'root'), project('grandchild', 'child'), project('completed', null, 'completed'), project('canceled', null, 'canceled'), project('trash'), project('trash-child', 'trash')]
  const mock = await mockApi({ projects, progress: { root: ['2026-01-01'] }, trash: [{ kind: 'project', rootEntityId: 'trash' }] })
  const original = mock.state()
  const collapsed = await mock.api.setAllProjectsExpanded(false)
  assert.equal(collapsed.length, 5)
  assert.ok(collapsed.every((item) => !item.isExpanded))
  assert.ok(mock.state().projects.filter((item) => item.id.startsWith('trash')).every((item) => item.isExpanded))
  assert.deepEqual(mock.state().projects.map(({ isExpanded, ...item }) => item), original.projects.map(({ isExpanded, ...item }) => item))
  assert.deepEqual(mock.state().progress, original.progress)

  const reloaded = await mock.load()
  assert.ok((await reloaded.getProjectTree()).every((item) => !item.isExpanded))
  await reloaded.setProjectExpanded('root', true)
  assert.equal((await reloaded.getProjectTree()).find((item) => item.id === 'child').isExpanded, false)
  await reloaded.setAllProjectsExpanded(true)
  assert.deepEqual(mock.state(), original)
})

test('bulk expansion is idempotent and handles an empty tree', async () => {
  const mock = await mockApi({ projects: [project('root'), project('child', 'root')] })
  await mock.api.setAllProjectsExpanded(false)
  const collapsed = mock.state()
  await mock.api.setAllProjectsExpanded(false)
  assert.deepEqual(mock.state(), collapsed)
  const empty = await mockApi({})
  assert.deepEqual(await empty.api.setAllProjectsExpanded(false), [])
  assert.deepEqual(await empty.api.setAllProjectsExpanded(true), [])
})

test('a bulk storage failure leaves both cached state and persisted state unchanged', async () => {
  const mock = await mockApi({ projects: [project('root'), project('child', 'root')] })
  const original = mock.state()
  mock.failSave()
  await assert.rejects(mock.api.setAllProjectsExpanded(false), /模拟存储失败/)
  assert.deepEqual(mock.state(), original)
  assert.ok((await mock.api.getProjectTree()).every((item) => item.isExpanded))
})

test('today progress toggles on and off using the persisted version after a reload', async () => {
  const mock = await mockApi({ projects: [project('root')] })
  const recorded = await mock.api.setProjectProgress('root', undefined, true, 7)
  assert.equal(recorded.progressedToday, true)
  assert.equal(recorded.progressCount, 1)
  assert.equal(recorded.version, 8)
  const reloaded = await mock.load()
  assert.equal((await reloaded.getProjectTree())[0].progressedToday, true)
  const removed = await reloaded.setProjectProgress('root', undefined, false, recorded.version)
  assert.equal(removed.progressedToday, false)
  assert.equal(removed.progressCount, 0)
  assert.deepEqual(mock.state().progress.root, [])
})

test('a failed today progress write or removal retains the saved record and version', async () => {
  for (const present of [true, false]) {
    const mock = await mockApi({ projects: [project('root')] })
    if (!present) await mock.api.setProjectProgress('root', undefined, true, 7)
    const original = mock.state()
    const savedProject = (await mock.api.getProjectTree())[0]
    mock.failSave()
    await assert.rejects(mock.api.setProjectProgress('root', undefined, present, savedProject.version), /模拟存储失败/)
    assert.deepEqual(mock.state(), original)
    assert.deepEqual((await mock.api.getProjectTree())[0], savedProject)
  }
})
