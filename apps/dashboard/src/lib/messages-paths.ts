/**
 * Path helpers for the Communication hub (`/communication`).
 *
 * Sidebar folders:
 * - `inbox`   — All communication (For you / Open / Unassigned / Scheduled / Closed + Spam)
 * - `team`    — a pinned team, same sub-folders
 * - `channel` — one connected channel (mailbox, website chat, WhatsApp, …)
 * - `agent`   — chats with one company agent (same sub-folders + Activity)
 * - `tag`     — one hashtag: a category (its tickets) or a pinned free tag
 * - `project` — conversations filed on one project
 */

export const INBOX_QUEUES = ['all', 'for_you', 'open', 'unassigned', 'scheduled', 'closed', 'spam'] as const
export type InboxQueue = (typeof INBOX_QUEUES)[number]

export const CHANNEL_KEYS = ['email', 'webchat', 'internal', 'agent', 'slack', 'whatsapp'] as const
export type ChannelKey = (typeof CHANNEL_KEYS)[number]

/** Sub-folders under All communication, teams, channels and agents. */
export const SUB_QUEUES = ['for_you', 'open', 'unassigned', 'closed'] as const
export type SubQueue = (typeof SUB_QUEUES)[number]

/** Agent folders also expose Activity (work log → `/activity?agent=`). */
export type AgentQueue = SubQueue | 'activity'

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
  | { type: 'channel'; channelKey: ChannelKey; connectionId?: string; queue?: SubQueue }
  | { type: 'agent'; agentId: string; queue?: AgentQueue }
  | { type: 'tag'; tag: string; queue?: SubQueue }
  | { type: 'project'; projectId: string; queue?: SubQueue }

/** @deprecated Kept for callers that still pass chip-shaped values; prefer channel leaves. */
export type ChannelChip = string

export type HubScope = {
  channel?: ChannelChip | null
  agentId?: string | null
}

function withThread(base: string, threadId?: string | null): string {
  return threadId ? `${base}/t/${encodeURIComponent(String(threadId))}` : base
}

export function inboxPath(queue?: InboxQueue | null, threadId?: string | null): string {
  const base = queue ? `/communication/inbox/${queue}` : '/communication/inbox'
  return withThread(base, threadId)
}

export function teamPath(teamId: string, queue?: SubQueue | null, threadId?: string | null): string {
  let base = `/communication/team/${encodeURIComponent(teamId)}`
  if (queue) base += `/${queue}`
  return withThread(base, threadId)
}

export function tagPath(tag: string, queue?: SubQueue | null, threadId?: string | null): string {
  let base = `/communication/tag/${encodeURIComponent(tag)}`
  if (queue) base += `/${queue}`
  return withThread(base, threadId)
}

export function projectHubPath(projectId: string, queue?: SubQueue | null, threadId?: string | null): string {
  let base = `/communication/project/${encodeURIComponent(projectId)}`
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
  const qs = params.toString()
  const base = withThread('/communication/inbox/for_you', threadId)
  return qs ? `${base}?${qs}` : base
}

/** Open a waiting decision in its conversation. */
export function attentionThreadPath(thread: { id: string | number }): string {
  return forYouPath(String(thread.id))
}

type AgentPathOpts = { queue?: AgentQueue; threadId?: string | null }

/** Company-agent chats. Second arg is a thread id string or `{ queue, threadId }`. */
export function agentChatPath(
  agentId: string,
  threadIdOrOpts?: string | null | AgentPathOpts,
): string {
  let base = `/communication/agent/${encodeURIComponent(agentId)}`
  if (threadIdOrOpts && typeof threadIdOrOpts === 'object') {
    if (threadIdOrOpts.queue) base += `/${threadIdOrOpts.queue}`
    return withThread(base, threadIdOrOpts.threadId)
  }
  return withThread(base, threadIdOrOpts)
}

/**
 * Terminal-style live activity history (all agents, filterable per agent).
 * Agent folder Activity sub-rows deep-link here.
 */
export function activityTerminalPath(agentId?: string | null): string {
  return agentId ? `/activity?agent=${encodeURIComponent(agentId)}` : '/activity'
}

export function channelPath(
  channelKey: ChannelKey | ChannelChip,
  options: {
    connectionId?: string | number
    queue?: SubQueue
    threadId?: string | null
  } = {},
): string {
  // Chip-shaped values (`email:12`, `widget`) still resolve to a folder URL.
  if (typeof channelKey === 'string' && channelKey.startsWith('email:')) {
    const id = channelKey.slice('email:'.length)
    return channelPath('email', { ...options, connectionId: id })
  }
  if (channelKey === 'widget') {
    return channelPath('webchat', options)
  }
  const key = channelKey as ChannelKey
  let base =
    key === 'email' && options.connectionId != null
      ? `/communication/channel/email/${encodeURIComponent(String(options.connectionId))}`
      : `/communication/channel/${key}`
  if (options.queue) base += `/${options.queue}`
  return withThread(base, options.threadId)
}

/** URL of the composer-first "New conversation" draft surface. */
export type NewConversationOpts = {
  intent?: 'contact' | 'agent' | 'teammate' | 'whatsapp' | 'ticket'
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
    case 'channel':
      return channelPath(leaf.channelKey, {
        connectionId: leaf.connectionId,
        queue: leaf.queue,
        threadId,
      })
    case 'agent':
      return agentChatPath(leaf.agentId, { queue: leaf.queue, threadId })
    case 'tag':
      return tagPath(leaf.tag, leaf.queue, threadId)
    case 'project':
      return projectHubPath(leaf.projectId, leaf.queue, threadId)
  }
}

function isInboxQueue(value: string): value is InboxQueue {
  return (INBOX_QUEUES as readonly string[]).includes(value)
}

function isChannelKey(value: string): value is ChannelKey {
  return (CHANNEL_KEYS as readonly string[]).includes(value)
}

export function isSubQueue(value: string): value is SubQueue {
  return (SUB_QUEUES as readonly string[]).includes(value)
}

/** Accept legacy `mine` as For you when reading folder URLs. */
function parseSubQueue(value: string | undefined): SubQueue | undefined {
  if (!value) return undefined
  if (value === 'mine') return 'for_you'
  return isSubQueue(value) ? value : undefined
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
    if (raw === 'mine') return { type: 'inbox', queue: 'for_you' }
    return { type: 'inbox', queue: raw && isInboxQueue(raw) ? raw : undefined }
  }
  if (head === 'team' && parts[0]) {
    const raw = parts[1] ? decodeURIComponent(parts[1]) : undefined
    return {
      type: 'team',
      teamId: decodeURIComponent(parts[0]),
      queue: parseSubQueue(raw),
    }
  }
  if ((head === 'tag' || head === 'project') && parts[0]) {
    const id = decodeURIComponent(parts[0])
    const queue = parseSubQueue(parts[1] ? decodeURIComponent(parts[1]) : undefined)
    return head === 'tag' ? { type: 'tag', tag: id, queue } : { type: 'project', projectId: id, queue }
  }
  if (head === 'agent' && parts[0]) {
    const second = parts[1] ? decodeURIComponent(parts[1]) : undefined
    let queue: AgentQueue | undefined
    if (second === 'activity') queue = 'activity'
    else queue = parseSubQueue(second)
    return {
      type: 'agent',
      agentId: decodeURIComponent(parts[0]),
      queue,
    }
  }
  if (head === 'channel') {
    const key = decodeURIComponent(parts[0] ?? '')
    if (!isChannelKey(key)) return null
    const second = parts[1] ? decodeURIComponent(parts[1]) : undefined
    const third = parts[2] ? decodeURIComponent(parts[2]) : undefined
    if (key === 'email' && second && !isSubQueue(second) && second !== 'mine') {
      return {
        type: 'channel',
        channelKey: 'email',
        connectionId: second,
        queue: parseSubQueue(third),
      }
    }
    return {
      type: 'channel',
      channelKey: key,
      queue: parseSubQueue(second),
    }
  }
  return null
}

/**
 * Retired folder URLs (`/communication/decisions`, `/runs/...`) map onto For you
 * or Activity. Agent and channel paths are current again — return null.
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
    case 'agent':
    case 'channel':
      // Restored as first-class folders; do not chip-redirect.
      return null
    case 'inbox':
      if (parts[0] === 'mine') return inboxPath('for_you', threadId)
      if (parts[0] === 'snoozed') return inboxPath('scheduled', threadId)
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
  if (a.type === 'channel' && b.type === 'channel') {
    return a.channelKey === b.channelKey && (a.connectionId ?? '') === (b.connectionId ?? '')
  }
  if (a.type === 'agent' && b.type === 'agent') return a.agentId === b.agentId
  if (a.type === 'tag' && b.type === 'tag') return a.tag === b.tag
  if (a.type === 'project' && b.type === 'project') return a.projectId === b.projectId
  return false
}

/** Stable identity key for a leaf (used for list-context resets and active states). */
export function leafKey(leaf: HubLeaf): string {
  switch (leaf.type) {
    case 'inbox':
      return leaf.queue ? `inbox:${leaf.queue}` : 'inbox'
    case 'team':
      return `team:${leaf.teamId}${leaf.queue ? `:${leaf.queue}` : ''}`
    case 'channel':
      return `channel:${leaf.channelKey}:${leaf.connectionId ?? ''}${leaf.queue ? `:${leaf.queue}` : ''}`
    case 'agent':
      return `agent:${leaf.agentId}${leaf.queue ? `:${leaf.queue}` : ''}`
    case 'tag':
      return `tag:${leaf.tag}${leaf.queue ? `:${leaf.queue}` : ''}`
    case 'project':
      return `project:${leaf.projectId}${leaf.queue ? `:${leaf.queue}` : ''}`
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
  if (chip === 'webchat') return { channel: 'widget' }
  return { channel: chip }
}
