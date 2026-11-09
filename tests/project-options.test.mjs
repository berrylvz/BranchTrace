import assert from 'node:assert/strict'
import test from 'node:test'
import { createMoveOptions } from '../src/project-options.ts'

const project = (id, title, parentId = null) => ({ id, title, parentId })

test('moving a subtree excludes its root and all descendants, including collapsed branches', () => {
  const projects = [project('root', '目标'), project('child', '子项目', 'root'), project('grandchild', '孙项目', 'child'), project('other', '其他')]
  assert.deepEqual(createMoveOptions('root', projects), [{ value: '', label: '顶层' }, { value: 'other', label: '其他' }])
})

test('moving a leaf keeps ancestors and siblings available with complete paths', () => {
  const projects = [project('root', '目标'), project('child', '子项目', 'root'), project('sibling', '另一个子项目', 'root')]
  assert.deepEqual(createMoveOptions('child', projects), [
    { value: '', label: '顶层' }, { value: 'root', label: '目标' }, { value: 'sibling', label: '目标 / 另一个子项目' },
  ])
})

test('duplicate paths use distinct short IDs while unique paths stay uncluttered', () => {
  const projects = [project('source', '移动的项目'), project('abcd1111', '同名'), project('abcd1222', '同名'), project('unique', '单独项目')]
  const options = createMoveOptions('source', projects)
  assert.deepEqual(options.slice(1), [
    { value: 'abcd1111', label: '同名 · abcd11' }, { value: 'abcd1222', label: '同名 · abcd12' }, { value: 'unique', label: '单独项目' },
  ])
})

test('deep descendants are excluded without recursive traversal', () => {
  const projects = [project('root', '根')]
  for (let index = 0; index < 3000; index += 1) projects.push(project(`child-${index}`, '子项目', index ? `child-${index - 1}` : 'root'))
  assert.deepEqual(createMoveOptions('root', projects), [{ value: '', label: '顶层' }])
})

test('malformed cyclic or missing parent data cannot hang the selector', () => {
  const projects = [project('source', '移动的项目'), project('a', '甲', 'b'), project('b', '乙', 'a'), project('orphan', '孤立项目', 'missing')]
  assert.deepEqual(createMoveOptions('source', projects).map((option) => option.value), ['', 'a', 'b', 'orphan'])
})
