import assert from 'node:assert/strict'
import test from 'node:test'
import { createMoveOptions, createMoveTreeOptions } from '../src/project-options.ts'

const project = (id, title, parentId = null, sortOrder = 1024, status = 'active') => ({ id, title, parentId, sortOrder, status })

test('moving a subtree excludes its root and all descendants, including collapsed branches', () => {
  const projects = [project('root', 'Goal'), project('child', 'Subproject', 'root'), project('grandchild', 'Nested', 'child'), project('other', 'Other')]
  assert.deepEqual(createMoveOptions('root', projects), [{ value: '', label: 'Top level' }, { value: 'other', label: 'Other' }])
})

test('moving a leaf keeps ancestors and siblings available with complete paths', () => {
  const projects = [project('root', 'Goal'), project('child', 'Subproject', 'root'), project('sibling', 'Another', 'root')]
  assert.deepEqual(createMoveOptions('child', projects), [
    { value: '', label: 'Top level' }, { value: 'root', label: 'Goal' }, { value: 'sibling', label: 'Goal / Another' },
  ])
})

test('duplicate paths use distinct short IDs while unique paths stay uncluttered', () => {
  const projects = [project('source', 'Source'), project('abcd1111', 'Duplicate'), project('abcd1222', 'Duplicate'), project('unique', 'Unique')]
  const options = createMoveOptions('source', projects)
  assert.deepEqual(options.slice(1), [
    { value: 'abcd1111', label: 'Duplicate · abcd11' }, { value: 'abcd1222', label: 'Duplicate · abcd12' }, { value: 'unique', label: 'Unique' },
  ])
})

test('deep descendants are excluded without recursive traversal', () => {
  const projects = [project('root', 'Root')]
  for (let index = 0; index < 3000; index += 1) projects.push(project(`child-${index}`, 'Subproject', index ? `child-${index - 1}` : 'root'))
  assert.deepEqual(createMoveOptions('root', projects), [{ value: '', label: 'Top level' }])
})

test('malformed cyclic or missing parent data cannot hang the selector', () => {
  const projects = [project('source', '移动的项目'), project('a', '甲', 'b'), project('b', '乙', 'a'), project('orphan', '孤立项目', 'missing')]
  assert.deepEqual(createMoveOptions('source', projects).map((option) => option.value), ['', 'a', 'b', 'orphan'])
})

test('createMoveTreeOptions orders targets in indented tree order and marks duplicate shortIds', () => {
  const projects = [
    project('b-root', '产品', null, 2048),
    project('a-root', '学习', null, 1024),
    project('a-child', '阅读', 'a-root', 1024),
    project('source', '待移动', 'b-root', 1024),
    project('source-child', '后代', 'source', 1024),
    project('dup1111', '同名', 'a-root', 2048),
    project('dup2222', '同名', 'a-root', 3072),
  ]
  const tree = createMoveTreeOptions('source', projects)
  assert.deepEqual(tree.map((item) => [item.value, item.depth, item.shortId]), [
    ['', 0, null],
    ['a-root', 1, null],
    ['a-child', 2, null],
    ['dup1111', 2, 'dup1'],
    ['dup2222', 2, 'dup2'],
    ['b-root', 1, null],
  ])
})
