import type { NavBadgeCounts } from '../context/NavBadgeContext'

export type NavBadgeSlot = 'inbox' | 'agents' | 'agenda' | 'home' | 'messages'

export function countForBadgeSlot(counts: NavBadgeCounts, slot: NavBadgeSlot | undefined): number {
  if (!slot) return 0
  switch (slot) {
    case 'inbox':
      return counts.inboxUnread
    case 'agents':
      return counts.agentsAttention
    case 'agenda':
      return counts.agendaDue
    case 'messages':
      return counts.inboxUnread
    default:
      return 0
  }
}

export type InboxQueueBadgeKey = 'all' | 'for_you' | 'unassigned'

export type QueueCountPair = { unread: number; total: number }

/** Unread (accent) and open-list total (muted) for one Communication queue row. */
export function pairForInboxQueue(counts: NavBadgeCounts, queue: string): QueueCountPair {
  switch (queue) {
    case 'for_you':
      return { unread: counts.inboxByQueue.forYouUnread, total: counts.inboxByQueue.forYouTotal }
    case 'unassigned':
      return { unread: counts.inboxByQueue.unassigned, total: counts.inboxByQueue.unassignedTotal }
    case 'all':
    case 'open':
      return { unread: counts.inboxByQueue.all, total: counts.inboxByQueue.allTotal }
    default:
      return { unread: 0, total: 0 }
  }
}

export function countForInboxQueue(counts: NavBadgeCounts, queue: string): number {
  switch (queue) {
    case 'for_you':
      return counts.inboxByQueue.forYouUnread
    case 'unassigned':
      return counts.inboxByQueue.unassigned
    case 'all':
    case 'open':
      return counts.inboxByQueue.all
    default:
      return 0
  }
}

export function countForTeam(counts: NavBadgeCounts, teamId: string): number {
  return counts.byTeam[teamId] ?? 0
}
