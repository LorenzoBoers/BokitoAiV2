import { integrationsRoutes } from '../api/routes/integrations.routes'
import { appRoutes } from '../api/routes/app.routes'
import { policyRoutes } from '../api/routes/policy.routes'
import {
  apiGet,
  apiPost,
  apiPatch,
  apiPut,
  apiDelete,
  apiGet as apiGetApp,
} from './api'
import { isMockAgentBody } from './activity-labels'
import { normalizeMessageActivity, type ActivityItem } from './agentActivity'
import { normalizeAiHandling, type AiHandling } from './ai-handling'
import type { TicketStage, TicketStatus } from './tickets-api'
import { plainChatText } from './chatText'
import { clearStoredComposerDraft } from './inbox-ops'
import type { ResolveDecisionResult, ThreadSession } from './signals-api'
import type { CanvasNode } from './project-canvas/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThreadStatus = 'open' | 'pending' | 'closed' | 'spam'
export type ThreadPriority = 'normal' | 'high' | 'urgent'
export type MessageDirection = 'inbound' | 'outbound' | 'internal' | 'system'
export type SendStatus = 'sending' | 'scheduled' | 'sent' | 'failed' | `failed:${string}`

export type ThreadId = string

export type MessageFolder = 'external' | 'internal' | 'all'

export type OwnerKind = 'user' | 'agent' | 'team'

/** Who is responsible for the conversation. Every conversation has one. */
export type ThreadOwner = {
  kind: OwnerKind
  userId: string | null
  agentId: string | null
  teamId: string | null
}

export type TurnReason = 'reply_needed' | 'question' | 'draft_ready' | ''

/** Who must act now (derived on the server). */
export type ThreadTurn = {
  kind: 'customer' | 'agent' | 'user' | 'team' | ''
  userId: string | null
  /** Numeric inbox id of the person whose turn it is. */
  userNum: number | null
  teamId: string | null
  reason: TurnReason
}

export function normalizeOwner(value: unknown): ThreadOwner {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const kind = raw.kind === 'user' || raw.kind === 'agent' ? raw.kind : 'team'
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null)
  return { kind, userId: str(raw.user_id), agentId: str(raw.agent_id), teamId: str(raw.team_id) }
}

export function normalizeTurn(value: unknown): ThreadTurn {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const kinds = ['customer', 'agent', 'user', 'team'] as const
  const reasons = ['reply_needed', 'question', 'draft_ready'] as const
  const kind = kinds.find((k) => k === raw.kind) ?? ''
  const reason = reasons.find((r) => r === raw.reason) ?? ''
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null)
  return {
    kind,
    userId: str(raw.user_id),
    userNum: typeof raw.user_num === 'number' ? raw.user_num : null,
    teamId: str(raw.team_id),
    reason,
  }
}

export type ThreadScheduleDetails = {
  note?: string
  location?: string
  htmlLink?: string
  allDay?: boolean
  calendarEventId?: string
}

export type ScheduleRepeat =
  | { kind: 'cron'; cron: string }
  | { kind: 'interval'; everyMinutes: number }

export type ScheduleRecipient = { kind: 'user' | 'team'; id: string }

/** The repeat rule / agent wake bound to a thread (a Trigger server-side). */
export type ThreadSchedule = {
  triggerId: string
  name: string
  kind: string
  purpose: string
  repeat: ScheduleRepeat | null
  enabled: boolean
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: string
  agentId: string | null
  instructions: string
  recipient: ScheduleRecipient | null
  webhook: boolean
}

export function normalizeThreadSchedule(value: unknown): ThreadSchedule | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const repeatRaw = raw.repeat && typeof raw.repeat === 'object' ? (raw.repeat as Record<string, unknown>) : null
  let repeat: ScheduleRepeat | null = null
  if (repeatRaw?.kind === 'cron' && typeof repeatRaw.cron === 'string') {
    repeat = { kind: 'cron', cron: repeatRaw.cron }
  } else if (repeatRaw?.kind === 'interval') {
    repeat = { kind: 'interval', everyMinutes: Number(repeatRaw.every_minutes) || 60 }
  }
  const recipientRaw =
    raw.recipient && typeof raw.recipient === 'object' ? (raw.recipient as Record<string, unknown>) : null
  const recipient: ScheduleRecipient | null =
    recipientRaw && (recipientRaw.kind === 'user' || recipientRaw.kind === 'team') && typeof recipientRaw.id === 'string'
      ? { kind: recipientRaw.kind, id: recipientRaw.id }
      : null
  return {
    triggerId: str(raw.trigger_id),
    name: str(raw.name),
    kind: str(raw.kind),
    purpose: str(raw.purpose),
    repeat,
    enabled: raw.enabled === true,
    nextRunAt: str(raw.next_run_at) || null,
    lastRunAt: str(raw.last_run_at) || null,
    lastStatus: str(raw.last_status),
    agentId: str(raw.agent_id) || null,
    instructions: str(raw.instructions),
    recipient,
    webhook: raw.webhook === true,
  }
}

function normalizeScheduleDetails(value: unknown): ThreadScheduleDetails {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const out: ThreadScheduleDetails = {}
  if (typeof raw.note === 'string' && raw.note) out.note = raw.note
  if (typeof raw.location === 'string' && raw.location) out.location = raw.location
  if (typeof raw.html_link === 'string' && raw.html_link) out.htmlLink = raw.html_link
  if (raw.all_day === true) out.allDay = true
  if (typeof raw.calendar_event_id === 'string' && raw.calendar_event_id) {
    out.calendarEventId = raw.calendar_event_id
  }
  return out
}

/** New owner for a conversation; a team without id means the channel's owner team. */
export type AssigneeInput = {
  kind: OwnerKind
  id?: string | number | null
  message?: string
}

export type InboxThread = {
  id: ThreadId
  organisationId: string
  emailConnectionId: number | null
  /** Canonical ChannelAccount UUID for the bound mailbox (email threads). */
  channelAccountId?: string | null
  graphConversationId: string
  emailSubject: string
  /** Latest customer/agent line, for the thread list preview. */
  lastMessagePreview?: string
  /** Direction of that preview line (`inbound` = they wrote, `outbound` = you). */
  lastMessageDirection?: MessageDirection | ''
  /** An agent wrote that line (outbound previews read "AI:", not "You:"). */
  lastMessageByAgent?: boolean
  contactId: string | null
  contactEmail: string
  contactName: string
  contactPhone: string
  /** How the thread is linked to its contact: verified | claimed | manual; '' = inbound address. */
  contactBasis: string
  status: ThreadStatus
  /** The thread's date: an agenda item, a look-again, or a repeat's next run. */
  nextAt: string | null
  /** End of an appointment. */
  endsAt: string | null
  /** Appointment details next to the date (note, location, calendar link). */
  scheduleDetails: ThreadScheduleDetails
  /** The thread's repeat rule or agent wake; `undefined` when the row did not carry it. */
  schedule?: ThreadSchedule | null
  priority: ThreadPriority
  assignedToUserId: number | null
  owner?: ThreadOwner
  turn?: ThreadTurn
  /** Tag names; `undefined` when a live row did not carry them (keep the known value). */
  tags?: string[]
  /** Tags inherited from the contact or company; not removable on the thread. */
  inheritedTags?: string[]
  /** Leaf folder paths this conversation matches (`#acme / #facturen`). */
  folderPaths?: { label: string; projectId: string | null; tags: string[] }[]
  lastMessageAt: string | null
  hasUnread: boolean
  isPinned: boolean
  /** Closed conversations marked as few-shot examples for the next reply. */
  isExample?: boolean
  /** True when an agent decision card is still waiting on a human. */
  hasOpenDecision?: boolean
  /** Resolved AI handling (workspace, channel, contact, conversation; Govern-capped). */
  aiHandling?: AiHandling | null
  /** Next-action chips set by AI inbound processing (close / assign / look_at). */
  suggestedActions?: string[]
  /** AI triage (category / urgency 0-100 / certainty 0-100), null until triaged. */
  category?: string | null
  urgency?: number | null
  certainty?: number | null
  aiSummary?: string | null
  /**
   * The conversation's ticket: its category hashtag and stage. `undefined` when
   * the row came from a live event that does not carry it (keep the known value).
   */
  ticket?: ThreadTicket | null
  createdAt: string
  channel?: string
  /** Thread origin; `personal` is the in-app Bokito helper, not Communication. */
  source?: string
  folder?: MessageFolder | string
  projectId?: string | null
  /** The agent this thread targets (chat threads), if any. */
  agentId?: string | null
  agentName?: string | null
  addressedAgent?: { id: string; name: string } | null
  agentKind?: string | null
  agentAvatarKind?: string | null
  agentAvatarIcon?: string | null
  agentAvatarColor?: string | null
  agentAvatarShape?: string | null
  agentAvatarImageUrl?: string | null
}

export type InboxMessage = {
  id: ThreadId
  /**
   * Stable Virtuoso key across the optimistic → server hand-off.
   * The real `id` still changes; this does not, so the enter animation
   * does not restart.
   */
  listKey?: string
  threadId: ThreadId
  connectionId: number | null
  kind?: string
  direction: MessageDirection
  fromAddress: string
  toAddresses: string
  /** Comma-separated CC recipients on outbound email, if any. */
  cc?: string | null
  /** Comma-separated BCC recipients on outbound email, if any. */
  bcc?: string | null
  /** Inbound To header (comma-separated) — feeds reply-all recipient lists. */
  toHeader?: string | null
  /** reply | reply_all | forward on outbound mail started from a bubble. */
  replyMode?: string | null
  subject: string
  bodyPreview: string
  bodyText?: string
  bodyHtml: string | null
  /** True when HTML exists server-side but may be omitted from the timeline window. */
  hasHtml?: boolean
  graphMessageId: string
  inReplyTo: string | null
  authorUserId: number | null
  isRead: boolean
  sendStatus: SendStatus | null
  /** Mock / placeholder LLM reply — never treat as customer delivery. */
  isMock?: boolean
  /** Server verdict: outbound actually reached the customer. */
  deliveredToCustomer?: boolean
  attachments: unknown[] | null
  decisionId?: string | null
  payload?: Record<string, unknown>
  /** The signed-in user's feedback on this message (legacy thumbs / scored reaction). */
  myFeedback?: { score: number | null; sentiment: 'up' | 'down' | null } | null
  /** LinkedIn-style stacked reactions on this timeline message. */
  reactions?: {
    kinds: Array<{
      kind: 'up' | 'down' | 'hundred' | 'facepalm' | 'clap' | 'thinking' | 'investigating'
      emoji: string
      count: number
      reactors: Array<{ actorType: 'user' | 'agent'; actorId: string; name: string }>
    }>
    mine: 'up' | 'down' | 'hundred' | 'facepalm' | 'clap' | 'thinking' | 'investigating' | null
  } | null
  /** What the agent did before this bubble (thinking, tool calls). */
  activity?: ActivityItem[]
  /** Activity after the last bubble of a turn. */
  activityAfter?: ActivityItem[]
  /** False when the list payload omitted tool detail (load on expand). */
  activityDetail?: boolean
  hasActivity?: boolean
  /** Agent turn this bubble belongs to (live stream id). */
  turnId?: string | null
  /** True while the agent is still writing this turn onto the thread. */
  inProgress?: boolean
  /** Collapsed tool rows and image frames, already grouped by the API. */
  history?: import('./agentActivity').HistoryView | null
  /** Approval the agent attached to this bubble (buttons render under it). */
  proposal?: MessageProposal | null
  /** Showcase cards on any agent bubble (with or without a proposal). */
  items?: ProposalItem[]
  /** Operator answer bubble posted after resolving a decision. */
  decisionResponse?: boolean
  decisionResponseDecisionId?: string | null
  /** Bundle answers cover several cards in one bubble. */
  decisionResponseDecisionIds?: string[]
  /** On a decision card: the agent bubble that shows it inline. */
  attachedToMessageId?: string | null
  /** Place in the thread. The timeline sorts on it. */
  seq?: number | null
  receivedAt: string | null
  createdAt: string
}

export type ProposalItemType =
  | 'conversation'
  | 'trash_entry'
  | 'trigger'
  | 'file'
  | 'image'
  | 'user'
  | 'agent'
  | 'tag'
  | 'flow'
  | 'project'
  | 'folder'
  | 'canvas'
  | 'contact'
  | 'integration'
  | 'marketplace'
  | 'module'
  | 'help_doc'
  | 'knowledge'
  | 'message'

/** Snapshot of an object shown as a showcase card (or on a proposal). */
export type ProposalItem = {
  type: ProposalItemType
  id: string
  title: string
  subtitle: string
  kind?: string | null
  name?: string | null
  imageUrl?: string | null
  /** Agent mark — same fields as serialize_agent / AiAvatar. */
  avatarKind?: string | null
  avatarIcon?: string | null
  avatarColor?: string | null
  avatarShape?: string | null
  avatarImageUrl?: string | null
  url?: string | null
  path?: string | null
  provider?: string | null
  slug?: string | null
  signalId?: string | null
  messageId?: string | null
  at?: string | null
  deletedAt?: string | null
  missing?: boolean
  /** Canvas shell created but not yet filled — listed, not openable. */
  empty?: boolean
  /** Compact canvas tree for the chat preview card. */
  preview?: CanvasNode | null
  /** Marketplace module card: specialist job, partner slugs, install state. */
  jobTitle?: string | null
  roleBlurb?: string | null
  toolCount?: number | null
  providerSlugs?: string[]
  installState?: string | null
  moduleStatus?: string | null
}

/** Server-side description of the tool call behind an action row. */
export type ProposalActionDescription = {
  tool: string
  key: string
  args: Record<string, string>
  fallback: string
}

/** One action an agent asked approval for; several of one turn form a bundle. */
export type ProposalBundleEntry = {
  decisionId: string
  cardMessageId: string | null
  title: string
  summary: string
  status: string
  chosenOptionId: string | null
  resolvedAt: string | null
  resolvedBy: string | null
  resolvedByUserId: string | null
  approveOptionId: string
  rejectOptionId: string
  actionType: string
  action: ProposalActionDescription | null
  learn: { tool: string; agentId: string } | null
  platformChangeId: string | null
}

export type MessageProposal = {
  decisionId: string
  /** The decision card message; the resolve endpoint is keyed on it. */
  cardMessageId: string | null
  status: string
  question: string | null
  selection: 'single' | 'multiple'
  options: unknown[]
  items: ProposalItem[]
  chosenOptionId: string | null
  chosenOptionIds: string[]
  resolvedAt: string | null
  resolvedBy: string | null
  /** UUID of the teammate who resolved; match InboxMember.uuid for avatar. */
  resolvedByUserId: string | null
  /** Every action card of the agent turn, oldest first. Empty for plain proposals. */
  bundle: ProposalBundleEntry[]
  bundleId: string | null
}

function normalizeActionDescription(value: unknown): ProposalActionDescription | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const tool = asString(raw.tool)
  if (!tool) return null
  const args: Record<string, string> = {}
  if (raw.args && typeof raw.args === 'object') {
    for (const [key, val] of Object.entries(raw.args as Record<string, unknown>)) {
      if (val != null) args[key] = String(val)
    }
  }
  return { tool, key: asString(raw.key) || tool, args, fallback: asString(raw.fallback) || tool }
}

export function normalizeBundleEntry(value: unknown): ProposalBundleEntry | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const decisionId = asString(raw.decision_id)
  if (!decisionId) return null
  const learn = raw.learn && typeof raw.learn === 'object' ? (raw.learn as Record<string, unknown>) : null
  return {
    decisionId,
    cardMessageId: asNullableString(raw.card_message_id),
    title: asString(raw.title),
    summary: asString(raw.summary),
    status: asString(raw.status) || 'missing',
    chosenOptionId: asNullableString(raw.chosen_option_id),
    resolvedAt: asNullableString(raw.resolved_at),
    resolvedBy: asNullableString(raw.resolved_by),
    resolvedByUserId: asNullableString(raw.resolved_by_user_id),
    approveOptionId: asString(raw.approve_option_id) || 'approve',
    rejectOptionId: asString(raw.reject_option_id) || 'reject',
    actionType: asString(raw.action_type),
    action: normalizeActionDescription(raw.action),
    learn: learn && asString(learn.agent_id) ? { tool: asString(learn.tool), agentId: asString(learn.agent_id) } : null,
    platformChangeId: asNullableString(raw.platform_change_id),
  }
}

const PROPOSAL_ITEM_TYPES = new Set<ProposalItemType>([
  'conversation',
  'trash_entry',
  'trigger',
  'file',
  'image',
  'user',
  'agent',
  'tag',
  'flow',
  'project',
  'folder',
  'canvas',
  'contact',
  'integration',
  'marketplace',
  'module',
  'help_doc',
  'knowledge',
  'message',
])

export function normalizeProposalItem(row: unknown): ProposalItem | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const type = asString(raw.type) as ProposalItemType
  if (!PROPOSAL_ITEM_TYPES.has(type)) return null
  return {
    type,
    id: asString(raw.id),
    title: asString(raw.title),
    subtitle: asString(raw.subtitle),
    kind: asNullableString(raw.kind),
    name: asNullableString(raw.name),
    imageUrl: asNullableString(raw.image_url),
    avatarKind: asNullableString(raw.avatar_kind),
    avatarIcon: asNullableString(raw.avatar_icon),
    avatarColor: asNullableString(raw.avatar_color),
    avatarShape: asNullableString(raw.avatar_shape),
    avatarImageUrl:
      asNullableString(raw.avatar_image_url) ?? asNullableString(raw.image_url),
    url: asNullableString(raw.url),
    path: asNullableString(raw.path),
    provider: asNullableString(raw.provider),
    slug: asNullableString(raw.slug),
    signalId: asNullableString(raw.signal_id),
    messageId: asNullableString(raw.message_id),
    at: asNullableString(raw.at),
    deletedAt: asNullableString(raw.deleted_at),
    missing: raw.missing === true,
    empty: raw.empty === true,
    preview: asCanvasPreview(raw.preview),
    jobTitle: asNullableString(raw.job_title),
    roleBlurb: asNullableString(raw.role_blurb),
    toolCount: typeof raw.tool_count === 'number' ? raw.tool_count : null,
    providerSlugs: Array.isArray(raw.provider_slugs)
      ? raw.provider_slugs.filter((slug): slug is string => typeof slug === 'string' && Boolean(slug))
      : undefined,
    installState: asNullableString(raw.install_state),
    moduleStatus: asNullableString(raw.module_status),
  }
}

function asCanvasPreview(value: unknown): CanvasNode | null {
  if (!value || typeof value !== 'object') return null
  const node = value as CanvasNode
  if (typeof node.type !== 'string' || !node.type) return null
  return node
}

function normalizeItemList(value: unknown): ProposalItem[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeProposalItem).filter((i): i is ProposalItem => i !== null)
}

/** `proposal` / `items` / `attachedToMessageId` from a serialized message payload. */
export function messageProposalFields(
  payload: unknown,
): Pick<
  InboxMessage,
  | 'proposal'
  | 'attachedToMessageId'
  | 'items'
  | 'decisionResponse'
  | 'decisionResponseDecisionId'
  | 'decisionResponseDecisionIds'
> {
  const raw = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const items = normalizeItemList(raw.items ?? raw.decision_response_items)
  const decisionIds = Array.isArray(raw.decision_response_decision_ids)
    ? raw.decision_response_decision_ids.map((x) => String(x)).filter(Boolean)
    : []
  const decisionId = asNullableString(raw.decision_response_decision_id ?? raw.decision_id)
  if (decisionId && !decisionIds.includes(decisionId)) decisionIds.unshift(decisionId)
  return {
    proposal: normalizeProposal(raw.proposal),
    attachedToMessageId: asNullableString(raw.attached_to_message_id),
    items: items.length ? items : undefined,
    decisionResponse: raw.decision_response === true,
    decisionResponseDecisionId: decisionId ?? decisionIds[0] ?? null,
    decisionResponseDecisionIds: decisionIds.length ? decisionIds : undefined,
  }
}

export function normalizeProposal(value: unknown): MessageProposal | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const decisionId = asString(raw.decision_id)
  if (!decisionId) return null
  const selection = asString(raw.selection) === 'multiple' ? 'multiple' : 'single'
  const chosenIds = Array.isArray(raw.chosen_option_ids)
    ? raw.chosen_option_ids.map((x) => String(x)).filter(Boolean)
    : []
  const chosenOptionId = asNullableString(raw.chosen_option_id)
  if (chosenOptionId && !chosenIds.length) {
    chosenIds.push(...chosenOptionId.split(',').filter(Boolean))
  }
  return {
    decisionId,
    cardMessageId: asNullableString(raw.message_id),
    status: asString(raw.status) || 'missing',
    question: asNullableString(raw.question),
    selection,
    options: Array.isArray(raw.options) ? raw.options : [],
    items: normalizeItemList(raw.items),
    chosenOptionId: chosenIds[0] ?? chosenOptionId,
    chosenOptionIds: chosenIds,
    resolvedAt: asNullableString(raw.resolved_at),
    resolvedBy: asNullableString(raw.resolved_by),
    resolvedByUserId: asNullableString(raw.resolved_by_user_id),
    bundle: Array.isArray(raw.bundle)
      ? raw.bundle.map(normalizeBundleEntry).filter((x): x is ProposalBundleEntry => x !== null)
      : [],
    bundleId: asNullableString(raw.bundle_id),
  }
}

export type InboxEvent = {
  id: ThreadId
  threadId: ThreadId
  eventType: string
  actorType?: string | null
  actorUserId: number | null
  actorAgentId?: string | null
  payload: Record<string, unknown>
  createdAt: string
}

export type InboxMember = {
  id: number
  uuid: string
  name: string
  email: string
  avatarUrl: string | null
  /** Workspace role when known: owner | admin | member */
  role?: string | null
  presence?: 'available' | 'away' | 'offline'
}

export type MailboxFolder = {
  id: string
  displayName: string
  totalItems: number
  isSelected: boolean
  lastSyncAt: string | null
}

export type FolderSyncState = {
  id: number
  folderId: string
  folderName: string
  isSelected: boolean
  lastSyncAt: string | null
}

/** Another conversation with the same person (other channel or mailbox). */
export type RelatedConversation = {
  id: string
  channel: string
  subject: string
  status: string
  lastMessageAt: string | null
  lastMessageDirection: 'inbound' | 'outbound' | ''
  lastMessagePreview: string
  /** An AI reply proposal is still open on that conversation. */
  hasOpenProposal: boolean
}

export type ThreadParticipant = {
  id: string
  kind: 'user' | 'agent' | 'contact' | 'team' | string
  ref_id: string
  role: 'owner' | 'member' | 'watcher' | string
  name: string
  email?: string
  joined_via?: string
  unread_count?: number
  /** People photo (data URI or URL); agents/teams use avatar_* mark fields. */
  avatar_url?: string | null
  avatar_kind?: string | null
  avatar_icon?: string | null
  avatar_color?: string | null
  avatar_shape?: string | null
  avatar_image_url?: string | null
}

export type ThreadActiveTurn = {
  kind?: string
  ref_id?: string
  name?: string
  nonce?: string
  turn_id?: string
  /** running: this agent is writing now. queued: next, after the current turn. */
  status?: 'running' | 'queued'
  claimed_at?: string
  requested_by_kind?: string
  requested_by_id?: string | null
} | null

/** The floor as the API sends it; `{}` and null mean nobody holds it. */
export function parseActiveTurn(raw: unknown): ThreadActiveTurn {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.ref_id !== 'string' || !row.ref_id) return null
  const text = (key: string) => (typeof row[key] === 'string' ? (row[key] as string) : undefined)
  const status = text('status')
  return {
    kind: text('kind'),
    ref_id: row.ref_id,
    name: text('name'),
    nonce: text('nonce'),
    turn_id: text('turn_id'),
    status: status === 'running' || status === 'queued' ? status : undefined,
    claimed_at: text('claimed_at'),
    requested_by_kind: text('requested_by_kind'),
    requested_by_id: text('requested_by_id') ?? null,
  }
}

export type ThreadDetail = {
  thread: InboxThread
  messages: InboxMessage[]
  events: InboxEvent[]
  /** Inline agent sessions anchored on this thread (active + closed). */
  sessions: ThreadSession[]
  /** Humans and agents on this conversation. */
  participants?: ThreadParticipant[]
  /** Who currently has the floor (multi-agent turn). */
  activeTurn?: ThreadActiveTurn
  /** Nestable multi-agent handoff (opener + co-invitees). */
  handoffSession?: {
    id: string
    status: string
    depth?: number
    openerId?: string
    openerName?: string
    agentIds?: string[]
    humanIds?: string[]
  } | null
  /** End-customer satisfaction rating (widget CSAT prompt), if given. */
  csat?: { score: number; comment: string; created_at: string } | null
  /** True when older messages exist above the current window. */
  hasOlder?: boolean
  /** Oldest message id in the current window (cursor for load-older). */
  oldestMessageId?: string | null
  /** Other conversations with this person, newest first. */
  relatedConversations?: RelatedConversation[]
  /** Channel routing policy (null on internal threads). */
  routingPolicy?: ThreadRoutingPolicy | null
}

export type ThreadFilters = {
  view?:
    | 'all'
    | 'all_open'
    | 'unassigned'
    /** Assigned to you, a question or draft addressed to you, or an unread mention. */
    | 'for_you'
    | 'for_you_closed'
    | 'unassigned_closed'
    | 'pending'
    /** Threads with a date: agenda items, look-agains, recurring tasks. */
    | 'scheduled'
    | 'closed'
    | 'spam'
    | 'outbound'
    | 'pinned'
    | 'awaiting_decision'
    | 'updates'
    | 'results'
    | 'external'
    | 'internal'
  folder?: 'external' | 'internal' | 'assistant' | 'inbox' | 'all'
  /** Filter on the signal channel (e.g. widget, chat, internal). */
  channel?: string
  agentId?: string
  /** Owner team or the team whose turn it is. */
  teamId?: string
  /** Conversations linked to the project, or tickets in it. */
  projectId?: string
  tag?: string
  categoryId?: string
  /** A ticket stage key, or a stage kind (open, waiting, done). */
  stage?: string
  assigneeId?: number
  /** Server-side priority so matches beyond the loaded page are included. */
  priority?: ThreadPriority
  /** Last-activity window (`today` / `7d` / `30d` / `90d`) on last_message_at. */
  activity?: 'today' | '7d' | '30d' | '90d'
  search?: string
  page?: number
  perPage?: number
  connectionId?: number
  /** AND flags on top of the current view (not a replacement queue). */
  unread?: boolean
  needsReply?: boolean
  needsDecision?: boolean
  pinnedOnly?: boolean
}

export type PagedThreadResult = {
  items: InboxThread[]
  /** Search hits the current queue or filters leave out. Page 1 only. */
  outsideItems: InboxThread[]
  curPage: number
  itemsTotal: number | null
  nextPage: number | null
}

export type MessageAttachment = {
  id: string
  name: string
  mime: string
  size: number
  url: string
  /** MIME Content-ID for inline images referenced as cid: in body_html. */
  contentId?: string | null
  inline?: boolean
}

/** Best-effort normalize of stored / forwarded attachment payloads. */
export function asMessageAttachments(raw: unknown[] | null | undefined): MessageAttachment[] {
  if (!Array.isArray(raw)) return []
  const out: MessageAttachment[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id : ''
    const url = typeof row.url === 'string' ? row.url : ''
    if (!id || !url) continue
    const contentIdRaw = row.content_id ?? row.contentId
    out.push({
      id,
      name: typeof row.name === 'string' && row.name.trim() ? row.name : 'file',
      mime: typeof row.mime === 'string' ? row.mime : '',
      size: typeof row.size === 'number' ? row.size : 0,
      url,
      contentId: typeof contentIdRaw === 'string' && contentIdRaw.trim() ? contentIdRaw : null,
      inline: row.inline === true,
    })
  }
  return out
}

export type ReplyInput = {
  bodyText: string
  bodyHtml?: string
  action?: 'send' | 'send_and_close' | 'send_and_pending'
  attachments?: MessageAttachment[]
  /** When `email`, a mailbox signature may be appended. Plain chat/internal skips it. */
  format?: 'email' | 'plain'
  /** With action=send_and_pending: minutes until the thread's date; omit = no date. */
  snoozeMinutes?: number
  /** Email-only: comma-separated extra recipients. */
  cc?: string
  bcc?: string
  /** Soft undo: delay delivery by this many seconds (server caps at 600). */
  sendAfterSeconds?: number
  /** Email-only: send from this mailbox and rebind the thread to it. */
  channelAccountId?: string
  /** Email-only, mail-native composer: explicit To override (comma-separated). */
  to?: string
  /** reply | reply_all | forward — forward skips In-Reply-To threading. */
  mode?: 'reply' | 'reply_all' | 'forward'
  /** The bubble this reply/forward was started from. */
  sourceMessageId?: string
  /** Subject override (e.g. "Fwd: ..."). */
  subject?: string
  /** Quoted prior-conversation HTML; the server appends it below the signature. */
  quotedHtml?: string
  /**
   * After this reply: true hands the conversation back to the agent, false
   * keeps it with the sender; omitted follows the channel routing policy.
   */
  handback?: boolean
  /** Explicitly keep the conversation open when the channel closes after a human reply. */
  keepOpen?: boolean
}

/** Channel routing policy as the thread detail exposes it to the composer. */
export type ThreadRoutingPolicy = {
  afterHumanReply: 'return_to_agent' | 'keep_with_human' | 'ask'
  closeAfterAgentReply: boolean
  closeAfterHumanReply: boolean
  reopenOwner: 'same_owner' | 'route_again'
}

export type PatchThreadInput = {
  status?: ThreadStatus
  assignedToUserId?: number
  assignee?: AssigneeInput
  tags?: string[]
  priority?: ThreadPriority
  projectId?: string | null
  /** Email-only: bind the thread to this mailbox (From + channel folder). */
  channelAccountId?: string
}

export type BulkThreadAction =
  | 'close'
  | 'reopen'
  | 'spam'
  | 'read'
  | 'unread'
  | 'assign'
  | 'trash'
  | 'file'

export type SyncFolderStatus = {
  id: number
  folderId: string
  folderName: string
  isSelected: boolean
  lastSyncAt: string | null
  messagesSynced: number
  lastError: string
}

export type SyncConnectionStatus = {
  id: number
  mailboxEmail: string
  displayName: string
  provider: string
  status: string
  isEnabled: boolean
  lastSyncAt: string | null
  lastError: string
  folders: SyncFolderStatus[]
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asNullableString(value: unknown): string | null {
  const text = asString(value)
  return text.length > 0 ? text : null
}

/**
 * Normalize an API timestamp (returned as Unix milliseconds number, ISO string,
 * or seconds number) into an ISO 8601 string. Returns empty string when the
 * value cannot be parsed.
 */
function asTimestampString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    // API returns timestamps in ms. Treat smaller values as seconds.
    const ms = value > 1e12 ? value : value * 1000
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return ''
}

function asNullableTimestampString(value: unknown): string | null {
  const iso = asTimestampString(value)
  return iso.length > 0 ? iso : null
}

function asThreadId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  const num = asNumber(value, NaN)
  if (Number.isFinite(num) && num > 0) return String(num)
  return null
}

export function normalizeThreadRow(row: unknown): InboxThread | null {
  return normalizeThread(row)
}

function normalizeThread(row: unknown): InboxThread | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const id = asThreadId(raw.id)
  if (id == null) return null
  const statusValue = asString(raw.status)
  const status: ThreadStatus =
    statusValue === 'pending' ? 'pending' : statusValue === 'closed' ? 'closed' : statusValue === 'spam' ? 'spam' : 'open'
  const priorityValue = asString(raw.priority)
  const priority: ThreadPriority = priorityValue === 'high' ? 'high' : priorityValue === 'urgent' ? 'urgent' : 'normal'
  return {
    id,
    organisationId: asString(raw.organisation_id),
    emailConnectionId: raw.email_connection_id == null || raw.email_connection_id === 0 ? null : asNumber(raw.email_connection_id),
    channelAccountId: asNullableString(raw.channel_account_id),
    graphConversationId: asString(raw.graph_conversation_id ?? raw.external_id),
    emailSubject: asString(raw.email_subject ?? raw.subject, '(No subject)'),
    lastMessagePreview: plainChatText(asString(raw.last_message_preview)),
    lastMessageDirection: asString(raw.last_message_direction) as InboxThread['lastMessageDirection'],
    lastMessageByAgent: raw.last_message_by_agent === true,
    contactId: asNullableString(raw.contact_id),
    agentId: asNullableString(raw.agent_id),
    agentName: asNullableString(raw.agent_name),
    addressedAgent: (() => {
      const row = raw.addressed_agent
      if (!row || typeof row !== 'object') return null
      const id = asNullableString((row as { id?: unknown }).id)
      const name = asNullableString((row as { name?: unknown }).name)
      return id && name ? { id, name } : null
    })(),
    agentKind: asNullableString(raw.agent_kind),
    agentAvatarKind: asNullableString(raw.agent_avatar_kind) ?? asNullableString(raw.avatar_kind),
    agentAvatarIcon: asNullableString(raw.agent_avatar_icon) ?? asNullableString(raw.avatar_icon),
    agentAvatarColor: asNullableString(raw.agent_avatar_color) ?? asNullableString(raw.avatar_color),
    agentAvatarShape: asNullableString(raw.agent_avatar_shape) ?? asNullableString(raw.avatar_shape),
    agentAvatarImageUrl:
      asNullableString(raw.agent_avatar_image_url) ?? asNullableString(raw.avatar_image_url),
    contactEmail: asString(raw.contact_email),
    contactName: asString(raw.contact_name),
    contactPhone: asString(raw.contact_phone),
    contactBasis: asString(raw.contact_basis),
    status,
    nextAt: asNullableTimestampString(raw.next_at),
    endsAt: asNullableTimestampString(raw.ends_at),
    scheduleDetails: normalizeScheduleDetails(raw.schedule_details),
    schedule: 'schedule' in raw ? normalizeThreadSchedule(raw.schedule) : undefined,
    priority,
    assignedToUserId:
      raw.assigned_to_user_id == null || raw.assigned_to_user_id === 0 ? null : asNumber(raw.assigned_to_user_id),
    owner: normalizeOwner(raw.owner),
    turn: normalizeTurn(raw.turn),
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : undefined,
    inheritedTags: Array.isArray(raw.inherited_tags)
      ? raw.inherited_tags.filter((t): t is string => typeof t === 'string')
      : undefined,
    folderPaths: Array.isArray(raw.folder_paths)
      ? raw.folder_paths.flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const row = item as Record<string, unknown>
          const tags = Array.isArray(row.tags)
            ? row.tags.filter((name): name is string => typeof name === 'string' && Boolean(name))
            : []
          if (!tags.length) return []
          return [
            {
              label: typeof row.label === 'string' ? row.label : tags.map((name) => `#${name}`).join(' / '),
              projectId: typeof row.project_id === 'string' ? row.project_id : null,
              tags,
            },
          ]
        })
      : undefined,
    lastMessageAt: asNullableTimestampString(raw.last_message_at),
    hasUnread: Boolean(raw.has_unread),
    hasOpenDecision: Boolean(raw.has_open_decision),
    isPinned: Boolean(raw.is_pinned),
    isExample: Boolean(raw.is_example),
    aiHandling: normalizeAiHandling(raw.ai_handling),
    suggestedActions: Array.isArray(raw.suggested_actions)
      ? raw.suggested_actions.filter((a): a is string => typeof a === 'string')
      : [],
    category: asNullableString(raw.category),
    urgency: typeof raw.urgency === 'number' ? raw.urgency : null,
    certainty: typeof raw.certainty === 'number' ? raw.certainty : null,
    aiSummary: asNullableString(raw.ai_summary),
    ticket: 'ticket' in raw ? normalizeThreadTicket(raw.ticket) : undefined,
    createdAt: asTimestampString(raw.created_at),
    channel: asString(raw.channel, 'email'),
    source: asString(raw.source),
    folder: asString(raw.folder, raw.channel === 'internal' ? 'internal' : 'external'),
    projectId: asNullableString(raw.folder_id) ?? asNullableString(raw.project_id),
  }
}

export type ThreadTicket = {
  /** The category hashtag's id. */
  tagId: string
  name: string
  color?: string
  icon?: string
  status: TicketStatus
  stage: TicketStage | null
  projectId: string | null
}

function normalizeThreadTicket(raw: unknown): ThreadTicket | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const stage = row.stage && typeof row.stage === 'object' ? (row.stage as Record<string, unknown>) : null
  return {
    tagId: asString(row.tag_id),
    name: asString(row.name),
    color: asString(row.color),
    icon: asString(row.icon),
    status: (asString(row.status) || 'open') as TicketStatus,
    projectId: asNullableString(row.project_id),
    stage:
      stage && typeof stage.key === 'string'
        ? {
            key: stage.key,
            name: asString(stage.name),
            kind: (asString(stage.kind) || 'open') as TicketStage['kind'],
            auto_close_conversation:
              asString(stage.kind) === 'done' ? Boolean(stage.auto_close_conversation) : false,
            progress: typeof stage.progress === 'number' ? stage.progress : undefined,
          }
        : null,
  }
}

function normalizeMessage(row: unknown): InboxMessage | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const id = asThreadId(raw.id)
  if (id == null) return null
  const threadId = asThreadId(raw.thread_id) ?? ''
  const directionValue = asString(raw.direction)
  const direction: MessageDirection =
    directionValue === 'outbound'
      ? 'outbound'
      : directionValue === 'internal'
        ? 'internal'
        : directionValue === 'system'
          ? 'system'
          : 'inbound'
  const bodyText = asString(raw.body_text) || undefined
  const bodyPreview = asString(raw.body_preview)
  const payload =
    raw.payload && typeof raw.payload === 'object' ? (raw.payload as Record<string, unknown>) : {}
  return {
    id,
    threadId,
    connectionId: raw.connection_id == null || raw.connection_id === 0 ? null : asNumber(raw.connection_id),
    kind: asString(raw.kind) || undefined,
    direction,
    fromAddress: asString(raw.from_address),
    toAddresses: asString(raw.to_addresses),
    cc: asNullableString(raw.cc),
    bcc: asNullableString(raw.bcc),
    toHeader: asNullableString(raw.to_header),
    replyMode: asNullableString(raw.reply_mode),
    subject: asString(raw.subject),
    bodyPreview,
    bodyText,
    bodyHtml: asNullableString(raw.body_html),
    hasHtml: raw.has_html === true || Boolean(asNullableString(raw.body_html)),
    graphMessageId: asString(raw.graph_message_id),
    inReplyTo: asNullableString(raw.in_reply_to),
    authorUserId: raw.author_user_id == null || raw.author_user_id === 0 ? null : asNumber(raw.author_user_id),
    isRead: Boolean(raw.is_read),
    ...normalizeDelivery(raw),
    attachments: Array.isArray(raw.attachments) ? raw.attachments : null,
    decisionId: raw.decision_id ? asString(raw.decision_id) : null,
    payload,
    myFeedback: normalizeMyFeedback(raw),
    reactions: normalizeReactionsField(raw),
    ...normalizeMessageActivity(raw),
    ...messageProposalFields(payload),
    seq: typeof raw.seq === 'number' ? raw.seq : null,
    receivedAt: asNullableTimestampString(raw.received_at),
    createdAt: asTimestampString(raw.created_at),
  }
}

/** Send state and the "delivered to customer" flag (API flags first, body heuristics as fallback). */
export function normalizeDelivery(
  raw: Record<string, unknown>,
): Pick<InboxMessage, 'sendStatus' | 'isMock' | 'deliveredToCustomer'> {
  const value = asString(raw.send_status)
  // Server values: sending | scheduled | sent | failed | failed:{reason}.
  // The failure reason survives so the bubble can explain what to do.
  const sendStatus: SendStatus | null =
    value === 'sending' || value === 'scheduled' || value === 'sent' || value === 'failed'
      ? value
      : value.startsWith('failed:')
        ? (value as SendStatus)
        : null
  const payload =
    raw.payload && typeof raw.payload === 'object' ? (raw.payload as Record<string, unknown>) : {}
  const isMock =
    raw.is_mock === true ||
    payload.is_mock === true ||
    payload.llm_mode === 'mock' ||
    isMockAgentBody(asString(raw.body_text)) ||
    isMockAgentBody(asString(raw.body_preview))
  return { sendStatus, isMock, deliveredToCustomer: isMock ? false : raw.delivered_to_customer === true }
}

export function normalizeMyFeedback(raw: Record<string, unknown>): InboxMessage['myFeedback'] {
  const fb = raw.my_feedback
  if (!fb || typeof fb !== 'object') return null
  const f = fb as Record<string, unknown>
  const sentiment = f.sentiment === 'up' || f.sentiment === 'down' ? f.sentiment : null
  const score = typeof f.score === 'number' ? f.score : null
  if (sentiment == null && score == null) return null
  return { score, sentiment }
}

function normalizeReactionsField(raw: Record<string, unknown>): InboxMessage['reactions'] {
  const data = raw.reactions
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  const kindsRaw = Array.isArray(obj.kinds) ? obj.kinds : []
  const kinds = kindsRaw
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const r = row as Record<string, unknown>
      const rawKind = String(r.kind || '')
      const kind = rawKind === 'angry' ? 'facepalm' : rawKind
      if (
        kind !== 'up' &&
        kind !== 'down' &&
        kind !== 'hundred' &&
        kind !== 'facepalm' &&
        kind !== 'clap' &&
        kind !== 'thinking' &&
        kind !== 'investigating'
      ) {
        return null
      }
      const reactors = Array.isArray(r.reactors)
        ? r.reactors
            .map((item) => {
              if (!item || typeof item !== 'object') return null
              const p = item as Record<string, unknown>
              return {
                actorType: (p.actor_type === 'agent' ? 'agent' : 'user') as 'user' | 'agent',
                actorId: String(p.actor_id || ''),
                name: String(p.name || ''),
              }
            })
            .filter((x): x is NonNullable<typeof x> => x != null)
        : []
      return {
        kind: kind as NonNullable<InboxMessage['reactions']>['kinds'][number]['kind'],
        emoji: typeof r.emoji === 'string' ? r.emoji : '',
        count: typeof r.count === 'number' ? r.count : reactors.length || 1,
        reactors,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
  const mineRaw = obj.mine === 'angry' ? 'facepalm' : obj.mine
  const mine =
    mineRaw === 'up' ||
    mineRaw === 'down' ||
    mineRaw === 'hundred' ||
    mineRaw === 'facepalm' ||
    mineRaw === 'clap' ||
    mineRaw === 'thinking' ||
    mineRaw === 'investigating'
      ? mineRaw
      : null
  return { kinds, mine }
}

function normalizeEvent(row: unknown): InboxEvent | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const id = asThreadId(raw.id)
  if (id == null) return null
  const threadId = asThreadId(raw.thread_id) ?? ''
  return {
    id,
    threadId,
    eventType: asString(raw.event_type),
    actorType: raw.actor_type == null ? null : asString(raw.actor_type),
    actorUserId: raw.actor_user_id == null || raw.actor_user_id === 0 ? null : asNumber(raw.actor_user_id),
    actorAgentId: raw.actor_agent_id == null ? null : asString(raw.actor_agent_id) || null,
    payload: raw.payload && typeof raw.payload === 'object' ? (raw.payload as Record<string, unknown>) : {},
    createdAt: asTimestampString(raw.created_at),
  }
}

function normalizeFolder(row: unknown): MailboxFolder | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const id = asString(raw.id)
  if (!id) return null
  return {
    id,
    displayName: asString(raw.display_name ?? raw.displayName, id),
    totalItems: asNumber(raw.total_items ?? raw.totalItemCount),
    isSelected: Boolean(raw.is_selected),
    lastSyncAt: asNullableTimestampString(raw.last_sync_at),
  }
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export async function listMailboxFolders(token: string, connectionId: number): Promise<MailboxFolder[]> {
  const payload = await apiGet<{ folders?: unknown[]; sync_state?: unknown[] }>(
    integrationsRoutes.email.connections.folders(connectionId),
    token,
  )
  const rawFolders = Array.isArray(payload.folders) ? payload.folders : Array.isArray(payload) ? (payload as unknown[]) : []
  const syncState: FolderSyncState[] = Array.isArray(payload.sync_state)
    ? payload.sync_state.map((row) => {
        const raw = row as Record<string, unknown>
        return {
          id: asNumber(raw.id),
          folderId: asString(raw.folder_id),
          folderName: asString(raw.folder_name),
          isSelected: Boolean(raw.is_selected),
          lastSyncAt: asNullableTimestampString(raw.last_sync_at),
        } satisfies FolderSyncState
      })
    : []
  const syncMap = new Map(syncState.map((s) => [s.folderId, s]))
  return rawFolders
    .map((row) => {
      const folder = normalizeFolder(row)
      if (!folder) return null
      const state = syncMap.get(folder.id)
      return { ...folder, isSelected: state?.isSelected ?? folder.isSelected, lastSyncAt: state?.lastSyncAt ?? folder.lastSyncAt }
    })
    .filter((f): f is MailboxFolder => f !== null)
}

export async function saveMailboxFolders(
  token: string,
  connectionId: number,
  folders: Array<{ id: string; display_name: string; is_selected: boolean }>,
): Promise<void> {
  await apiPut(integrationsRoutes.email.connections.folders(connectionId), { folders }, token)
}

import {
  addNoteToSignalThread,
  deleteSignalNote,
  deleteSignalThread,
  getSignalMessage,
  getSignalThread,
  listSignalMembers,
  listSignalPinnedThreadIds,
  listSignalThreads,
  markSignalThreadRead,
  markSignalThreadUnread,
  patchSignalThread,
  pinSignalThread,
  replyToSignalThread,
  resolveSignalDecision,
  unpinSignalThread,
  updateSignalNote,
} from './signals-api'
export type {
  InboxRule,
  InboxRuleSuggestion,
  ResolveDecisionResult,
  ThreadSession,
  ThreadSessionAction,
} from './signals-api'
export {
  createInboxRule,
  deleteInboxRule,
  listInboxRules,
  updateInboxRule,
} from './signals-api'

// ---------------------------------------------------------------------------
// Threads (Signal API)
// ---------------------------------------------------------------------------

export async function listThreads(token: string, filters: ThreadFilters = {}): Promise<PagedThreadResult> {
  return listSignalThreads(token, filters)
}

export async function getThread(
  token: string,
  threadId: ThreadId,
  opts?: { limit?: number; before?: string },
): Promise<ThreadDetail | null> {
  return getSignalThread(token, String(threadId), opts)
}

export async function getMessage(
  token: string,
  threadId: ThreadId,
  messageId: string,
): Promise<InboxMessage | null> {
  return getSignalMessage(token, String(threadId), messageId)
}

export async function deleteThread(token: string, threadId: ThreadId): Promise<string | null> {
  return deleteSignalThread(token, String(threadId))
}

export async function patchThread(token: string, threadId: ThreadId, patch: PatchThreadInput): Promise<InboxThread | null> {
  const updated = await patchSignalThread(token, String(threadId), patch)
  if (patch.status === 'closed' || patch.status === 'spam') {
    // A closed or spam conversation has no reply to finish; a leftover draft
    // would resurface as "Draft restored" on reopen.
    clearStoredComposerDraft(String(threadId))
  }
  return updated
}

// ---------------------------------------------------------------------------
// Read / unread state
// ---------------------------------------------------------------------------

export async function markThreadRead(token: string, threadId: ThreadId): Promise<InboxThread | null> {
  return markSignalThreadRead(token, String(threadId))
}

export async function markThreadUnread(token: string, threadId: ThreadId): Promise<InboxThread | null> {
  return markSignalThreadUnread(token, String(threadId))
}

// ---------------------------------------------------------------------------
// Pin state (per-user)
// ---------------------------------------------------------------------------

export async function listPinnedThreadIds(token: string): Promise<ThreadId[]> {
  return listSignalPinnedThreadIds(token)
}

export async function pinThread(token: string, threadId: ThreadId): Promise<void> {
  return pinSignalThread(token, String(threadId))
}

export async function unpinThread(token: string, threadId: ThreadId): Promise<void> {
  return unpinSignalThread(token, String(threadId))
}

export async function replyToThread(token: string, threadId: ThreadId, input: ReplyInput): Promise<InboxMessage | null> {
  return replyToSignalThread(token, String(threadId), input)
}

export async function addNoteToThread(
  token: string,
  threadId: ThreadId,
  bodyText: string,
  attachments?: MessageAttachment[],
  opts?: { asChat?: boolean },
): Promise<InboxMessage | null> {
  return addNoteToSignalThread(token, String(threadId), bodyText, attachments, opts)
}

export async function updateThreadNote(
  token: string,
  threadId: ThreadId,
  messageId: string,
  bodyText: string,
): Promise<InboxMessage | null> {
  return updateSignalNote(token, String(threadId), messageId, bodyText)
}

export async function deleteThreadNote(
  token: string,
  threadId: ThreadId,
  messageId: string,
): Promise<void> {
  return deleteSignalNote(token, String(threadId), messageId)
}

/** Ask the AI to draft a reply for the composer (nothing is sent). */
export async function draftThreadReply(
  token: string,
  threadId: ThreadId,
  instruction = '',
): Promise<string> {
  const payload = await apiPost<{ draft?: string }>(
    appRoutes.signals.threadDraft(String(threadId)),
    { instruction },
    token,
  )
  return typeof payload.draft === 'string' ? payload.draft : ''
}

/** Draft composer text with the lead agent when the message has no thread yet. */
export async function draftComposerText(token: string, instruction: string): Promise<string> {
  const payload = await apiPost<{ draft?: string }>(
    appRoutes.signals.composeDraft,
    { instruction },
    token,
  )
  return typeof payload.draft === 'string' ? payload.draft : ''
}

export type HandledExternallyChannel = 'phone' | 'whatsapp' | 'email' | 'other'

export type HandledExternallyInput = {
  channel: HandledExternallyChannel
  note?: string
  close?: boolean
  /** UI language for the timeline line. */
  language?: string
}

/**
 * The conversation was settled outside Bokito (call, personal WhatsApp,
 * another mailbox). Logs a timeline line, parks open AI proposals and counts
 * as the team's reply; optionally closes the thread.
 */
export async function markThreadHandledExternally(
  token: string,
  threadId: ThreadId,
  input: HandledExternallyInput,
): Promise<void> {
  await apiPost(
    appRoutes.signals.threadHandledExternally(String(threadId)),
    {
      channel: input.channel,
      note: input.note ?? '',
      close: Boolean(input.close),
      language: input.language ?? '',
    },
    token,
  )
  clearStoredComposerDraft(String(threadId))
}

export async function resolveThreadDecision(
  token: string,
  threadId: ThreadId,
  messageId: ThreadId,
  action: 'approve' | 'defer' | 'reject',
  opts?: {
    optionId?: string
    optionIds?: string[]
    body?: string
    bodyHtml?: string
    subject?: string
    responseText?: string
    /** Chat bubbles of an approved reply (one customer message each). */
    messages?: string[]
    /** Sender identity for approved reply suggestions. */
    sendAs?: 'user' | 'agent'
  },
): Promise<ResolveDecisionResult> {
  return resolveSignalDecision(token, String(threadId), String(messageId), action, opts)
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function listInboxMembers(token: string): Promise<InboxMember[]> {
  return listSignalMembers(token)
}

// ---------------------------------------------------------------------------
// AI language and sender (tenant-wide). AI handling itself: lib/ai-handling-api.
// ---------------------------------------------------------------------------

/** "auto" mirrors the customer's language; otherwise a fixed ISO code. */
export type ReplyLanguage = 'auto' | 'nl' | 'en' | 'de' | 'fr' | 'es'
export type WorkspaceLanguage = Exclude<ReplyLanguage, 'auto'>

/** Sender identity when a human approves a suggested reply. */
export type ReplySendAs = 'user' | 'agent'

export type AiCommunicationSettings = {
  replyLanguage: ReplyLanguage
  workspaceLanguage: WorkspaceLanguage
  replySendAs: ReplySendAs
}

const REPLY_LANGUAGES: ReplyLanguage[] = ['auto', 'nl', 'en', 'de', 'fr', 'es']

export async function getAiCommunicationSettings(token: string): Promise<AiCommunicationSettings> {
  const payload = await apiGet<{
    reply_language?: string
    workspace_language?: string
    reply_send_as?: string
  }>(policyRoutes.aiLanguage(), token)
  const replyLanguage = REPLY_LANGUAGES.includes(payload.reply_language as ReplyLanguage)
    ? (payload.reply_language as ReplyLanguage)
    : 'auto'
  const workspaceLanguage =
    payload.workspace_language && payload.workspace_language !== 'auto'
      && REPLY_LANGUAGES.includes(payload.workspace_language as ReplyLanguage)
      ? (payload.workspace_language as WorkspaceLanguage)
      : 'nl'
  return {
    replyLanguage,
    workspaceLanguage,
    replySendAs: payload.reply_send_as === 'agent' ? 'agent' : 'user',
  }
}

export async function saveAiCommunicationSettings(
  token: string,
  input: {
    replyLanguage?: ReplyLanguage
    workspaceLanguage?: WorkspaceLanguage
    replySendAs?: ReplySendAs
  },
): Promise<void> {
  const body: Record<string, string> = {}
  if (input.replyLanguage !== undefined) body.reply_language = input.replyLanguage
  if (input.workspaceLanguage !== undefined) body.workspace_language = input.workspaceLanguage
  if (input.replySendAs !== undefined) body.reply_send_as = input.replySendAs
  await apiPut(policyRoutes.aiLanguage(), body, token)
}

// ---------------------------------------------------------------------------
// Widget behaviour (pre-chat form, offline message, continue on WhatsApp)
// ---------------------------------------------------------------------------

export type WhatsAppHandover = {
  enabled: boolean
  accountId: string
  /** Fallback public number until the WhatsApp account reports its own. */
  number: string
  numberKnown: boolean
  ready: boolean
}

export type WidgetSettings = {
  preChatForm: boolean
  offlineMessage: string
  /** True when someone with Handle access on the widget is available now. */
  teamAvailable: boolean
  whatsappHandover: WhatsAppHandover
}

function normalizeWidgetSettings(raw: Record<string, unknown>): WidgetSettings {
  const handover = (raw.whatsapp_handover ?? {}) as Record<string, unknown>
  return {
    preChatForm: Boolean(raw.pre_chat_form),
    offlineMessage: asString(raw.offline_message),
    teamAvailable: raw.team_available !== false,
    whatsappHandover: {
      enabled: Boolean(handover.enabled),
      accountId: asString(handover.account_id),
      number: asString(handover.number),
      numberKnown: Boolean(handover.number_known),
      ready: Boolean(handover.ready),
    },
  }
}

export async function getWidgetSettings(token: string): Promise<WidgetSettings> {
  const payload = await apiGet<Record<string, unknown>>(policyRoutes.widgetSettings(), token)
  return normalizeWidgetSettings(payload)
}

export async function saveWidgetSettings(
  token: string,
  input: {
    preChatForm?: boolean
    offlineMessage?: string
    whatsappHandover?: Pick<WhatsAppHandover, 'enabled' | 'accountId' | 'number'>
  },
): Promise<WidgetSettings> {
  const body: Record<string, unknown> = {}
  if (input.preChatForm !== undefined) body.pre_chat_form = input.preChatForm
  if (input.offlineMessage !== undefined) body.offline_message = input.offlineMessage
  if (input.whatsappHandover !== undefined) {
    body.whatsapp_handover = {
      enabled: input.whatsappHandover.enabled,
      account_id: input.whatsappHandover.accountId,
      number: input.whatsappHandover.number,
    }
  }
  const payload = await apiPut<Record<string, unknown>>(policyRoutes.widgetSettings(), body, token)
  return normalizeWidgetSettings(payload)
}
