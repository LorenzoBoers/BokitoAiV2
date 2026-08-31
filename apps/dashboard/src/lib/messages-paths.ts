/**
 * Path helpers for the Communication hub (`/communication`).
 *
 * The hub is organized as sidebar "leaves"; each leaf drives the thread-list
 * column and the conversation pane:
 *
 * - `inbox`     — assignable conversations across channels
 * - `decisions` — sole exception queue for open DecisionRequests (any folder)
 * - `agent`     — direct chats with a company agent (optional sub-queue)
 * - `runs`      — internal agent activity (updates, results)
 * - `channel`   — threads of one connected channel (email mailbox, webchat, ...)
 * - `tag`       — cross-channel tag folder (optional sub-queue)
 */

export const INBOX_QUEUES = ['all', 'mine', 'open', 'unassigned', 'snoozed', 'closed', 'spam'] as const
export type InboxQueue = (typeof INBOX_QUEUES)[number]

/** Agent-runs chips only — decisions live on `/communication/decisions`. */
export const RUNS_QUEUES = ['all', 'updates', 'results'] as const
export type RunsQueue = (typeof RUNS_QUEUES)[number]

/** Legacy URL segment; redirects to `decisionsPath`. Kept for typed redirects. */
export const LEGACY_AWAITING_DECISION_QUEUE = 'awaiting-decision' as const

export const CHANNEL_KEYS = ['email', 'webchat', 'internal', 'agent', 'slack', 'whatsapp'] as const
export type ChannelKey = (typeof CHANNEL_KEYS)[number]

/**
 * Uniform sub-folder set nested under every channel, tag, and agent folder
 * (compact, Front-style work queues). A leaf without a queue shows the folder
 * without a status filter (view "all" / "all_open" depending on surface).
 */
export const SUB_QUEUES = ['open', 'mine', 'unassigned', 'closed'] as const
export type SubQueue = (typeof SUB_QUEUES)[number]

/**
 * Agent folders additionally get an `activity` sub-view: the agent's work log
 * (internal run threads) instead of a chats status filter.
 */
export type AgentQueue = SubQueue | 'activity'

/** Sub-queue → list `view` filter used by Communication and DirectCommunication. */
export const SUB_QUEUE_TO_VIEW = {
  open: 'all_open',
  mine: 'mine',
  unassigned: 'unassigned',
  closed: 'closed',
} as const

export type HubLeaf =
  | { type: 'inbox'; queue?: InboxQueue }
  | { type: 'decisions' }
  | { type: 'agent'; agentId: string; queue?: AgentQueue }
  | { type: 'runs'; queue: RunsQueue }
  | { type: 'channel'; channelKey: ChannelKey; connectionId?: string; queue?: SubQueue }
  | { type: 'tag'; tag: string; queue?: SubQueue }

function withThread(base: string, threadId?: string | null): string {
  return threadId ? `${base}/t/${encodeURIComponent(String(threadId))}` : base
}

export function inboxPath(queue?: InboxQueue | null, threadId?: string | null): string {
  const base = queue ? `/communication/inbox/${queue}` : '/communication/inbox'
  return withThread(base, threadId)
}

type PathOpts = { queue?: AgentQueue; threadId?: string | null }

/** Company-agent chats. Second arg is a thread id string or `{ queue, threadId }`. */
export function agentChatPath(
  agentId: string,
  threadIdOrOpts?: string | null | PathOpts,
): string {
  let base = `/communication/agent/${encodeURIComponent(agentId)}`
  if (threadIdOrOpts && typeof threadIdOrOpts === 'object') {
    if (threadIdOrOpts.queue) base += `/${threadIdOrOpts.queue}`
    return withThread(base, threadIdOrOpts.threadId)
  }
  return withThread(base, threadIdOrOpts)
}

export function agentRunsPath(queue: RunsQueue = 'all', threadId?: string | null): string {
  return withThread(`/communication/runs/${queue}`, threadId)
}

/**
 * Terminal-style live activity history (all agents, filterable per agent).
 * Pinned at the bottom of the Communication sidebar.
 */
export function activityTerminalPath(agentId?: string | null): string {
  return agentId
    ? `/communication/activity?agent=${encodeURIComponent(agentId)}`
    : '/communication/activity'
}

/** Sole Communication leaf for open DecisionRequests (customer + internal). */
export function decisionsPath(threadId?: string | null): string {
  return withThread('/communication/decisions', threadId)
}

/** Open a waiting decision on the unified Decisions leaf. */
export function attentionThreadPath(thread: {
  id: string | number
  folder?: string | null
}): string {
  void thread.folder
  return decisionsPath(String(thread.id))
}

export function channelPath(
  channelKey: ChannelKey,
  options: { connectionId?: string | number; queue?: SubQueue; threadId?: string | null } = {},
): string {
  let base =
    channelKey === 'email' && options.connectionId != null
      ? `/communication/channel/email/${encodeURIComponent(String(options.connectionId))}`
      : `/communication/channel/${channelKey}`
  if (options.queue) base += `/${options.queue}`
  return withThread(base, options.threadId)
}

/** Cross-channel tag folder (`/communication/tag/billing[/open]`). */
export function tagPath(
  tag: string,
  options: { queue?: SubQueue; threadId?: string | null } = {},
): string {
  let base = `/communication/tag/${encodeURIComponent(tag)}`
  if (options.queue) base += `/${options.queue}`
  return withThread(base, options.threadId)
}

/** URL of the composer-first "New conversation" surface. */
export function newConversationPath(): string {
  return '/communication/new'
}

/** Canonical URL for a leaf (optionally with a selected thread). */
export function leafPath(leaf: HubLeaf, threadId?: string | null): string {
  switch (leaf.type) {
    case 'inbox':
      return inboxPath(leaf.queue, threadId)
    case 'decisions':
      return decisionsPath(threadId)
    case 'agent':
      return agentChatPath(leaf.agentId, { queue: leaf.queue, threadId })
    case 'runs':
      return agentRunsPath(leaf.queue, threadId)
    case 'channel':
      return channelPath(leaf.channelKey, { connectionId: leaf.connectionId, queue: leaf.queue, threadId })
    case 'tag':
      return tagPath(leaf.tag, { queue: leaf.queue, threadId })
  }
}

function isInboxQueue(value: string): value is InboxQueue {
  return (INBOX_QUEUES as readonly string[]).includes(value)
}

function isRunsQueue(value: string): value is RunsQueue {
  return (RUNS_QUEUES as readonly string[]).includes(value)
}

function isChannelKey(value: string): value is ChannelKey {
  return (CHANNEL_KEYS as readonly string[]).includes(value)
}

export function isSubQueue(value: string): value is SubQueue {
  return (SUB_QUEUES as readonly string[]).includes(value)
}

function isAgentQueue(value: string): value is AgentQueue {
  return value === 'activity' || isSubQueue(value)
}

/** Parse the active leaf from a pathname, ignoring any `/t/:threadId` suffix. */
export function leafFromPath(pathname: string): HubLeaf | null {
  const match = pathname.match(/^\/communication\/([^/]+)(?:\/(.*))?$/)
  if (!match) return null
  const [, head, rest = ''] = match
  const segments = rest.split('/').filter(Boolean)
  // Strip trailing `t/:threadId`
  const tIndex = segments.indexOf('t')
  const parts = tIndex >= 0 ? segments.slice(0, tIndex) : segments

  switch (head) {
    case 'inbox': {
      const raw = parts[0] ? decodeURIComponent(parts[0]) : undefined
      return {
        type: 'inbox',
        queue: raw && isInboxQueue(raw) ? raw : undefined,
      }
    }
    case 'decisions':
      return { type: 'decisions' }
    case 'agent': {
      if (!parts[0]) return null
      const second = parts[1] ? decodeURIComponent(parts[1]) : undefined
      return {
        type: 'agent',
        agentId: decodeURIComponent(parts[0]),
        queue: second && isAgentQueue(second) ? second : undefined,
      }
    }
    case 'runs': {
      const queue = decodeURIComponent(parts[0] ?? 'all')
      return { type: 'runs', queue: isRunsQueue(queue) ? queue : 'all' }
    }
    case 'channel': {
      const key = decodeURIComponent(parts[0] ?? '')
      if (!isChannelKey(key)) return null
      const second = parts[1] ? decodeURIComponent(parts[1]) : undefined
      const third = parts[2] ? decodeURIComponent(parts[2]) : undefined
      // Email may nest a numeric connection id before the sub-queue:
      // /channel/email/12, /channel/email/12/mine, /channel/email/mine
      if (key === 'email' && second && !isSubQueue(second)) {
        return {
          type: 'channel',
          channelKey: 'email',
          connectionId: second,
          queue: third && isSubQueue(third) ? third : undefined,
        }
      }
      return {
        type: 'channel',
        channelKey: key,
        queue: second && isSubQueue(second) ? second : undefined,
      }
    }
    case 'tag': {
      if (!parts[0]) return null
      const queue = parts[1] ? decodeURIComponent(parts[1]) : undefined
      return {
        type: 'tag',
        tag: decodeURIComponent(parts[0]),
        queue: queue && isSubQueue(queue) ? queue : undefined,
      }
    }
    default:
      return null
  }
}

/** True when both leaves point at the same folder scope, ignoring the sub-queue. */
export function sameLeafScope(a: HubLeaf | null, b: HubLeaf): boolean {
  if (!a) return false
  if (a.type === 'inbox' && b.type === 'inbox') return true
  if (a.type === 'decisions' && b.type === 'decisions') return true
  if (a.type === 'channel' && b.type === 'channel') {
    return a.channelKey === b.channelKey && (a.connectionId ?? '') === (b.connectionId ?? '')
  }
  if (a.type === 'tag' && b.type === 'tag') return a.tag === b.tag
  if (a.type === 'agent' && b.type === 'agent') return a.agentId === b.agentId
  return leafKey(a) === leafKey(b)
}

/** Stable identity key for a leaf (used for list-context resets and active states). */
export function leafKey(leaf: HubLeaf): string {
  switch (leaf.type) {
    case 'inbox':
      return leaf.queue ? `inbox:${leaf.queue}` : 'inbox'
    case 'decisions':
      return 'decisions'
    case 'agent':
      return `agent:${leaf.agentId}${leaf.queue ? `:${leaf.queue}` : ''}`
    case 'runs':
      return `runs:${leaf.queue}`
    case 'channel':
      return `channel:${leaf.channelKey}:${leaf.connectionId ?? ''}${leaf.queue ? `:${leaf.queue}` : ''}`
    case 'tag':
      return `tag:${leaf.tag}${leaf.queue ? `:${leaf.queue}` : ''}`
  }
}
