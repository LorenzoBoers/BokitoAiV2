import { describe, expect, it } from 'vitest'
import {
  configForLeaf,
  mergeHubThreadFilters,
  threadFitsChannelChip,
  threadFitsChannelLeaf,
} from './hub-list-filters'

describe('configForLeaf', () => {
  it('maps All communication sub-folders to list views', () => {
    expect(configForLeaf({ type: 'inbox', queue: 'for_you' }).filters).toEqual({ folder: 'inbox', view: 'for_you' })
    expect(configForLeaf({ type: 'inbox', queue: 'open' }).filters).toEqual({ folder: 'inbox', view: 'all_open' })
    expect(configForLeaf({ type: 'inbox', queue: 'snoozed' }).filters.view).toBe('snoozed')
    expect(configForLeaf({ type: 'inbox' }).filters.view).toBe('all')
  })

  it('scopes a pinned team to its id', () => {
    expect(configForLeaf({ type: 'team', teamId: 'tm-1', queue: 'unassigned' }).filters).toEqual({
      folder: 'inbox',
      view: 'unassigned',
      teamId: 'tm-1',
    })
    expect(configForLeaf({ type: 'team', teamId: 'tm-1' }).filters.view).toBe('all_open')
  })

  it('scopes channel and agent folders', () => {
    expect(
      configForLeaf({ type: 'channel', channelKey: 'email', connectionId: '12', queue: 'open' }).filters,
    ).toEqual({
      folder: 'external',
      channel: 'email',
      view: 'all_open',
      connectionId: 12,
    })
    expect(configForLeaf({ type: 'channel', channelKey: 'webchat', queue: 'for_you' }).filters).toEqual({
      view: 'for_you',
      channel: 'widget',
    })
    expect(configForLeaf({ type: 'agent', agentId: 'a1', queue: 'open' }).filters).toEqual({
      folder: 'assistant',
      view: 'all_open',
      agentId: 'a1',
    })
  })
})

describe('mergeHubThreadFilters', () => {
  it('keeps leaf channel when no chip is set', () => {
    const merged = mergeHubThreadFilters(
      { folder: 'external', channel: 'email', view: 'all_open', connectionId: 12 },
      { channel: null },
    )
    expect(merged.channel).toBe('email')
    expect(merged.connectionId).toBe(12)
  })

  it('keeps agent id from the leaf', () => {
    const merged = mergeHubThreadFilters(
      { folder: 'assistant', view: 'all_open', agentId: 'a-1' },
      {},
    )
    expect(merged.agentId).toBe('a-1')
  })

  it('switches the list to awaiting_decision when that query is set', () => {
    const merged = mergeHubThreadFilters(
      { folder: 'inbox', view: 'for_you' },
      { agentId: 'a-9', needsDecision: true },
    )
    expect(merged.view).toBe('awaiting_decision')
    expect(merged.agentId).toBe('a-9')
    expect(merged.needsDecision).toBe(true)
  })
})

describe('threadFitsChannelLeaf', () => {
  it('matches widget aliases and mailbox ids', () => {
    expect(
      threadFitsChannelLeaf(
        { channel: 'chat', emailConnectionId: null },
        { type: 'channel', channelKey: 'webchat' },
      ),
    ).toBe(true)
    expect(
      threadFitsChannelLeaf(
        { channel: 'email', emailConnectionId: 12 },
        { type: 'channel', channelKey: 'email', connectionId: '12' },
      ),
    ).toBe(true)
    expect(
      threadFitsChannelLeaf(
        { channel: 'email', emailConnectionId: 3 },
        { type: 'channel', channelKey: 'email', connectionId: '12' },
      ),
    ).toBe(false)
  })
})

describe('threadFitsChannelChip', () => {
  it('matches widget aliases and mailbox ids', () => {
    expect(threadFitsChannelChip({ channel: 'chat', emailConnectionId: null }, 'widget')).toBe(true)
    expect(threadFitsChannelChip({ channel: 'email', emailConnectionId: 12 }, 'email:12')).toBe(true)
    expect(threadFitsChannelChip({ channel: 'email', emailConnectionId: 3 }, 'email:12')).toBe(false)
    expect(threadFitsChannelChip({ channel: 'whatsapp', emailConnectionId: null }, 'email')).toBe(false)
    expect(threadFitsChannelChip({ channel: 'whatsapp', emailConnectionId: null }, null)).toBe(true)
  })
})
