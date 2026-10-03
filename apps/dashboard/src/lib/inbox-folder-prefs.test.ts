import { describe, expect, it } from 'vitest'
import { parseInboxFolderPrefs } from './inbox-folder-prefs'

describe('inbox folder preferences', () => {
  it('parses folder defaults and ignores retired tag preferences', () => {
    const prefs = parseInboxFolderPrefs({
      default_queue: 'unassigned',
      channel_defaults: { 'team:tm-1': 'open' },
      sidebar_tags: ['Billing', 'vip', 'billing', '  ', 12],
    })
    expect(prefs.defaultQueue).toBe('unassigned')
    expect(prefs.channelDefaults).toEqual({ 'team:tm-1': 'open' })
    expect(prefs).not.toHaveProperty('sidebarTags')
  })
})
