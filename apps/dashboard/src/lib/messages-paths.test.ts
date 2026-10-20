import { describe, expect, it } from 'vitest'
import {
  agentChatPath,
  channelPath,
  filtersForChannelChip,
  forYouPath,
  inboxPath,
  leafFromPath,
  normalizeThreadHref,
  leafKey,
  leafPath,
  newConversationPathForLeaf,
  legacyHubRedirect,
  sameLeafScope,
  SUB_QUEUES,
  type HubLeaf,
} from './messages-paths'
import { folderScopeKey, parseInboxFolderPrefs, resolveDefaultQueue } from './inbox-folder-prefs'

describe('normalizeThreadHref', () => {
  it('opens the short /threads form on All and leaves hub paths alone', () => {
    expect(normalizeThreadHref('/threads/sig-1')).toBe('/communication/inbox/all/t/sig-1')
    expect(normalizeThreadHref('/threads/sig-1?message=m1')).toBe(
      '/communication/inbox/all/t/sig-1?message=m1',
    )
    expect(normalizeThreadHref('/communication/inbox/open/t/sig-1')).toBe(
      '/communication/inbox/open/t/sig-1',
    )
  })
})

describe('newConversationPathForLeaf', () => {
  it('opens the conversation type of the folder you are in', () => {
    expect(newConversationPathForLeaf({ type: 'inbox' })).toBe('/communication/new')
    expect(newConversationPathForLeaf({ type: 'agent', agentId: 'a1' })).toBe(
      '/communication/new?intent=agent&agent=a1',
    )
    expect(
      newConversationPathForLeaf({ type: 'channel', channelKey: 'email', connectionId: '12' }),
    ).toBe('/communication/new?intent=contact&connectionId=12')
    expect(newConversationPathForLeaf({ type: 'channel', channelKey: 'whatsapp' })).toBe(
      '/communication/new?intent=whatsapp',
    )
    expect(newConversationPathForLeaf({ type: 'channel', channelKey: 'webchat' })).toBe(
      '/communication/new?intent=channel&channel=widget',
    )
    expect(newConversationPathForLeaf({ type: 'tag', tag: '#refund' })).toBe(
      '/communication/new?intent=ticket&tag=refund',
    )
    expect(newConversationPathForLeaf({ type: 'team', teamId: 'tm-1' })).toBe('/communication/new')
    expect(newConversationPathForLeaf({ type: 'project', projectId: 'p1' })).toBe('/communication/new')
  })
})

describe('leaf path round-trips', () => {
  const leaves: HubLeaf[] = [
    { type: 'inbox', queue: 'for_you' },
    { type: 'inbox', queue: 'spam' },
    { type: 'team', teamId: 'tm-1' },
    { type: 'team', teamId: 'tm-1', queue: 'unassigned' },
    { type: 'channel', channelKey: 'webchat', queue: 'open' },
    { type: 'channel', channelKey: 'email', connectionId: '12', queue: 'for_you' },
    { type: 'agent', agentId: 'a1', queue: 'open' },
    { type: 'tag', tag: 'refund-request', queue: 'open' },
    { type: 'tag', tag: 'vip' },
    { type: 'project', projectId: 'p-1', queue: 'unassigned' },
  ]

  it.each(leaves.map((leaf) => [leafKey(leaf), leaf] as const))('round-trips %s', (_key, leaf) => {
    expect(leafFromPath(leafPath(leaf))).toEqual(leaf)
  })

  it('builds hashtag and project paths', () => {
    expect(leafPath({ type: 'tag', tag: 'refund-request', queue: 'open' })).toBe('/communication/tag/refund-request/open')
    expect(leafPath({ type: 'project', projectId: 'p-1', queue: 'closed' }, 't-9')).toBe(
      '/communication/folder/p-1/closed/t/t-9',
    )
    expect(leafKey({ type: 'tag', tag: 'vip', queue: 'open' })).toBe('tag:vip:open')
    expect(sameLeafScope({ type: 'tag', tag: 'vip', queue: 'open' }, { type: 'tag', tag: 'vip' })).toBe(true)
    expect(sameLeafScope({ type: 'tag', tag: 'vip' }, { type: 'tag', tag: 'billing' })).toBe(false)
  })

  it('round-trips with a thread id suffix', () => {
    const leaf: HubLeaf = { type: 'team', teamId: 'tm-7', queue: 'for_you' }
    expect(leafFromPath(leafPath(leaf, 'abc-123'))).toEqual(leaf)
    expect(leafPath(leaf, 'abc-123')).toBe('/communication/team/tm-7/for_you/t/abc-123')
  })

  it('maps legacy mine to for_you on channel folders', () => {
    expect(leafFromPath('/communication/channel/email/12/mine')).toEqual({
      type: 'channel',
      channelKey: 'email',
      connectionId: '12',
      queue: 'for_you',
    })
  })

  it('drops an unknown queue segment instead of failing', () => {
    expect(leafFromPath('/communication/team/tm-1/bogus')).toEqual({
      type: 'team',
      teamId: 'tm-1',
    })
  })

  it('keeps sub-queue leaves distinct in leafKey', () => {
    const keys = new Set(SUB_QUEUES.map((queue) => leafKey({ type: 'team', teamId: 'x', queue })))
    expect(keys.size).toBe(SUB_QUEUES.length)
  })

  it('round-trips an inbox folder without a queue', () => {
    expect(leafFromPath('/communication/inbox')).toEqual({ type: 'inbox' })
    expect(leafPath({ type: 'inbox' })).toBe('/communication/inbox')
    expect(leafKey({ type: 'inbox', queue: 'open' })).toBe('inbox:open')
  })
})

describe('sameLeafScope', () => {
  it('matches inbox scope regardless of queue', () => {
    expect(sameLeafScope({ type: 'inbox', queue: 'open' }, { type: 'inbox' })).toBe(true)
  })

  it('matches the same team only', () => {
    expect(sameLeafScope({ type: 'team', teamId: '1', queue: 'open' }, { type: 'team', teamId: '1' })).toBe(true)
    expect(sameLeafScope({ type: 'team', teamId: '1' }, { type: 'team', teamId: '2' })).toBe(false)
    expect(sameLeafScope({ type: 'team', teamId: '1' }, { type: 'inbox' })).toBe(false)
  })

  it('matches channel and agent scopes', () => {
    expect(
      sameLeafScope(
        { type: 'channel', channelKey: 'email', connectionId: '12', queue: 'open' },
        { type: 'channel', channelKey: 'email', connectionId: '12' },
      ),
    ).toBe(true)
    expect(
      sameLeafScope(
        { type: 'agent', agentId: 'a1', queue: 'closed' },
        { type: 'agent', agentId: 'a1' },
      ),
    ).toBe(true)
  })
})

describe('folder paths', () => {
  it('builds channel and agent folder URLs', () => {
    expect(channelPath('email', { connectionId: 12, queue: 'open' })).toBe(
      '/communication/channel/email/12/open',
    )
    expect(channelPath('webchat', { queue: 'closed' })).toBe('/communication/channel/webchat/closed')
    expect(agentChatPath('a1', { queue: 'open', threadId: 't9' })).toBe(
      '/communication/agent/a1/open/t/t9',
    )
    expect(agentChatPath('a1', 't9')).toBe('/communication/agent/a1/t/t9')
  })

  it('keeps extra params on For you and drops the legacy filter', () => {
    expect(forYouPath('sig-2', { message: 'msg-9' })).toBe('/communication/inbox/for_you/t/sig-2?message=msg-9')
    expect(forYouPath(null, 'filter=needsDecision&agent=a1')).toBe('/communication/inbox/for_you?agent=a1')
    expect(forYouPath(null, { agent: 'a1', needs_decision: '1' })).toBe(
      '/communication/inbox/for_you?agent=a1&needs_decision=1',
    )
  })

  it('maps chips to list filters', () => {
    expect(filtersForChannelChip('email:12')).toEqual({ channel: 'email', connectionId: 12 })
    expect(filtersForChannelChip('whatsapp')).toEqual({ channel: 'whatsapp' })
    expect(filtersForChannelChip('webchat')).toEqual({ channel: 'widget' })
    expect(filtersForChannelChip(null)).toEqual({})
  })
})

describe('legacyHubRedirect', () => {
  it('maps retired folders; leaves channel and agent alone', () => {
    expect(legacyHubRedirect('/communication/decisions/t/s1', '?message=m1')).toBe(
      '/communication/inbox/for_you/t/s1?message=m1',
    )
    expect(legacyHubRedirect('/communication/runs/results/t/r1')).toBe('/communication/inbox/all/t/r1')
    expect(legacyHubRedirect('/communication/runs/all')).toBe('/agents#activity')
    expect(legacyHubRedirect('/communication/agent/a1/open/t/t1')).toBeNull()
    expect(legacyHubRedirect('/communication/channel/email/12/mine')).toBeNull()
    expect(legacyHubRedirect('/communication/inbox/mine')).toBe('/communication/inbox/for_you')
    expect(legacyHubRedirect('/communication/inbox/open')).toBeNull()
  })
})

describe('default queue resolution', () => {
  it('parses server preferences and falls back safely', () => {
    expect(parseInboxFolderPrefs(null)).toEqual({ defaultQueue: 'for_you', channelDefaults: {} })
    expect(
      parseInboxFolderPrefs({
        default_queue: 'open',
        channel_defaults: { 'team:tm-1': 'closed', bogus: 'nope' },
      }),
    ).toEqual({ defaultQueue: 'open', channelDefaults: { 'team:tm-1': 'closed' } })
  })

  it('opens All communication on the saved work queue and other rows on their list', () => {
    const prefs = parseInboxFolderPrefs({ default_queue: 'open', channel_defaults: { 'team:tm-1': 'for_you' } })
    expect(resolveDefaultQueue(prefs, { type: 'team', teamId: 'tm-1' })).toBe('open')
    expect(resolveDefaultQueue(prefs, { type: 'inbox' })).toBe('open')
    expect(resolveDefaultQueue(parseInboxFolderPrefs({ default_queue: 'closed' }), { type: 'inbox' })).toBe('for_you')
    expect(
      resolveDefaultQueue(prefs, { type: 'agent', agentId: 'a1' }),
    ).toBe('open')
    expect(
      resolveDefaultQueue(prefs, { type: 'channel', channelKey: 'email', connectionId: '12' }),
    ).toBe('open')
    expect(
      resolveDefaultQueue(prefs, { type: 'project', projectId: 'p1' }),
    ).toBe('open')
  })

  it('scope keys ignore the sub-queue', () => {
    expect(folderScopeKey({ type: 'team', teamId: 'tm-1', queue: 'closed' })).toBe('team:tm-1')
    expect(folderScopeKey({ type: 'inbox', queue: 'for_you' })).toBe('inbox')
    expect(folderScopeKey({ type: 'channel', channelKey: 'email', connectionId: '12', queue: 'open' })).toBe(
      'channel:email:12',
    )
    expect(folderScopeKey({ type: 'agent', agentId: 'a1', queue: 'open' })).toBe('agent:a1')
  })
})
