import { describe, expect, it } from 'vitest'
import {
  configForLeaf,
  mergeHubThreadFilters,
  signalChannelForNavKey,
  threadFitsChannelLeaf,
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

  it('keeps Decisions unscoped by folder', () => {
    const leaf: HubLeaf = { type: 'decisions' }
    expect(configForLeaf(leaf).filters).toEqual({ view: 'awaiting_decision' })
    expect(configForLeaf(leaf).mode).toBe('agent')
  })

  it('scopes company-agent chat leaves to assistant folder with shared actions', () => {
    const leaf: HubLeaf = { type: 'agent', agentId: 'agent-9', queue: 'open' }
    const cfg = configForLeaf(leaf)
    expect(cfg.filters).toEqual({
      folder: 'assistant',
      view: 'all_open',
      agentId: 'agent-9',
    })
    expect(cfg.mode).toBe('customer')
    expect(cfg.variant).toBe('direct')
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

  it('ignores sticky Needs-decision extras so folders stay independent', () => {
    const leaf: HubLeaf = { type: 'inbox', queue: 'open' }
    const leafFilters = configForLeaf(leaf).filters
    const merged = mergeHubThreadFilters(leaf, leafFilters, { needsDecision: true })
    expect(merged.folder).toBe('inbox')
    expect(merged.needsDecision).toBeUndefined()
    expect(merged.view).toBe('all_open')
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
