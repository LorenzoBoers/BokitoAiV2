import { describe, expect, it } from 'vitest'
import {
  deriveFolderTree,
  folderAncestorChain,
  folderFilterRows,
  folderFilterSubtreeIds,
  filtersetLabel,
  filtersetLocalNames,
  filtersetPlainLabel,
  predictFiltersetParent,
  previewNestMerge,
} from './folder-filter-tree'

describe('deriveFolderTree', () => {
  it('nests by strict tag-set inclusion', () => {
    const tree = deriveFolderTree([
      { id: 'a', name: 'A', tag_ids: ['t1'], sort_order: 0 },
      { id: 'ab', name: 'A+B', tag_ids: ['t1', 't2'], sort_order: 0 },
      { id: 'b', name: 'B', tag_ids: ['t2'], sort_order: 1 },
    ])
    expect(tree.map((node) => node.id)).toEqual(['a', 'b'])
    const aChild = tree.find((node) => node.id === 'a')
    expect(aChild?.children.map((c) => c.id)).toEqual(['ab'])
  })

  it('picks the largest proper subset as parent', () => {
    const tree = deriveFolderTree([
      { id: 'x', name: 'X', tag_ids: ['1'] },
      { id: 'y', name: 'Y', tag_ids: ['2'] },
      { id: 'xy', name: 'XY', tag_ids: ['1', '2'] },
      { id: 'xyz', name: 'XYZ', tag_ids: ['1', '2', '3'] },
    ])
    const xy = tree.flatMap((n) => n.children).find((n) => n.id === 'xy')
    expect(xy?.children.map((c) => c.id)).toEqual(['xyz'])
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
      { id: 'root', name: 'Root', tag_ids: ['r'] },
      { id: 'child', name: 'Child', tag_ids: ['r', 'c'] },
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
      { id: 'root', name: 'Root', tag_ids: ['r'] },
      { id: 'child', name: 'Child', tag_ids: ['r', 'c'] },
      { id: 'other', name: 'Other', tag_ids: ['o'] },
    ])
    expect([...folderFilterSubtreeIds(tree, 'root')].sort()).toEqual(['child', 'root'])
  })
})

describe('filtersetLabel', () => {
  it('joins hashtag names', () => {
    expect(filtersetLabel(['sales', 'urgent'])).toBe('#sales · #urgent')
  })
})

describe('filtersetPlainLabel', () => {
  it('joins without hash marks', () => {
    expect(filtersetPlainLabel(['sales', 'urgent'])).toBe('sales · urgent')
  })
})

describe('filtersetLocalNames', () => {
  it('returns the full set at the root', () => {
    expect(filtersetLocalNames(['administratie', 'betaal'])).toEqual(['administratie', 'betaal'])
  })

  it('strips parent tags for nested rows', () => {
    expect(filtersetLocalNames(['administratie', 'betaal'], ['administratie'])).toEqual(['betaal'])
  })

  it('falls back to the full set when nothing remains', () => {
    expect(filtersetLocalNames(['administratie'], ['administratie'])).toEqual(['administratie'])
  })
})

describe('previewNestMerge', () => {
  it('unions parent tags into the child and flags unrelated sets', () => {
    const preview = previewNestMerge(['bokito_platform', 'reclame'], ['administratie'])
    expect(preview.mergedNames).toEqual(['administratie', 'bokito_platform', 'reclame'])
    expect(preview.addedNames).toEqual(['administratie'])
    expect(preview.unrelated).toBe(true)
    expect(preview.mergedLabel).toBe('#administratie · #bokito_platform · #reclame')
  })

  it('skips tags the child already has', () => {
    const preview = previewNestMerge(['administratie', 'facturen'], ['administratie'])
    expect(preview.addedNames).toEqual([])
    expect(preview.unrelated).toBe(false)
    expect(preview.mergedNames).toEqual(['administratie', 'facturen'])
  })
})

describe('predictFiltersetParent', () => {
  it('picks the largest proper subset map', () => {
    const parent = predictFiltersetParent(
      ['administratie', 'facturen'],
      [
        { id: 'a', name: 'A', tag_names: ['administratie'] },
        { id: 'b', name: 'B', tag_names: ['other'] },
      ],
    )
    expect(parent?.id).toBe('a')
  })

  it('returns null for a root-level set', () => {
    expect(
      predictFiltersetParent(['solo'], [{ id: 'a', name: 'A', tag_names: ['administratie'] }]),
    ).toBeNull()
  })
})

describe('folderAncestorChain', () => {
  it('returns root-to-parent ancestors', () => {
    const tree = deriveFolderTree([
      { id: 'a', name: 'A', tag_ids: ['1'], tag_names: ['a'] },
      { id: 'ab', name: 'AB', tag_ids: ['1', '2'], tag_names: ['a', 'b'] },
      { id: 'abc', name: 'ABC', tag_ids: ['1', '2', '3'], tag_names: ['a', 'b', 'c'] },
    ])
    expect(folderAncestorChain(tree, 'abc').map((n) => n.id)).toEqual(['a', 'ab'])
  })
})
