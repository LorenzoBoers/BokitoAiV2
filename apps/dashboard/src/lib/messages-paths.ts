/**
 * Path helpers for the Communication hub (`/communication`).
 *
 * The sidebar has two kinds of folders:
 *
 * - `inbox` — All communication, with the sub-folders For you, Open,
 *   Unassigned and Closed (plus Snoozed and Spam)
 * - `team`  — a team pinned to the sidebar, with the same sub-folders
 *
 * Channels and agents are not folders: they are chips above the list, carried
 * in the query string (`?channel=email:12`, `?agent=<id>`), so they also
 * narrow For you.
 */

export const INBOX_QUEUES = ['all', 'for_you', 'open', 'unassigned', 'snoozed', 'closed', 'spam'] as const
export type InboxQueue = (typeof INBOX_QUEUES)[number]

/** Sub-folders under All communication and every pinned team. */
export const SUB_QUEUES = ['for_you', 'open', 'unassigned', 'closed'] as const
export type SubQueue = (typeof SUB_QUEUES)[number]

/** Sub-queue → list `view` filter. */
export const SUB_QUEUE_TO_VIEW = {
  for_you: 'for_you',
  open: 'all_open',
  unassigned: 'unassigned',
  closed: 'closed',
} as const

export type HubLeaf =
  | { type: 'inbox'; queue?: InboxQueue }
  | { type: 'team'; teamId: string; queue?: SubQueue }

/** Channel chip value: `email:<connectionId>`, `email`, `widget`, `whatsapp`, `slack`. */
export type ChannelChip = string

export type HubScope = {
  channel?: ChannelChip | null
  agentId?: string | null
}

function withThread(base: string, threadId?: string | null): string {
  return threadId ? `${base}/t/${encodeURIComponent(String(threadId))}` : base
}

function withScope(path: string, scope?: HubScope | null, extra?: URLSearchParams): string {
  const params = extra ?? new URLSearchParams()
  if (scope?.channel) params.set('channel', scope.channel)
  if (scope?.agentId) params.set('agent', scope.agentId)
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

export function inboxPath(
  queue?: InboxQueue | null,
  threadId?: string | null,
  scope?: HubScope | null,
): string {
  const base = queue ? `/communication/inbox/${queue}` : '/communication/inbox'
  return withScope(withThread(base, threadId), scope)
}

export function teamPath(teamId: string, queue?: SubQueue | null, threadId?: string | null): string {
  let base = `/communication/team/${encodeURIComponent(teamId)}`
  if (queue) base += `/${queue}`
  return withThread(base, threadId)
}

/** Extra query params to keep when linking into For you. */
type SearchInput = string | URLSearchParams | Record<string, string> | null | undefined

/**
 * Work that waits on you: `/communication/inbox/for_you`. Questions, drafts
 * and replies due land here. `extraSearch` is merged (e.g. `message`); the
 * legacy `filter` param is dropped.
 */
export function forYouPath(threadId?: string | null, extraSearch?: SearchInput): string {
  const params = new URLSearchParams(
    typeof extraSearch === 'string' ? extraSearch.replace(/^\?/, '') : (extraSearch ?? undefined),
  )
  params.delete('filter')
  return withScope(withThread('/communication/inbox/for_you', threadId), null, params)
}

/** Open a waiting decision in its conversation. */
export function attentionThreadPath(thread: { id: string | number }): string {
  return forYouPath(String(thread.id))
}

/** Conversations with one agent: All communication narrowed by the agent chip. */
export function agentChatPath(agentId: string, threadId?: string | null): string {
  return inboxPath('all', threadId, { agentId })
}

/** Conversations on one channel: All communication narrowed by the channel chip. */
export function channelPath(
  chip: ChannelChip,
  options: { queue?: InboxQueue; threadId?: string | null } = {},
): string {
  return inboxPath(options.queue ?? 'open', options.threadId, { channel: chip })
}

/**
 * Terminal-style live activity history (all agents, filterable per agent).
 * The log of agent runs; the runs themselves surface in conversations.
 */
export function activityTerminalPath(agentId?: string | null): string {
  return agentId ? `/activity?agent=${encodeURIComponent(agentId)}` : '/activity'
}

/** URL of the composer-first "New conversation" draft surface. */
export type NewConversationOpts = {
  intent?: 'contact' | 'agent' | 'teammate'
  agentId?: string
  connectionId?: string | number
  to?: string
  subject?: string
  body?: string
  memberId?: string | number
  prefill?: string
  autosend?: boolean
}

export function newConversationPath(opts: NewConversationOpts = {}): string {
  const params = new URLSearchParams()
  if (opts.intent) params.set('intent', opts.intent)
  if (opts.agentId) params.set('agent', opts.agentId)
  if (opts.connectionId != null && String(opts.connectionId)) {
    params.set('connectionId', String(opts.connectionId))
  }
  if (opts.to) params.set('to', opts.to)
  if (opts.subject) params.set('subject', opts.subject)
  if (opts.body) params.set('body', opts.body)
  if (opts.memberId != null) params.set('member', String(opts.memberId))
  if (opts.prefill) params.set('prefill', opts.prefill)
  if (opts.autosend) params.set('autosend', '1')
  const qs = params.toString()
  return qs ? `/communication/new?${qs}` : '/communication/new'
}

/** Canonical URL for a leaf (optionally with a selected thread). */
export function leafPath(leaf: HubLeaf, threadId?: string | null): string {
  switch (leaf.type) {
    case 'inbox':
      return inboxPath(leaf.queue, threadId)
    case 'team':
      return teamPath(leaf.teamId, leaf.queue, threadId)
  }
}

function isInboxQueue(value: string): value is InboxQueue {
  return (INBOX_QUEUES as readonly string[]).includes(value)
}

export function isSubQueue(value: string): value is SubQueue {
  return (SUB_QUEUES as readonly string[]).includes(value)
}

function splitPath(pathname: string): { head: string; parts: string[]; threadId: string | null } | null {
  const match = pathname.match(/^\/communication\/([^/]+)(?:\/(.*))?$/)
  if (!match) return null
  const [, head, rest = ''] = match
  const segments = rest.split('/').filter(Boolean)
  const tIndex = segments.indexOf('t')
  return {
    head,
    parts: tIndex >= 0 ? segments.slice(0, tIndex) : segments,
    threadId: tIndex >= 0 && segments[tIndex + 1] ? decodeURIComponent(segments[tIndex + 1]) : null,
  }
}

/** Parse the active leaf from a pathname, ignoring any `/t/:threadId` suffix. */
export function leafFromPath(pathname: string): HubLeaf | null {
  const split = splitPath(pathname)
  if (!split) return null
  const { head, parts } = split
  if (head === 'inbox') {
    const raw = parts[0] ? decodeURIComponent(parts[0]) : undefined
    return { type: 'inbox', queue: raw && isInboxQueue(raw) ? raw : undefined }
  }
  if (head === 'team' && parts[0]) {
    const raw = parts[1] ? decodeURIComponent(parts[1]) : undefined
    return {
      type: 'team',
      teamId: decodeURIComponent(parts[0]),
      queue: raw && isSubQueue(raw) ? raw : undefined,
    }
  }
  return null
}

const LEGACY_CHANNEL_CHIPS: Record<string, ChannelChip> = {
  webchat: 'widget',
  whatsapp: 'whatsapp',
  slack: 'slack',
  email: 'email',
}

/**
 * Old folder URLs (`/communication/decisions`, `/runs/...`, `/agent/:id`,
 * `/channel/...`, `/inbox/mine`) mapped onto the folder + chip model.
 * Returns null when the path is already current.
 */
export function legacyHubRedirect(pathname: string, search = ''): string | null {
  const split = splitPath(pathname)
  if (!split) return null
  const { head, parts, threadId } = split
  const params = new URLSearchParams(search.replace(/^\?/, ''))
  switch (head) {
    case 'decisions':
      return forYouPath(threadId, params)
    case 'runs':
      return threadId ? inboxPath('all', threadId) : activityTerminalPath()
    case 'agent': {
      if (!parts[0]) return inboxPath('open')
      if (parts[1] === 'activity') return activityTerminalPath(decodeURIComponent(parts[0]))
      return inboxPath('all', threadId, { agentId: decodeURIComponent(parts[0]) })
    }
    case 'channel': {
      const key = decodeURIComponent(parts[0] ?? '')
      if (key === 'internal' || key === 'agent') return inboxPath('all', threadId)
      const second = parts[1] ? decodeURIComponent(parts[1]) : undefined
      let chip = LEGACY_CHANNEL_CHIPS[key] ?? null
      let queueSegment = second
      if (key === 'email' && second && !isSubQueue(second) && second !== 'mine') {
        chip = `email:${second}`
        queueSegment = parts[2] ? decodeURIComponent(parts[2]) : undefined
      }
      const queue: InboxQueue =
        queueSegment === 'mine' ? 'for_you' : queueSegment && isInboxQueue(queueSegment) ? queueSegment : 'open'
      return inboxPath(queue, threadId, { channel: chip })
    }
    case 'inbox':
      if (parts[0] === 'mine') return inboxPath('for_you', threadId)
      return null
    default:
      return null
  }
}

/** True when both leaves point at the same folder scope, ignoring the sub-queue. */
export function sameLeafScope(a: HubLeaf | null, b: HubLeaf): boolean {
  if (!a) return false
  if (a.type === 'inbox' && b.type === 'inbox') return true
  if (a.type === 'team' && b.type === 'team') return a.teamId === b.teamId
  return false
}

/** Stable identity key for a leaf (used for list-context resets and active states). */
export function leafKey(leaf: HubLeaf): string {
  switch (leaf.type) {
    case 'inbox':
      return leaf.queue ? `inbox:${leaf.queue}` : 'inbox'
    case 'team':
      return `team:${leaf.teamId}${leaf.queue ? `:${leaf.queue}` : ''}`
  }
}

/** Channel chip → list filters (`channel` + optional mailbox id). */
export function filtersForChannelChip(chip: ChannelChip | null | undefined): {
  channel?: string
  connectionId?: number
} {
  if (!chip) return {}
  if (chip.startsWith('email:')) {
    const id = Number(chip.slice('email:'.length))
    return Number.isFinite(id) && id > 0 ? { channel: 'email', connectionId: id } : { channel: 'email' }
  }
  return { channel: chip }
}
