import { inboxPath, INBOX_QUEUES, type InboxQueue } from './messages-paths'

const LAST_QUEUE_KEY = 'bokito.inbox.lastQueue'
const QUICK_FILTER_KEY = 'bokito.inbox.quickFilter'
const DENSITY_KEY = 'bokito.inbox.density'

export type InboxListQuickFilter = 'all' | 'unread' | 'needsReply' | 'pinned'
export type InboxDensity = 'comfortable' | 'compact'

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignore quota / private mode
  }
}

export function readLastInboxQueue(): InboxQueue {
  const raw = readStorage(LAST_QUEUE_KEY)
  if (raw && (INBOX_QUEUES as readonly string[]).includes(raw)) return raw as InboxQueue
  return 'open'
}

export function writeLastInboxQueue(queue: InboxQueue): void {
  writeStorage(LAST_QUEUE_KEY, queue)
}

export function lastInboxPath(threadId?: string | null): string {
  return inboxPath(readLastInboxQueue(), threadId)
}

const QUICK_FILTERS: readonly InboxListQuickFilter[] = ['all', 'unread', 'needsReply', 'pinned']

export function readQuickFilter(): InboxListQuickFilter {
  const raw = readStorage(QUICK_FILTER_KEY)
  if (raw && (QUICK_FILTERS as readonly string[]).includes(raw)) return raw as InboxListQuickFilter
  return 'all'
}

export function writeQuickFilter(value: InboxListQuickFilter): void {
  writeStorage(QUICK_FILTER_KEY, value)
}

export function readInboxDensity(): InboxDensity {
  return readStorage(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'
}

export function writeInboxDensity(value: InboxDensity): void {
  writeStorage(DENSITY_KEY, value)
}

/** True when the query looks like a thread id (digits or a UUID prefix). */
export function looksLikeThreadQuery(query: string): boolean {
  const q = query.trim()
  if (!q) return false
  if (/^\d+$/.test(q)) return true
  return /^[0-9a-f-]{8,}$/i.test(q)
}
