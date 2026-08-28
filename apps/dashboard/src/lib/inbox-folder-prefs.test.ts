import { describe, expect, it } from 'vitest'
import {
  cleanSidebarTags,
  parseInboxFolderPrefs,
} from './inbox-folder-prefs'
import { mergeSidebarTagRows } from './signals-api'

describe('inbox folder prefs sidebar tags', () => {
  it('parses sidebar_tags with normalize and dedupe', () => {
    const prefs = parseInboxFolderPrefs({
      default_queue: 'mine',
      channel_defaults: { 'channel:email:1': 'open' },
      sidebar_tags: ['Billing', 'vip', 'billing', '  ', 12],
    })
    expect(prefs.defaultQueue).toBe('mine')
    expect(prefs.channelDefaults).toEqual({ 'channel:email:1': 'open' })
    expect(prefs.sidebarTags).toEqual(['billing', 'vip'])
  })

  it('defaults sidebar_tags to empty', () => {
    expect(cleanSidebarTags(undefined)).toEqual([])
    expect(parseInboxFolderPrefs({}).sidebarTags).toEqual([])
  })
})

describe('mergeSidebarTagRows', () => {
  it('puts pinned tags first and keeps used catalog tags', () => {
    const rows = mergeSidebarTagRows(
      ['vip', 'missing'],
      [
        { tag: 'billing', total: 2, open: 1, description: '', registered: true },
        { tag: 'vip', total: 5, open: 3, description: 'Key accounts', registered: true },
      ],
    )
    expect(rows.map((r) => r.tag)).toEqual(['vip', 'missing', 'billing'])
    expect(rows[0].open).toBe(3)
    expect(rows[1]).toEqual({
      tag: 'missing',
      total: 0,
      open: 0,
      description: '',
      registered: false,
    })
  })
})
