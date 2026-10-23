import { describe, expect, it } from 'vitest'

import { buildDepartmentForest } from './department-tree'

describe('buildDepartmentForest', () => {
  it('puts the root on top and nests branches by parent', () => {
    const forest = buildDepartmentForest([
      { id: 'ops', name: 'Operations', parent_id: 'all' },
      { id: 'all', name: 'All', parent_id: null },
      { id: 'sales', name: 'Sales', parent_id: 'all' },
      { id: 'inbound', name: 'Inbound', parent_id: 'sales' },
    ])

    expect(forest.map((node) => node.department.id)).toEqual(['all'])
    expect(forest[0].children.map((node) => node.department.id)).toEqual(['ops', 'sales'])
    expect(forest[0].children[1].children.map((node) => node.department.id)).toEqual(['inbound'])
  })

  it('keeps a single root first even when its name sorts last', () => {
    const forest = buildDepartmentForest([
      { id: 'root', name: 'Zulu', parent_id: null },
      { id: 'alpha', name: 'Alpha', parent_id: 'root' },
    ])
    expect(forest[0].department.id).toBe('root')
    expect(forest[0].children.map((node) => node.department.name)).toEqual(['Alpha'])
  })

  it('hangs a department with a missing parent on the root', () => {
    const forest = buildDepartmentForest([
      { id: 'all', name: 'All', parent_id: null },
      { id: 'ghost', name: 'Ghost', parent_id: 'missing' },
    ])
    expect(forest).toHaveLength(1)
    expect(forest[0].children.map((node) => node.department.id)).toEqual(['ghost'])
  })

  it('does not loop when two departments point at each other', () => {
    const forest = buildDepartmentForest([
      { id: 'a', name: 'Alpha', parent_id: 'b' },
      { id: 'b', name: 'Beta', parent_id: 'a' },
    ])
    expect(forest.map((node) => node.department.id)).toEqual(['a', 'b'])
    expect(forest.every((node) => node.children.length === 0)).toBe(true)
  })

  it('keeps the first row when an id is repeated', () => {
    const forest = buildDepartmentForest([
      { id: 'all', name: 'All', parent_id: null },
      { id: 'all', name: 'Duplicate', parent_id: null },
    ])
    expect(forest).toHaveLength(1)
    expect(forest[0].department.name).toBe('All')
  })
})
