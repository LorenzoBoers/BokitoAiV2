import { describe, expect, it } from 'vitest'
import {
  leafFromPath,
  leafKey,
  leafPath,
  sameLeafScope,
  SUB_QUEUES,
  type HubLeaf,
} from './messages-paths'
import { folderScopeKey, parseInboxFolderPrefs, resolveDefaultQueue } from './inbox-folder-prefs'

describe('leaf path round-trips', () => {
  const leaves: HubLeaf[] = [
    { type: 'inbox', queue: 'mine' },
    { type: 'channel', channelKey: 'email', connectionId: '12' },
    { type: 'channel', channelKey: 'email', connectionId: '12', queue: 'mine' },
    { type: 'channel', channelKey: 'email', queue: 'open' },
    { type: 'channel', channelKey: 'webchat' },
    { type: 'channel', channelKey: 'webchat', queue: 'closed' },
    { type: 'tag', tag: 'billing' },
    { type: 'tag', tag: 'billing', queue: 'unassigned' },
    { type: 'tag', tag: 'follow up' },
  ]

  it.each(leaves.map((leaf) => [leafKey(leaf), leaf] as const))('round-trips %s', (_key, leaf) => {
    expect(leafFromPath(leafPath(leaf))).toEqual(leaf)
  })

  it('round-trips with a thread id suffix', () => {
    const leaf: HubLeaf = { type: 'channel', channelKey: 'email', connectionId: '7', queue: 'mine' }
    expect(leafFromPath(leafPath(leaf, 'abc-123'))).toEqual(leaf)
  })

  it('builds the expected URLs', () => {
    expect(leafPath({ type: 'channel', channelKey: 'email', connectionId: '12', queue: 'mine' })).toBe(
      '/communication/channel/email/12/mine',
    )
    expect(leafPath({ type: 'channel', channelKey: 'webchat', queue: 'open' })).toBe(
      '/communication/channel/webchat/open',
    )
    expect(leafPath({ type: 'tag', tag: 'billing', queue: 'open' })).toBe(
      '/communication/tag/billing/open',
    )
  })

  it('drops an unknown queue segment instead of failing', () => {
    expect(leafFromPath('/communication/channel/webchat/bogus')).toEqual({
      type: 'channel',
      channelKey: 'webchat',
      queue: undefined,
    })
    expect(leafFromPath('/communication/tag/billing/bogus')).toEqual({
      type: 'tag',
      tag: 'billing',
      queue: undefined,
    })
  })

  it('still treats a numeric email segment as a connection id', () => {
    expect(leafFromPath('/communication/channel/email/12')).toEqual({
      type: 'channel',
      channelKey: 'email',
      connectionId: '12',
      queue: undefined,
    })
  })

  it('encodes tags with special characters', () => {
    const leaf: HubLeaf = { type: 'tag', tag: 'follow up', queue: 'open' }
    expect(leafPath(leaf)).toBe('/communication/tag/follow%20up/open')
    expect(leafFromPath(leafPath(leaf))).toEqual(leaf)
  })

  it('keeps sub-queue leaves distinct in leafKey', () => {
    const keys = new Set(
      SUB_QUEUES.map((queue) =>
        leafKey({ type: 'channel', channelKey: 'email', connectionId: '1', queue }),
      ),
    )
    expect(keys.size).toBe(SUB_QUEUES.length)
  })
})

describe('sameLeafScope', () => {
  it('matches the same channel regardless of queue', () => {
    expect(
      sameLeafScope(
        { type: 'channel', channelKey: 'email', connectionId: '1', queue: 'mine' },
        { type: 'channel', channelKey: 'email', connectionId: '1' },
      ),
    ).toBe(true)
  })

  it('does not match a different mailbox', () => {
    expect(
      sameLeafScope(
        { type: 'channel', channelKey: 'email', connectionId: '1' },
        { type: 'channel', channelKey: 'email', connectionId: '2' },
      ),
    ).toBe(false)
  })

  it('round-trips agent folders with queues', () => {
    const leaves: HubLeaf[] = [
      { type: 'agent', agentId: 'abc' },
      { type: 'agent', agentId: 'abc', queue: 'mine' },
    ]
    for (const leaf of leaves) {
      expect(leafFromPath(leafPath(leaf))).toEqual(leaf)
    }
    expect(leafPath({ type: 'agent', agentId: 'abc', queue: 'open' })).toBe(
      '/communication/agent/abc/open',
    )
  })

  it('matches agent scopes regardless of queue', () => {
    expect(
      sameLeafScope(
        { type: 'agent', agentId: '1', queue: 'open' },
        { type: 'agent', agentId: '1' },
      ),
    ).toBe(true)
    expect(
      sameLeafScope({ type: 'agent', agentId: '1' }, { type: 'agent', agentId: '2' }),
    ).toBe(false)
  })

  it('matches inbox scope regardless of queue', () => {
    expect(sameLeafScope({ type: 'inbox', queue: 'open' }, { type: 'inbox' })).toBe(true)
    expect(sameLeafScope({ type: 'inbox', queue: 'mine' }, { type: 'inbox', queue: 'spam' })).toBe(true)
  })

  it('round-trips an inbox folder without a queue', () => {
    expect(leafFromPath('/communication/inbox')).toEqual({ type: 'inbox' })
    expect(leafPath({ type: 'inbox' })).toBe('/communication/inbox')
    expect(leafPath({ type: 'inbox', queue: 'open' })).toBe('/communication/inbox/open')
    expect(leafKey({ type: 'inbox' })).toBe('inbox')
    expect(leafKey({ type: 'inbox', queue: 'open' })).toBe('inbox:open')
  })

  it('matches the same tag regardless of queue', () => {
    expect(
      sameLeafScope({ type: 'tag', tag: 'vip', queue: 'closed' }, { type: 'tag', tag: 'vip' }),
    ).toBe(true)
    expect(sameLeafScope({ type: 'tag', tag: 'vip' }, { type: 'tag', tag: 'billing' })).toBe(false)
  })
})

describe('default queue resolution', () => {
  it('parses server preferences and falls back safely', () => {
    expect(parseInboxFolderPrefs(null)).toEqual({
      defaultQueue: 'open',
      channelDefaults: {},
      sidebarTags: [],
    })
    expect(
      parseInboxFolderPrefs({
        default_queue: 'mine',
        channel_defaults: { 'channel:email:12': 'closed', bogus: 'nope' },
      }),
    ).toEqual({
      defaultQueue: 'mine',
      channelDefaults: { 'channel:email:12': 'closed' },
      sidebarTags: [],
    })
  })

  it('resolves the per-channel override before the global default', () => {
    const prefs = parseInboxFolderPrefs({
      default_queue: 'open',
      channel_defaults: { 'channel:email:12': 'mine' },
    })
    expect(
      resolveDefaultQueue(prefs, { type: 'channel', channelKey: 'email', connectionId: '12' }),
    ).toBe('mine')
    expect(resolveDefaultQueue(prefs, { type: 'channel', channelKey: 'webchat' })).toBe('open')
    expect(resolveDefaultQueue(prefs, { type: 'tag', tag: 'billing' })).toBe('open')
  })

  it('scope keys ignore the sub-queue', () => {
    expect(
      folderScopeKey({ type: 'channel', channelKey: 'email', connectionId: '12', queue: 'mine' }),
    ).toBe('channel:email:12')
    expect(folderScopeKey({ type: 'tag', tag: 'vip', queue: 'open' })).toBe('tag:vip')
    expect(folderScopeKey({ type: 'agent', agentId: 'a1', queue: 'closed' })).toBe('agent:a1')
    expect(folderScopeKey({ type: 'inbox', queue: 'mine' })).toBe('inbox')
  })
})
