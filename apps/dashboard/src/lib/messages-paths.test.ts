import { describe, expect, it } from 'vitest'
import {
  agentChatPath,
  channelPath,
  filtersForChannelChip,
  forYouPath,
  inboxPath,
  leafFromPath,
  leafKey,
  leafPath,
  legacyHubRedirect,
  sameLeafScope,
  SUB_QUEUES,
  type HubLeaf,
} from './messages-paths'
import { folderScopeKey, parseInboxFolderPrefs, resolveDefaultQueue } from './inbox-folder-prefs'

describe('leaf path round-trips', () => {
  const leaves: HubLeaf[] = [
    { type: 'inbox', queue: 'for_you' },
    { type: 'inbox', queue: 'spam' },
    { type: 'team', teamId: 'tm-1' },
    { type: 'team', teamId: 'tm-1', queue: 'unassigned' },
  ]

  it.each(leaves.map((leaf) => [leafKey(leaf), leaf] as const))('round-trips %s', (_key, leaf) => {
    expect(leafFromPath(leafPath(leaf))).toEqual(leaf.type === 'inbox' ? leaf : { queue: undefined, ...leaf })
  })

  it('round-trips with a thread id suffix', () => {
    const leaf: HubLeaf = { type: 'team', teamId: 'tm-7', queue: 'for_you' }
    expect(leafFromPath(leafPath(leaf, 'abc-123'))).toEqual(leaf)
    expect(leafPath(leaf, 'abc-123')).toBe('/communication/team/tm-7/for_you/t/abc-123')
  })

  it('drops an unknown queue segment instead of failing', () => {
    expect(leafFromPath('/communication/team/tm-1/bogus')).toEqual({
      type: 'team',
      teamId: 'tm-1',
      queue: undefined,
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
})

describe('chips and For you', () => {
  it('carries channel and agent chips in the query string', () => {
    expect(channelPath('email:12')).toBe('/communication/inbox/open?channel=email%3A12')
    expect(agentChatPath('a1', 't9')).toBe('/communication/inbox/all/t/t9?agent=a1')
    expect(inboxPath('for_you', null, { channel: 'widget', agentId: 'a1' })).toBe(
      '/communication/inbox/for_you?channel=widget&agent=a1',
    )
  })

  it('keeps extra params on For you and drops the legacy filter', () => {
    expect(forYouPath('sig-2', { message: 'msg-9' })).toBe('/communication/inbox/for_you/t/sig-2?message=msg-9')
    expect(forYouPath(null, 'filter=needsDecision&agent=a1')).toBe('/communication/inbox/for_you?agent=a1')
  })

  it('maps chips to list filters', () => {
    expect(filtersForChannelChip('email:12')).toEqual({ channel: 'email', connectionId: 12 })
    expect(filtersForChannelChip('whatsapp')).toEqual({ channel: 'whatsapp' })
    expect(filtersForChannelChip(null)).toEqual({})
  })
})

describe('legacyHubRedirect', () => {
  it('maps old folders onto All communication with chips', () => {
    expect(legacyHubRedirect('/communication/decisions/t/s1', '?message=m1')).toBe(
      '/communication/inbox/for_you/t/s1?message=m1',
    )
    expect(legacyHubRedirect('/communication/runs/results/t/r1')).toBe('/communication/inbox/all/t/r1')
    expect(legacyHubRedirect('/communication/runs/all')).toBe('/activity')
    expect(legacyHubRedirect('/communication/agent/a1/open/t/t1')).toBe('/communication/inbox/all/t/t1?agent=a1')
    expect(legacyHubRedirect('/communication/agent/a1/activity')).toBe('/activity?agent=a1')
    expect(legacyHubRedirect('/communication/channel/email/12/mine')).toBe(
      '/communication/inbox/for_you?channel=email%3A12',
    )
    expect(legacyHubRedirect('/communication/channel/webchat/closed/t/w1')).toBe(
      '/communication/inbox/closed/t/w1?channel=widget',
    )
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

  it('resolves the per-team override before the global default', () => {
    const prefs = parseInboxFolderPrefs({ default_queue: 'open', channel_defaults: { 'team:tm-1': 'for_you' } })
    expect(resolveDefaultQueue(prefs, { type: 'team', teamId: 'tm-1' })).toBe('for_you')
    expect(resolveDefaultQueue(prefs, { type: 'inbox' })).toBe('open')
  })

  it('scope keys ignore the sub-queue', () => {
    expect(folderScopeKey({ type: 'team', teamId: 'tm-1', queue: 'closed' })).toBe('team:tm-1')
    expect(folderScopeKey({ type: 'inbox', queue: 'for_you' })).toBe('inbox')
  })
})
