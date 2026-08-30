/**
 * Map Communication hub leaves to `GET /api/signals` filters and check whether
 * an open thread still belongs under the active channel/tag leaf.
 *
 * Inbox-only UI chips (channelFilter) must never wipe a leaf-scoped `channel`.
 */

import type { InboxThread, ThreadFilters } from './inbox-api'
import {
  SUB_QUEUE_TO_VIEW,
  type ChannelKey,
  type HubLeaf,
  type InboxQueue,
  type RunsQueue,
} from './messages-paths'

type View = NonNullable<ThreadFilters['view']>

const INBOX_QUEUE_TO_VIEW: Record<InboxQueue, View> = {
  all: 'all',
  mine: 'mine',
  open: 'all_open',
  unassigned: 'unassigned',
  snoozed: 'snoozed',
  closed: 'closed',
  spam: 'spam',
}

const RUNS_QUEUE_TO_VIEW: Record<string, View> = {
  all: 'internal',
  updates: 'updates',
  results: 'results',
  'awaiting-decision': 'awaiting_decision',
}

export type LeafConfig = {
  filters: Omit<ThreadFilters, 'search' | 'projectId'>
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
    case 'runs':
      // Decisions can sit on email/widget threads as well as internal run
      // threads — do not scope that queue to folder=internal or Cockpit's
      // "Awaiting decision" count will open an empty list.
      if (leaf.queue === 'awaiting-decision') {
        return {
          filters: { view: 'awaiting_decision' },
          mode: 'agent',
          variant: 'customer',
        }
      }
      return {
        filters: {
          folder: 'internal',
          view: RUNS_QUEUE_TO_VIEW[leaf.queue as RunsQueue] ?? 'internal',
        },
        mode: 'agent',
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
    case 'tag':
      return {
        filters: {
          folder: 'inbox',
          view: leaf.queue ? SUB_QUEUE_TO_VIEW[leaf.queue] : 'all',
          tag: leaf.tag,
        },
        mode: 'customer',
        variant: 'customer',
      }
    default:
      // agent chats are handled by DirectCommunication
      return { filters: { folder: 'inbox', view: 'all' }, mode: 'customer', variant: 'customer' }
  }
}

/**
 * Merge leaf-scoped filters with inbox-only UI chips.
 * Inbox `channelFilter` must not replace a channel leaf's `channel` (e.g. widget).
 */
export function mergeHubThreadFilters(
  leaf: HubLeaf,
  leafFilters: Omit<ThreadFilters, 'search' | 'projectId'>,
  extras: {
    search?: string
    projectId?: string
    agentId?: string
    unread?: boolean
    needsReply?: boolean
    needsDecision?: boolean
    pinnedOnly?: boolean
    assigneeId?: number | null
    channelFilter?: string | null
  },
): ThreadFilters {
  const inboxChannel =
    leaf.type === 'inbox' ? (extras.channelFilter ?? undefined) : leafFilters.channel
  return {
    ...leafFilters,
    search: extras.search,
    projectId: extras.projectId,
    agentId: extras.agentId,
    unread: extras.unread || undefined,
    needsReply: extras.needsReply || undefined,
    needsDecision: extras.needsDecision || undefined,
    pinnedOnly: extras.pinnedOnly || undefined,
    assigneeId: extras.assigneeId ?? undefined,
    channel: inboxChannel,
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
  return expected != null && channel === expected
}

/** Does this thread belong under the active tag leaf? */
export function threadFitsTagLeaf(
  thread: Pick<InboxThread, 'tags'>,
  leaf: Extract<HubLeaf, { type: 'tag' }>,
): boolean {
  return thread.tags.includes(leaf.tag)
}
