/**
 * Map Communication hub leaves to `GET /api/signals` filters.
 */

import type { InboxThread, ThreadFilters } from './inbox-api'
import {
  SUB_QUEUE_TO_VIEW,
  filtersForChannelChip,
  type ChannelChip,
  type ChannelKey,
  type HubLeaf,
  type InboxQueue,
} from './messages-paths'

type View = NonNullable<ThreadFilters['view']>

const INBOX_QUEUE_TO_VIEW: Record<InboxQueue, View> = {
  all: 'all',
  for_you: 'for_you',
  open: 'all_open',
  unassigned: 'unassigned',
  snoozed: 'snoozed',
  closed: 'closed',
  spam: 'spam',
}

export type LeafConfig = {
  filters: Omit<ThreadFilters, 'search'>
  mode: 'customer' | 'agent'
  variant: 'customer' | 'direct'
}

/** Nav channel key → stored `Signal.channel` value. */
export function signalChannelForNavKey(channelKey: ChannelKey | string): string | undefined {
  if (channelKey === 'webchat') return 'widget'
  if (channelKey === 'internal' || channelKey === 'agent') return 'internal'
  if (channelKey === 'email') return undefined
  return channelKey
}

/** Map the active sidebar leaf to thread filters and rendering mode. */
export function configForLeaf(leaf: HubLeaf): LeafConfig {
  switch (leaf.type) {
    case 'inbox':
      return {
        filters: { folder: 'inbox', view: INBOX_QUEUE_TO_VIEW[leaf.queue ?? 'all'] },
        mode: 'customer',
        variant: 'customer',
      }
    case 'team':
      return {
        filters: {
          folder: 'inbox',
          view: leaf.queue ? SUB_QUEUE_TO_VIEW[leaf.queue] : 'all_open',
          teamId: leaf.teamId,
        },
        mode: 'customer',
        variant: 'customer',
      }
    case 'channel': {
      const view: View = leaf.queue ? SUB_QUEUE_TO_VIEW[leaf.queue] : 'all'
      if (leaf.channelKey === 'email') {
        return {
          filters: {
            folder: 'external',
            channel: 'email',
            view,
            connectionId: leaf.connectionId ? Number(leaf.connectionId) : undefined,
          },
          mode: 'customer',
          variant: 'customer',
        }
      }
      if (leaf.channelKey === 'agent') {
        return { filters: { folder: 'internal', view: 'internal' }, mode: 'agent', variant: 'customer' }
      }
      const channel = signalChannelForNavKey(leaf.channelKey)
      return {
        filters: { view, channel },
        mode: leaf.channelKey === 'internal' ? 'agent' : 'customer',
        variant: 'customer',
      }
    }
    case 'agent':
      // Activity is the agent's work log; chat sub-queues use the assistant folder.
      if (leaf.queue === 'activity') {
        return {
          filters: { folder: 'internal', view: 'internal', agentId: leaf.agentId },
          mode: 'agent',
          variant: 'customer',
        }
      }
      return {
        filters: {
          folder: 'assistant',
          view: leaf.queue ? SUB_QUEUE_TO_VIEW[leaf.queue] : 'all_open',
          agentId: leaf.agentId,
        },
        mode: 'customer',
        variant: 'direct',
      }
    case 'tag':
      return {
        filters: { folder: 'inbox', view: leaf.queue ? SUB_QUEUE_TO_VIEW[leaf.queue] : 'all_open', tag: leaf.tag },
        mode: 'customer',
        variant: 'customer',
      }
    case 'project':
      return {
        filters: {
          folder: 'inbox',
          view: leaf.queue ? SUB_QUEUE_TO_VIEW[leaf.queue] : 'all_open',
          projectId: leaf.projectId,
        },
        mode: 'customer',
        variant: 'customer',
      }
  }
}

/** Merge leaf-scoped filters with list toolbar extras. */
export function mergeHubThreadFilters(
  leafFilters: Omit<ThreadFilters, 'search'>,
  extras: {
    search?: string
    projectId?: string
    categoryId?: string
    tag?: string
    stage?: string
    agentId?: string
    unread?: boolean
    pinnedOnly?: boolean
    assigneeId?: number | null
    needsDecision?: boolean
    /** @deprecated Prefer a channel leaf; still honored when set. */
    channel?: ChannelChip | null
  },
): ThreadFilters {
  const chip = filtersForChannelChip(extras.channel)
  return {
    ...leafFilters,
    search: extras.search,
    projectId: extras.projectId ?? leafFilters.projectId,
    categoryId: extras.categoryId,
    tag: extras.tag ?? leafFilters.tag,
    stage: extras.stage,
    agentId: extras.agentId ?? leafFilters.agentId,
    unread: extras.unread || undefined,
    pinnedOnly: extras.pinnedOnly || undefined,
    assigneeId: extras.assigneeId ?? undefined,
    needsDecision: extras.needsDecision || undefined,
    view: extras.needsDecision ? 'awaiting_decision' : leafFilters.view,
    channel: chip.channel ?? leafFilters.channel,
    connectionId: chip.connectionId ?? leafFilters.connectionId,
  }
}

/** Does this thread belong under the active channel leaf? */
export function threadFitsChannelLeaf(
  thread: Pick<InboxThread, 'channel' | 'emailConnectionId'>,
  leaf: Extract<HubLeaf, { type: 'channel' }>,
): boolean {
  const channel = (thread.channel ?? '').toLowerCase()
  if (leaf.channelKey === 'email') {
    if (channel !== 'email') return false
    if (leaf.connectionId != null && leaf.connectionId !== '') {
      const expected = Number(leaf.connectionId)
      if (Number.isFinite(expected) && expected > 0) {
        return thread.emailConnectionId === expected
      }
    }
    return true
  }
  if (leaf.channelKey === 'agent' || leaf.channelKey === 'internal') {
    return channel === 'internal'
  }
  const expected = signalChannelForNavKey(leaf.channelKey)
  if (expected === 'widget') return ['widget', 'chat', 'webchat', 'livechat'].includes(channel)
  return expected != null && channel === expected
}

/** @deprecated Use {@link threadFitsChannelLeaf} with a channel folder. */
export function threadFitsChannelChip(
  thread: Pick<InboxThread, 'channel' | 'emailConnectionId'>,
  chip: ChannelChip | null | undefined,
): boolean {
  if (!chip) return true
  const { channel, connectionId } = filtersForChannelChip(chip)
  const actual = (thread.channel ?? '').toLowerCase()
  if (channel === 'widget') return ['widget', 'chat', 'webchat', 'livechat'].includes(actual)
  if (actual !== channel) return false
  return connectionId == null || thread.emailConnectionId === connectionId
}
