import { describe, expect, it } from 'vitest'
import { filterBinItems, type TrashItem } from './trash-api'

function item(partial: Partial<TrashItem> & Pick<TrashItem, 'id' | 'title' | 'resource_type'>): TrashItem {
  return {
    preview: '',
    deleted_at: '2026-10-01T00:00:00',
    purge_after: '2026-12-01T00:00:00',
    deleted_by_user_id: null,
    deleted_by_name: null,
    batch_id: 'b',
    parent_entry_id: null,
    restore_hint: {},
    resource_id: partial.id,
    ...partial,
  }
}

describe('filterBinItems', () => {
  const rows = [
    item({ id: '1', title: 'Acme invoice', resource_type: 'conversation' }),
    item({ id: '2', title: 'Website rebuild', resource_type: 'project' }),
    item({ id: '3', title: 'Ada Contact', resource_type: 'contact', preview: 'ada@acme.com', deleted_by_name: 'Lorenzo' }),
  ]

  it('filters by type chip', () => {
    expect(filterBinItems(rows, 'project', '').map((r) => r.id)).toEqual(['2'])
  })

  it('searches title and preview', () => {
    expect(filterBinItems(rows, null, 'acme').map((r) => r.id)).toEqual(['1', '3'])
  })

  it('searches who deleted the item', () => {
    expect(filterBinItems(rows, null, 'lorenzo').map((r) => r.id)).toEqual(['3'])
  })
})
