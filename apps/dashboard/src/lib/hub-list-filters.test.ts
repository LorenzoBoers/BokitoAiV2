import { describe, expect, it } from 'vitest'
import {
  configForLeaf,
  mergeHubThreadFilters,
  signalChannelForNavKey,
  threadFitsChannelLeaf,
  threadFitsTagLeaf,
} from './hub-list-filters'
import type { HubLeaf } from './messages-paths'

describe('signalChannelForNavKey', () => {
  it('maps nav keys to stored Signal.channel values', () => {
    expect(signalChannelForNavKey('webchat')).toBe('widget')
    expect(signalChannelForNavKey('whatsapp')).toBe('whatsapp')
    expect(signalChannelForNavKey('slack')).toBe('slack')
    expect(signalChannelForNavKey('internal')).toBe('internal')
    expect(signalChannelForNavKey('email')).toBeUndefined()
  })
})

describe('configForLeaf', () => {
  it('scopes Websitechat Open to channel=widget + all_open', () => {
    const leaf: HubLeaf = { type: 'channel', channelKey: 'webchat', queue: 'open' }
    expect(configForLeaf(leaf).filters).toEqual({ view: 'all_open', channel: 'widget' })
  })

  it('scopes email mailbox leaves by connectionId', () => {
    const leaf: HubLeaf = {
      type: 'channel',
      channelKey: 'email',
      connectionId: '12',
      queue: 'mine',
    }
    expect(configForLeaf(leaf).filters).toEqual({
      folder: 'external',
      channel: 'email',
      view: 'mine',
      connectionId: 12,
    })
  })

  it('keeps awaiting-decision unscoped by folder', () => {
    const leaf: HubLeaf = { type: 'runs', queue: 'awaiting-decision' }
    expect(configForLeaf(leaf).filters).toEqual({ view: 'awaiting_decision' })
  })
})

describe('mergeHubThreadFilters', () => {
  it('preserves leaf channel when inbox channelFilter is null (webchat bug)', () => {
    const leaf: HubLeaf = { type: 'channel', channelKey: 'webchat', queue: 'open' }
    const leafFilters = configForLeaf(leaf).filters
    const merged = mergeHubThreadFilters(leaf, leafFilters, { channelFilter: null })
    expect(merged.channel).toBe('widget')
    expect(merged.view).toBe('all_open')
  })

  it('applies inbox channelFilter only on inbox leaves', () => {
    const leaf: HubLeaf = { type: 'inbox', queue: 'open' }
    const leafFilters = configForLeaf(leaf).filters
    const merged = mergeHubThreadFilters(leaf, leafFilters, { channelFilter: 'email' })
    expect(merged.channel).toBe('email')
    expect(merged.folder).toBe('inbox')
  })

  it('ignores inbox channelFilter on WhatsApp / Slack channel leaves', () => {
    const leaf: HubLeaf = { type: 'channel', channelKey: 'whatsapp', queue: 'open' }
    const leafFilters = configForLeaf(leaf).filters
    const merged = mergeHubThreadFilters(leaf, leafFilters, { channelFilter: 'email' })
    expect(merged.channel).toBe('whatsapp')
  })
})

describe('threadFitsChannelLeaf', () => {
  it('accepts widget threads under webchat and rejects email', () => {
    const leaf: Extract<HubLeaf, { type: 'channel' }> = {
      type: 'channel',
      channelKey: 'webchat',
      queue: 'open',
    }
    expect(threadFitsChannelLeaf({ channel: 'widget', emailConnectionId: null }, leaf)).toBe(true)
    expect(threadFitsChannelLeaf({ channel: 'email', emailConnectionId: 1 }, leaf)).toBe(false)
  })

  it('matches email mailbox by connectionId', () => {
    const leaf: Extract<HubLeaf, { type: 'channel' }> = {
      type: 'channel',
      channelKey: 'email',
      connectionId: '7',
      queue: 'open',
    }
    expect(threadFitsChannelLeaf({ channel: 'email', emailConnectionId: 7 }, leaf)).toBe(true)
    expect(threadFitsChannelLeaf({ channel: 'email', emailConnectionId: 9 }, leaf)).toBe(false)
    expect(threadFitsChannelLeaf({ channel: 'widget', emailConnectionId: 7 }, leaf)).toBe(false)
  })
})

describe('threadFitsTagLeaf', () => {
  it('requires the tag on the thread', () => {
    const leaf: Extract<HubLeaf, { type: 'tag' }> = { type: 'tag', tag: 'billing', queue: 'open' }
    expect(threadFitsTagLeaf({ tags: ['billing', 'vip'] }, leaf)).toBe(true)
    expect(threadFitsTagLeaf({ tags: ['vip'] }, leaf)).toBe(false)
  })
})
