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

export function countForInboxQueue(counts: NavBadgeCounts, queue: string): number {
  switch (queue) {
    case 'for_you':
      return counts.inboxByQueue.forYou
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
