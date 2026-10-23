import { describe, expect, it } from 'vitest'
import {
  deriveFolderTree,
  folderAncestorChain,
  folderFilterRows,
  folderFilterSubtreeIds,
  filtersetLabel,
  filtersetLocalNames,
  filtersetPlainLabel,
  optimisticNestSources,
  optimisticPlaceAsSibling,
  optimisticUnnestToRoot,
  optimisticUnnestToRootAt,
  placementFromAnchor,
  resolveFolderDepthIntent,
  resolveSiblingReorderTarget,
  rootFolderIdFor,
} from './folder-filter-tree'

describe('deriveFolderTree', () => {
  it('nests by stored parent_id', () => {
    const tree = deriveFolderTree([
      { id: 'a', name: 'A', tag_ids: ['t1'], sort_order: 0, parent_id: null },
      { id: 'ab', name: 'A+B', tag_ids: ['t2'], sort_order: 0, parent_id: 'a' },
      { id: 'b', name: 'B', tag_ids: ['t3'], sort_order: 1, parent_id: null },
    ])
    expect(tree.map((node) => node.id)).toEqual(['a', 'b'])
    const aChild = tree.find((node) => node.id === 'a')
    expect(aChild?.children.map((c) => c.id)).toEqual(['ab'])
  })

  it('includes folders with no labels', () => {
    const tree = deriveFolderTree([
      { id: 'empty', name: 'Empty', tag_ids: [], parent_id: null },
      { id: 'child', name: 'Child', tag_ids: [], parent_id: 'empty' },
    ])
    expect(tree.map((n) => n.id)).toEqual(['empty'])
    expect(tree[0]?.children.map((c) => c.id)).toEqual(['child'])
  })

  it('sorts siblings by sort_order then name', () => {
    const tree = deriveFolderTree([
      { id: 'z', name: 'Zebra', tag_ids: ['z'], sort_order: 2 },
      { id: 'a', name: 'Alpha', tag_ids: ['a'], sort_order: 1 },
    ])
    expect(tree.map((n) => n.id)).toEqual(['a', 'z'])
  })
})

describe('folderFilterRows', () => {
  it('flattens with depth', () => {
    const tree = deriveFolderTree([
      { id: 'root', name: 'Root', tag_ids: ['r'], parent_id: null },
      { id: 'child', name: 'Child', tag_ids: ['c'], parent_id: 'root' },
    ])
    const rows = folderFilterRows(tree)
    expect(rows.map((r) => [r.id, r.depth])).toEqual([
      ['root', 0],
      ['child', 1],
    ])
  })
})

describe('folderFilterSubtreeIds', () => {
  it('includes descendants', () => {
    const tree = deriveFolderTree([
      { id: 'root', name: 'Root', tag_ids: ['r'], parent_id: null },
      { id: 'child', name: 'Child', tag_ids: ['c'], parent_id: 'root' },
      { id: 'other', name: 'Other', tag_ids: ['o'], parent_id: null },
    ])
    expect([...folderFilterSubtreeIds(tree, 'root')].sort()).toEqual(['child', 'root'])
  })
})

describe('filtersetLabel', () => {
  it('joins hashtag names', () => {
    expect(filtersetLabel(['sales', 'urgent'])).toBe('sales · urgent')
  })
})

describe('filtersetPlainLabel', () => {
  it('joins without hashes', () => {
    expect(filtersetPlainLabel(['sales', 'urgent'])).toBe('sales · urgent')
  })
})

describe('filtersetLocalNames', () => {
  it('strips parent names', () => {
    expect(filtersetLocalNames(['a', 'b'], ['a'])).toEqual(['b'])
  })
})

describe('optimisticNestSources', () => {
  it('sets parent_id without changing labels', () => {
    const next = optimisticNestSources(
      [
        { id: 'a', name: 'A', tag_ids: ['1'], tag_names: ['a'], parent_id: null },
        { id: 'b', name: 'B', tag_ids: ['2'], tag_names: ['b'], parent_id: null },
      ],
      'b',
      'a',
    )
    expect(next?.find((row) => row.id === 'b')?.parent_id).toBe('a')
    expect(next?.find((row) => row.id === 'b')?.tag_names).toEqual(['b'])
    expect(
      (next?.find((row) => row.id === 'b') as { sort_order?: number } | undefined)?.sort_order,
    ).toBe(0)
  })
})

describe('resolveFolderDepthIntent / placementFromAnchor', () => {
  it('nests one level deeper than the anchor', () => {
    const depth = resolveFolderDepthIntent(8 + 23, 0, 0)
    expect(depth).toBe(1)
    expect(
      placementFromAnchor(1, 'a', 0, [], 'after', new Set()),
    ).toEqual({ mode: 'nest', parentId: 'a' })
  })

  it('unnests to the ancestor at the intended depth', () => {
    expect(
      placementFromAnchor(0, 'c', 2, ['a', 'b'], 'before', new Set()),
    ).toEqual({ mode: 'sibling', parentId: null, overId: 'a', edge: 'before' })
    expect(
      placementFromAnchor(1, 'c', 2, ['a', 'b'], 'after', new Set()),
    ).toEqual({ mode: 'sibling', parentId: 'a', overId: 'b', edge: 'after' })
  })
})

describe('optimisticPlaceAsSibling', () => {
  it('moves under a new parent before the over row', () => {
    const next = optimisticPlaceAsSibling(
      [
        { id: 'a', name: 'A', tag_ids: ['1'], sort_order: 0, parent_id: null },
        { id: 'b', name: 'B', tag_ids: ['2'], sort_order: 1, parent_id: null },
        { id: 'c', name: 'C', tag_ids: ['3'], sort_order: 0, parent_id: 'a' },
      ],
      'b',
      'a',
      'c',
      'before',
    )
    expect(next?.find((row) => row.id === 'b')?.parent_id).toBe('a')
    const tree = deriveFolderTree(next!)
    expect(tree.find((n) => n.id === 'a')?.children.map((n) => n.id)).toEqual(['b', 'c'])
  })
})

describe('optimisticUnnestToRoot', () => {
  it('clears parent_id', () => {
    const next = optimisticUnnestToRoot(
      [
        { id: 'a', name: 'A', tag_ids: ['1'], parent_id: null },
        { id: 'b', name: 'B', tag_ids: ['2'], parent_id: 'a' },
      ],
      'b',
    )
    expect(next?.find((row) => row.id === 'b')?.parent_id).toBeNull()
  })

  it('returns null when already root', () => {
    expect(
      optimisticUnnestToRoot([{ id: 'a', name: 'A', tag_ids: ['1'], parent_id: null }], 'a'),
    ).toBeNull()
  })
})

describe('optimisticUnnestToRootAt', () => {
  it('places among roots', () => {
    const next = optimisticUnnestToRootAt(
      [
        { id: 'a', name: 'A', tag_ids: ['1'], sort_order: 0, parent_id: null },
        { id: 'b', name: 'B', tag_ids: ['2'], sort_order: 1, parent_id: null },
        { id: 'c', name: 'C', tag_ids: ['3'], sort_order: 0, parent_id: 'a' },
      ],
      'c',
      { at: 'start' },
    )
    const tree = deriveFolderTree(next!)
    expect(tree.map((n) => n.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('resolveSiblingReorderTarget', () => {
  it('maps descendant hit to sibling', () => {
    const tree = deriveFolderTree([
      { id: 'a', name: 'A', tag_ids: ['1'], parent_id: null },
      { id: 'b', name: 'B', tag_ids: ['2'], parent_id: null },
      { id: 'b1', name: 'B1', tag_ids: ['3'], parent_id: 'b' },
    ])
    expect(resolveSiblingReorderTarget(tree, 'a', 'b1')).toBe('b')
  })
})

describe('folderAncestorChain / rootFolderIdFor', () => {
  it('walks ancestors', () => {
    const tree = deriveFolderTree([
      { id: 'a', name: 'A', tag_ids: ['1'], parent_id: null },
      { id: 'b', name: 'B', tag_ids: ['2'], parent_id: 'a' },
      { id: 'c', name: 'C', tag_ids: ['3'], parent_id: 'b' },
    ])
    expect(folderAncestorChain(tree, 'c').map((n) => n.id)).toEqual(['a', 'b'])
    expect(rootFolderIdFor(tree, 'c')).toBe('a')
  })
})
