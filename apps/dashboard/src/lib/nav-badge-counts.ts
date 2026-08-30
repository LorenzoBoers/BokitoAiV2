import type { NavBadgeCounts } from '../context/NavBadgeContext'

export type NavBadgeSlot = 'inbox' | 'agents' | 'home' | 'messages'

export function countForBadgeSlot(counts: NavBadgeCounts, slot: NavBadgeSlot | undefined): number {
  if (!slot) return 0
  switch (slot) {
    case 'inbox':
      return counts.inboxUnread
    case 'agents':
      return counts.agentsAttention
    case 'messages':
      return counts.inboxUnread
    default:
      return 0
  }
}

export type InboxQueueBadgeKey = 'all' | 'my' | 'unassigned'

export function countForInboxQueue(
  counts: NavBadgeCounts,
  queue: string,
): number {
  switch (queue) {
    case 'my':
    case 'mine':
      return counts.inboxByQueue.my
    case 'unassigned':
      return counts.inboxByQueue.unassigned
    case 'all':
    case 'open':
      return counts.inboxByQueue.all
    case 'awaiting-decision':
    case 'awaiting_decision':
    case 'decisions':
      return counts.agentsAttention
    default:
      return 0
  }
}
