import { describe, expect, it } from 'vitest'
import { parseInboxFolderPrefs } from './inbox-folder-prefs'

describe('inbox folder preferences', () => {
  it('parses folder defaults and ignores retired tag preferences', () => {
    const prefs = parseInboxFolderPrefs({
      default_queue: 'mine',
      channel_defaults: { 'channel:email:1': 'open' },
      sidebar_tags: ['Billing', 'vip', 'billing', '  ', 12],
    })
    expect(prefs.defaultQueue).toBe('mine')
    expect(prefs.channelDefaults).toEqual({ 'channel:email:1': 'open' })
    expect(prefs).not.toHaveProperty('sidebarTags')
  })
})
