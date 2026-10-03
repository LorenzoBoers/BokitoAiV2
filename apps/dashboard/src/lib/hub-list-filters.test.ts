import { describe, expect, it } from 'vitest'
import { configForLeaf, mergeHubThreadFilters, threadFitsChannelChip } from './hub-list-filters'

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
})

describe('mergeHubThreadFilters', () => {
  it('maps a mailbox chip to channel plus connection id', () => {
    const merged = mergeHubThreadFilters({ folder: 'inbox', view: 'for_you' }, { channel: 'email:12' })
    expect(merged.channel).toBe('email')
    expect(merged.connectionId).toBe(12)
    expect(merged.view).toBe('for_you')
  })

  it('keeps the list unscoped without a chip', () => {
    const merged = mergeHubThreadFilters({ folder: 'inbox', view: 'all_open' }, { channel: null, agentId: 'a-1' })
    expect(merged.channel).toBeUndefined()
    expect(merged.connectionId).toBeUndefined()
    expect(merged.agentId).toBe('a-1')
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
