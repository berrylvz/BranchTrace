import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProjectDisplayItems, computeReorderedIds, createProjectTree, MAX_TREE_INDENT } from '../src/project-tree.ts'

const project = (id, parentId = null, sortOrder = 1024, isExpanded = true) => ({ id, title: id, parentId, sortOrder, isExpanded })

test('tree rows use stable sibling order across multiple roots', () => {
  const projects = [project('z'), project('child-b', 'a', 2048), project('a'), project('child-a', 'a')]
  const tree = createProjectTree(projects)
  assert.deepEqual(tree.rows.map((row) => [row.project.id, row.depth, row.hasChildren, row.isLastSibling]), [
    ['a', 0, true, false], ['child-a', 1, false, false], ['child-b', 1, false, true], ['z', 0, false, true],
  ])
  assert.deepEqual(tree.grouped.get('a').map((item) => item.id), ['child-a', 'child-b'])
  assert.equal(tree.hasBranches, true)
  assert.deepEqual(projects.map((item) => item.id), ['z', 'child-b', 'a', 'child-a'])
})

test('ancestor guides continue only for ancestors with following siblings', () => {
  const tree = createProjectTree([
    project('root'), project('a', 'root'), project('b', 'root', 2048),
    project('a1', 'a'), project('a2', 'a', 2048), project('a11', 'a1'), project('b1', 'b'),
  ])
  assert.deepEqual(tree.rows.map((row) => [row.project.id, row.continuationDepths]), [
    ['root', []], ['a', []], ['a1', [0]], ['a11', [0, 1]], ['a2', [0]], ['b', []], ['b1', []],
  ])
  assert.equal(tree.rows.find((row) => row.project.id === 'a2').isLastSibling, true)
  assert.equal(tree.rows.find((row) => row.project.id === 'a11').isLastSibling, true)
})

test('collapsed branches hide descendants while retaining sibling and parent metadata', () => {
  const projects = [project('root'), project('a', 'root', 1024, false), project('hidden', 'a'), project('b', 'root', 2048)]
  const tree = createProjectTree(projects)
  assert.deepEqual(tree.rows.map((row) => row.project.id), ['root', 'a', 'b'])
  assert.equal(tree.rows[1].hasChildren, true)
  assert.equal(tree.rows[1].isLastSibling, false)
  assert.equal(tree.grouped.get('a')[0].id, 'hidden')

  const collapsed = projects.map((item) => ({ ...item, isExpanded: false }))
  assert.deepEqual(createProjectTree(collapsed).rows.map((row) => row.project.id), ['root'])
  collapsed[0].isExpanded = true
  assert.deepEqual(createProjectTree(collapsed).rows.map((row) => row.project.id), ['root', 'a', 'b'])
})

test('empty trees and root-only lists have no expandable parent', () => {
  assert.deepEqual(createProjectTree([]).rows, [])
  assert.equal(createProjectTree([]).hasBranches, false)
  assert.equal(createProjectTree([project('a'), project('b')]).hasBranches, false)
})

test('very deep trees render iteratively with bounded guide metadata and actual depths', () => {
  const projects = [project('root')]
  for (let depth = 1; depth <= 10000; depth += 1) {
    const parentId = depth === 1 ? 'root' : `a-${depth - 1}`
    projects.push(project(`a-${depth}`, parentId), project(`b-${depth}`, parentId, 2048))
  }
  const tree = createProjectTree(projects)
  assert.equal(tree.rows.length, projects.length)
  assert.equal(tree.rows[10000].depth, 10000)
  assert.equal(tree.rows[10000].project.id, 'a-10000')
  assert.equal(tree.rows[10000].continuationDepths.length, MAX_TREE_INDENT)
  assert.ok(tree.rows.every((row) => row.continuationDepths.length <= MAX_TREE_INDENT))
})

test('duplicate IDs and cyclic malformed input cannot make traversal hang', () => {
  const tree = createProjectTree([project('root'), project('child', 'root'), project('root', 'child'), project('cycle', 'cycle')])
  assert.deepEqual(tree.rows.map((row) => row.project.id), ['root', 'child'])
})

test('temporary expansion reveals children for inline child creation without mutating persisted state', () => {
  const projects = [project('root', null, 1024, false), project('child', 'root', 1024, true), project('sibling', null, 2048, true)]
  const collapsed = createProjectTree(projects)
  assert.deepEqual(collapsed.rows.map((row) => row.project.id), ['root', 'sibling'])

  const tempExpanded = new Set(['root'])
  const revealed = createProjectTree(projects, tempExpanded)
  assert.deepEqual(revealed.rows.map((row) => row.project.id), ['root', 'child', 'sibling'])
  assert.equal(projects[0].isExpanded, false)

  const display = buildProjectDisplayItems(revealed.rows, 'root', tempExpanded)
  assert.deepEqual(display.map((item) => item.kind === 'project' ? item.row.project.id : `input:${item.parent.id}@${item.depth}`), [
    'root', 'child', 'input:root@1', 'sibling',
  ])
  // Existing last direct child keeps vertical guide unbroken to the inline child input.
  assert.equal(display[1].kind === 'project' && display[1].row.isLastSibling, false)
})

test('computeReorderedIds places dragged item accurately before or after target and ignores no-ops', () => {
  assert.deepEqual(computeReorderedIds(['a', 'b', 'c'], 'a', 'c', 'before'), ['b', 'a', 'c'])
  assert.deepEqual(computeReorderedIds(['a', 'b', 'c'], 'a', 'c', 'after'), ['b', 'c', 'a'])
  assert.deepEqual(computeReorderedIds(['a', 'b', 'c'], 'c', 'a', 'before'), ['c', 'a', 'b'])
  assert.deepEqual(computeReorderedIds(['a', 'b', 'c'], 'c', 'a', 'after'), ['a', 'c', 'b'])
  assert.equal(computeReorderedIds(['a', 'b', 'c'], 'a', 'b', 'before'), null)
  assert.equal(computeReorderedIds(['a', 'b', 'c'], 'b', 'a', 'after'), null)
  assert.equal(computeReorderedIds(['a', 'b', 'c'], 'a', 'a', 'before'), null)
  assert.equal(computeReorderedIds(['a', 'b'], 'missing', 'b', 'after'), null)
})
