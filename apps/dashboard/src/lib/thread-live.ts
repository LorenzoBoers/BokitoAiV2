/**
 * Client-side handling of gateway thread/message events for the live inbox.
 *
 * The gateway publishes the canonical REST thread row (`serialize_thread`)
 * and message shape (`serialize_message`) on its events, so the list and the
 * open thread can apply updates directly instead of refetching. When an event
 * cannot be applied locally — old payload shape, or a filter that needs a
 * server-side join — callers fall back to the debounced refetch.
 */

import type { GatewayEvent } from './gateway'
import type { InboxMessage, InboxThread, ThreadFilters } from './inbox-api'
import { threadNeedsReply } from './message-composer'
import { normalizeSignalMessage, normalizeSignalThread } from './signals-api'

/** Mirrors EXTERNAL_CHANNELS in apps/api/app/models/signal.py. */
const EXTERNAL_CHANNELS = new Set(['email', 'chat', 'widget', 'slack', 'webhook', 'integration'])

/** Extract the canonical thread row from a gateway `message`/`thread` event. */
export function extractLiveThreadRow(event: GatewayEvent): InboxThread | null {
  const thread = event.data.thread
  if (!thread || typeof thread !== 'object') return null
  const raw = thread as Record<string, unknown>
  // The pre-rich payload shape used `signal_id`; only rows with the canonical
  // `id` key can be upserted directly.
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  return normalizeSignalThread(thread)
}

/** Extract the full serialized message from a gateway `message` event. */
export function extractLiveMessage(event: GatewayEvent): InboxMessage | null {
  if (event.event !== 'message') return null
  const message = event.data.message
  if (!message || typeof message !== 'object') return null
  const raw = message as Record<string, unknown>
  // The `threads`-topic preview omits body_text; only the full shape (which
  // always carries thread_id + body_text keys) is appendable.
  if (!('body_text' in raw) || !('thread_id' in raw)) return null
  return normalizeSignalMessage(message)
}

/**
 * Does a thread row belong in the list under the active filters?
 *
 * Returns `null` when the predicate cannot be evaluated client-side
 * (free-text search, views that need server-side joins, assistant-folder
 * ownership) — the caller should refetch instead.
 */
export function threadMatchesFilters(
  thread: InboxThread,
  filters: ThreadFilters,
  currentUserId: number | null,
): boolean | null {
  if (filters.search && filters.search.trim()) return null

  const channel = thread.channel ?? ''
  if (filters.folder === 'external' && !EXTERNAL_CHANNELS.has(channel)) return false
  if (filters.folder === 'internal' && channel !== 'internal') return false
  if (filters.folder === 'inbox' && channel === 'assistant') return false
  // Assistant folder also filters on thread ownership, which the row lacks.
  if (filters.folder === 'assistant') return null

  if (filters.channel && channel !== filters.channel) return false
  if (filters.projectId && (thread.projectId ?? '') !== filters.projectId) return false
  if (filters.agentId && (thread.agentId ?? '') !== filters.agentId) return false
  if (filters.tag && !thread.tags.includes(filters.tag)) return false
  if (filters.assigneeId != null && thread.assignedToUserId !== filters.assigneeId) return false
  if (
    filters.connectionId != null &&
    filters.connectionId > 0 &&
    thread.emailConnectionId !== filters.connectionId
  ) {
    return false
  }

  // Mirrors the view predicates in signal_threads.list_threads.
  let viewMatch: boolean | null
  switch (filters.view ?? 'all_open') {
    case 'all':
      // Closed and spam have dedicated views; closing evicts the row live.
      viewMatch = thread.status !== 'closed' && thread.status !== 'spam'
      break
    case 'all_open':
      viewMatch = thread.status === 'open'
      break
    case 'mine':
      if (currentUserId == null) return null
      viewMatch = thread.status === 'open' && thread.assignedToUserId === currentUserId
      break
    case 'unassigned':
      viewMatch = thread.status === 'open' && thread.assignedToUserId == null
      break
    case 'pending':
      viewMatch = thread.status === 'pending'
      break
    case 'snoozed':
      // Timed wake and "until the customer replies" both live here.
      viewMatch = thread.status === 'pending'
      break
    case 'closed':
      viewMatch = thread.status === 'closed'
      break
    case 'spam':
      viewMatch = thread.status === 'spam'
      break
    case 'external':
      viewMatch = EXTERNAL_CHANNELS.has(channel) && thread.status === 'open'
      break
    case 'internal':
      viewMatch = channel === 'internal'
      break
    // pinned / awaiting_decision / updates / results / outbound need
    // server-side joins (pins, open decisions, message kinds).
    default:
      return null
  }
  return applyAndFlags(thread, filters, viewMatch)
}

function applyAndFlags(thread: InboxThread, filters: ThreadFilters, viewMatch: boolean | null): boolean | null {
  if (viewMatch === false) return false
  if (filters.unread && !thread.hasUnread) return false
  if (filters.pinnedOnly && !thread.isPinned) return false
  if (filters.needsReply && !threadNeedsReply(thread)) return false
  return viewMatch
}

/**
 * Replace-or-prepend a thread row. Gateway rows skip agent enrichment (it
 * would cost a DB read per event), so on replace the previous row's agent
 * fields are kept when the incoming row has none.
 */
export function upsertThreadRow(prev: InboxThread[], row: InboxThread): InboxThread[] {
  const id = String(row.id)
  const idx = prev.findIndex((t) => String(t.id) === id)
  if (idx === -1) return [row, ...prev]
  const existing = prev[idx]
  const next = [...prev]
  next[idx] = {
    ...existing,
    ...row,
    agentId: row.agentId ?? existing.agentId,
    agentName: row.agentName ?? existing.agentName,
    agentKind: row.agentKind ?? existing.agentKind,
  }
  return next
}
