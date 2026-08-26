/**
 * Path helpers for the Communication hub (`/communication`).
 *
 * The hub is organized as sidebar "leaves"; each leaf drives the thread-list
 * column and the conversation pane:
 *
 * - `inbox`     — assignable conversations across channels (excludes assistant chats)
 * - `assistant` — chats with your personal assistant
 * - `agent`     — direct chats with a company agent
 * - `runs`      — internal agent activity (updates, results, decisions)
 * - `channel`   — threads of one connected channel (email mailbox, webchat, ...)
 */

export const INBOX_QUEUES = ['all', 'mine', 'open', 'unassigned', 'snoozed', 'closed', 'spam'] as const
export type InboxQueue = (typeof INBOX_QUEUES)[number]

export const RUNS_QUEUES = ['all', 'updates', 'results', 'awaiting-decision'] as const
export type RunsQueue = (typeof RUNS_QUEUES)[number]

export const CHANNEL_KEYS = ['email', 'webchat', 'internal', 'agent', 'slack', 'whatsapp'] as const
export type ChannelKey = (typeof CHANNEL_KEYS)[number]

export type HubLeaf =
  | { type: 'inbox'; queue: InboxQueue }
  | { type: 'assistant' }
  | { type: 'agent'; agentId: string }
  | { type: 'runs'; queue: RunsQueue }
  | { type: 'channel'; channelKey: ChannelKey; connectionId?: string }

function withThread(base: string, threadId?: string | null): string {
  return threadId ? `${base}/t/${encodeURIComponent(String(threadId))}` : base
}

export function inboxPath(queue: InboxQueue = 'all', threadId?: string | null): string {
  return withThread(`/communication/inbox/${queue}`, threadId)
}

export function assistantPath(threadId?: string | null): string {
  return withThread('/communication/assistant', threadId)
}

export function agentChatPath(agentId: string, threadId?: string | null): string {
  return withThread(`/communication/agent/${encodeURIComponent(agentId)}`, threadId)
}

export function agentRunsPath(queue: RunsQueue = 'all', threadId?: string | null): string {
  return withThread(`/communication/runs/${queue}`, threadId)
}

/** Open a waiting decision in Inbox or Agent-runs based on the thread folder. */
export function attentionThreadPath(thread: {
  id: string | number
  folder?: string | null
}): string {
  return thread.folder === 'internal'
    ? agentRunsPath('awaiting-decision', String(thread.id))
    : inboxPath('open', String(thread.id))
}

export function channelPath(
  channelKey: ChannelKey,
  options: { connectionId?: string | number; threadId?: string | null } = {},
): string {
  const base =
    channelKey === 'email' && options.connectionId != null
      ? `/communication/channel/email/${encodeURIComponent(String(options.connectionId))}`
      : `/communication/channel/${channelKey}`
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
    case 'assistant':
      return assistantPath(threadId)
    case 'agent':
      return agentChatPath(leaf.agentId, threadId)
    case 'runs':
      return agentRunsPath(leaf.queue, threadId)
    case 'channel':
      return channelPath(leaf.channelKey, { connectionId: leaf.connectionId, threadId })
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
      const queue = decodeURIComponent(parts[0] ?? 'all')
      return { type: 'inbox', queue: isInboxQueue(queue) ? queue : 'all' }
    }
    case 'assistant':
      return { type: 'assistant' }
    case 'agent': {
      if (!parts[0]) return null
      return { type: 'agent', agentId: decodeURIComponent(parts[0]) }
    }
    case 'runs': {
      const queue = decodeURIComponent(parts[0] ?? 'all')
      return { type: 'runs', queue: isRunsQueue(queue) ? queue : 'all' }
    }
    case 'channel': {
      const key = decodeURIComponent(parts[0] ?? '')
      if (!isChannelKey(key)) return null
      if (key === 'email' && parts[1]) {
        return { type: 'channel', channelKey: 'email', connectionId: decodeURIComponent(parts[1]) }
      }
      return { type: 'channel', channelKey: key }
    }
    default:
      return null
  }
}

/** Stable identity key for a leaf (used for list-context resets and active states). */
export function leafKey(leaf: HubLeaf): string {
  switch (leaf.type) {
    case 'inbox':
      return `inbox:${leaf.queue}`
    case 'assistant':
      return 'assistant'
    case 'agent':
      return `agent:${leaf.agentId}`
    case 'runs':
      return `runs:${leaf.queue}`
    case 'channel':
      return `channel:${leaf.channelKey}:${leaf.connectionId ?? ''}`
  }
}
