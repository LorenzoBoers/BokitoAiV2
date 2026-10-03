/**
 * Map Communication hub leaves plus the channel and agent chips to
 * `GET /api/signals` filters.
 */

import type { InboxThread, ThreadFilters } from './inbox-api'
import {
  SUB_QUEUE_TO_VIEW,
  filtersForChannelChip,
  type ChannelChip,
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
  filters: Omit<ThreadFilters, 'search' | 'projectId'>
  mode: 'customer' | 'agent'
  variant: 'customer' | 'direct'
}

/** Map the active sidebar leaf to thread filters and rendering mode. */
export function configForLeaf(leaf: HubLeaf): LeafConfig {
  if (leaf.type === 'team') {
    return {
      filters: {
        folder: 'inbox',
        view: leaf.queue ? SUB_QUEUE_TO_VIEW[leaf.queue] : 'all_open',
        teamId: leaf.teamId,
      },
      mode: 'customer',
      variant: 'customer',
    }
  }
  return {
    filters: { folder: 'inbox', view: INBOX_QUEUE_TO_VIEW[leaf.queue ?? 'all'] },
    mode: 'customer',
    variant: 'customer',
  }
}

/** Merge leaf-scoped filters with the chips and list toolbar extras. */
export function mergeHubThreadFilters(
  leafFilters: Omit<ThreadFilters, 'search' | 'projectId'>,
  extras: {
    search?: string
    projectId?: string
    agentId?: string
    unread?: boolean
    pinnedOnly?: boolean
    assigneeId?: number | null
    channel?: ChannelChip | null
  },
): ThreadFilters {
  const chip = filtersForChannelChip(extras.channel)
  return {
    ...leafFilters,
    search: extras.search,
    projectId: extras.projectId,
    agentId: extras.agentId ?? leafFilters.agentId,
    unread: extras.unread || undefined,
    pinnedOnly: extras.pinnedOnly || undefined,
    assigneeId: extras.assigneeId ?? undefined,
    channel: chip.channel,
    connectionId: chip.connectionId,
  }
}

/** Does this thread match the active channel chip? */
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
