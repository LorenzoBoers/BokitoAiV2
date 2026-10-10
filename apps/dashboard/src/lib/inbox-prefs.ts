import { inboxPath, INBOX_QUEUES, type InboxQueue } from './messages-paths'

const LAST_QUEUE_KEY = 'bokito.inbox.lastQueue'
const LEGACY_QUICK_FILTER_KEY = 'bokito.inbox.quickFilter'
const DENSITY_KEY = 'bokito.inbox.density'

/**
 * List quick filter. Lives in the URL of the current folder only — it is not
 * remembered across folders or sessions. "Needs reply" and "Needs decision"
 * are no filters anymore: they are the hub's "You" leaf.
 */
export type InboxListQuickFilter = 'all' | 'unread' | 'pinned'
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
  return 'for_you'
}

export function writeLastInboxQueue(queue: InboxQueue): void {
  writeStorage(LAST_QUEUE_KEY, queue)
}

export function lastInboxPath(threadId?: string | null): string {
  return inboxPath(readLastInboxQueue(), threadId)
}

const QUICK_FILTERS: readonly InboxListQuickFilter[] = ['all', 'unread', 'pinned']

export function isQuickFilter(value: string | null | undefined): value is InboxListQuickFilter {
  return Boolean(value) && (QUICK_FILTERS as readonly string[]).includes(value as string)
}

/** Drop the sticky filter older builds stored; the URL is the only source now. */
export function clearLegacyQuickFilter(): void {
  try {
    window.localStorage.removeItem(LEGACY_QUICK_FILTER_KEY)
  } catch {
    // ignore
  }
}

export function readInboxDensity(): InboxDensity {
  // Default compact — denser Communication list; opt into comfortable.
  return readStorage(DENSITY_KEY) === 'comfortable' ? 'comfortable' : 'compact'
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
