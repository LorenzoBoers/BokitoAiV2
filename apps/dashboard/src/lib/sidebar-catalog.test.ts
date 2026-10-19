import { describe, expect, it } from 'vitest'
import {
  applyOrder,
  applyTreeOrder,
  canHideItem,
  filterCatalog,
  orderIds,
  repairHiddenItems,
  type CatalogNode,
} from './sidebar-catalog'

describe('sidebar catalog layout', () => {
  it('keeps a saved order and appends new ids', () => {
    expect(orderIds(['b', 'gone', 'a'], ['a', 'b', 'c'])).toEqual(['b', 'a', 'c'])
  })

  it('hides rows and still returns them when the editor asks', () => {
    const prefs = { itemOrder: { inbox: ['queue:spam', 'queue:for_you'] }, hiddenItems: ['queue:spam'] }
    const rows = ['for_you', 'open', 'spam']
    expect(applyOrder(rows, 'inbox', (queue) => `queue:${queue}`, prefs)).toEqual(['for_you', 'open'])
    expect(applyOrder(rows, 'inbox', (queue) => `queue:${queue}`, prefs, true)).toEqual(['spam', 'for_you', 'open'])
  })

  it('orders nested folders under their parent', () => {
    const prefs = { itemOrder: { 'folder:a': ['folder:c', 'folder:b'] }, hiddenItems: [] }
    type Row = { id: string; children?: Row[] }
    const tree: Row[] = [{ id: 'a', children: [{ id: 'b' }, { id: 'c' }] }]
    expect(applyTreeOrder(tree, 'folders', (row) => `folder:${row.id}`, prefs)).toEqual([
      { id: 'a', children: [{ id: 'c' }, { id: 'b' }] },
    ])
  })

  it('refuses to hide both For you and All', () => {
    expect(canHideItem('queue:for_you', [])).toBe(true)
    expect(canHideItem('queue:for_you', ['queue:open'])).toBe(false)
    expect(canHideItem('queue:spam', ['queue:open'])).toBe(true)
    expect(repairHiddenItems(['queue:for_you', 'queue:open', 'queue:spam'])).toEqual(['queue:for_you', 'queue:spam'])
  })

  it('keeps a matching folder and its children while searching', () => {
    const nodes: CatalogNode[] = [
      {
        id: 'folders',
        parentId: 'root',
        label: 'Mappen',
        hideKind: 'section',
        children: [
          { id: 'folder:1', parentId: 'folders', label: 'Development', hideKind: 'item', children: [] },
        ],
      },
    ]
    expect(filterCatalog(nodes, 'dev').map((node) => node.id)).toEqual(['folders'])
    expect(filterCatalog(nodes, 'dev')[0]?.children[0]?.label).toBe('Development')
    expect(filterCatalog(nodes, 'nope')).toEqual([])
  })
})
