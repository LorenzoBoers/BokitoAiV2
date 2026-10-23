/**
 * Virtualized conversation timeline. One flat row list for every thread type
 * (customer, assistant chat, agent run): day pills, time pills, messages,
 * decision cards, agent session cards and merged event clusters are all rows,
 * so react-virtuoso can keep long threads cheap without a second code path.
 */
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { Button } from '../ui/button'
import { useTranslation } from 'react-i18next'
import { Virtuoso, type ListRange, type VirtuosoHandle } from 'react-virtuoso'
import type {
  InboxEvent,
  InboxMember,
  InboxMessage,
  ReplySendAs,
  ThreadDetail as ThreadDetailType,
  ThreadId,
} from '../../lib/inbox-api'
import type { ChatTagMap } from '../../lib/chatText'
import type { MailDraftMode } from '../../lib/mail-reply'
import { assignBubbleStacks, CHAT_COLUMN_CLASS, CHAT_STACK_GAP_MS } from '../../lib/chat-layout'
import { parseDecisionOptions } from '../../lib/decision-options'
import { sessionIdOf } from '../../lib/session-timeline'
import { isWorkTranscript } from '../../lib/work-transcript'
import { threadPatchHasMeaning, withTagDiffs } from '../../lib/thread-events'
import { cn } from '../../lib/utils'
import { DotGridBackground } from '../ui/DotGridBackground'
import {
  EventClusterTimelineItem,
  MessageTimelineItem,
  eventClusterKey,
} from './TimelineItem'
import { useAuth } from '../../context/AuthContext'
import DecisionRequestMessage from './DecisionRequestMessage'
import type { DecisionResolvedInfo } from './useDecisionResolve'
import SessionMarker from './SessionMarker'
import { TimelineScrollContext, type TimelineScrollApi } from './timeline-scroll'
import type { NoteActions } from './TimelineItem'
import type { BubbleStack } from './ChatBubble'

type ThreadSession = ThreadDetailType['sessions'][number]

type VirtuosoRow = TimelineRow

type TimelineEntry =
  | { kind: 'message'; time: string; id: string; data: InboxMessage }
  | { kind: 'event'; time: string; id: string; data: InboxEvent }
  | { kind: 'session'; time: string; id: string; data: ThreadSession }

export type TimelineRow =
  | { kind: 'day'; id: string; time: string; label: string }
  | { kind: 'message'; id: string; time: string; data: InboxMessage }
  | { kind: 'events'; id: string; time: string; events: InboxEvent[] }
  | { kind: 'session'; id: string; time: string; session: ThreadSession }

/** Events the timeline never shows: a card or system_event message already says it. */
function isHiddenEvent(
  eventType: string,
  payload?: Record<string, unknown> | null,
  answeredDecisionIds?: Set<string>,
  questionDecisionIds?: Set<string>,
): boolean {
  if (
    eventType === 'replied' ||
    eventType === 'note_added' ||
    eventType === 'reply_sent' ||
    eventType === 'agent_session_started' ||
    eventType === 'agent_session_closed' ||
    eventType === 'decision_created' ||
    eventType === 'suggestion_created' ||
    eventType === 'contact_linked' ||
    eventType === 'contact_unlinked' ||
    // The agent's own tool calls are the timeline. This pill is the worker
    // closing the run, and it reads as a platform step rather than the agent.
    eventType === 'agent_processed' ||
    // Floor handoffs show as chat bubbles + participant strip, not pills.
    // Keep participant_turn_timeout visible: max_consecutive ("Agents stopten…")
    // and deadline ("reageerde niet op tijd") are the only operator cues.
    eventType === 'participant_turn_requested' ||
    eventType === 'participant_turn_sent' ||
    eventType === 'handoff_session_started' ||
    eventType === 'handoff_session_interrupted' ||
    eventType === 'handoff_depth_exceeded' ||
    // Team chat / notes already render as bubbles; pills were "Bericht toegevoegd".
    eventType === 'team_message' ||
    // Inbound mail already shows as its own bubble; this system pill is noise.
    eventType === 'message_added' ||
    // Filing already updates the header folder chip; avoid a vague leftover pill.
    eventType === 'folder_set'
  ) {
    return true
  }
  // The reply bubble already shows the delivery on the channel.
  if (eventType === 'delivered' && payload?.target_kind === 'reply') return true
  // The agent cloud (or the operator answer) already carries the choice.
  if (eventType.startsWith('decision_') && typeof payload?.decision_id === 'string') {
    if (answeredDecisionIds?.has(payload.decision_id)) return true
    if (questionDecisionIds?.has(payload.decision_id)) return true
  }
  return eventType === 'thread_updated' && !threadPatchHasMeaning(payload)
}

function makeDayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function makeDayLabel(date: Date, t: (key: string) => string, locale?: string): string {
  const now = new Date()
  const todayKey = makeDayKey(now)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const key = makeDayKey(date)
  if (key === todayKey) return t('timeline.today')
  if (key === makeDayKey(yesterday)) return t('timeline.yesterday')
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/**
 * Flatten a thread into timeline rows. Consecutive system/AI events that
 * happen within `CHAT_STACK_GAP_MS` (5 minutes — same window as chat bubbles,
 * Slack/MUI grouping) share one pill row. A larger gap starts a new cluster
 * so bursts from different moments stay distinct.
 */
export function eventsShareCluster(
  previousIso: string,
  nextIso: string,
  gapMs: number = CHAT_STACK_GAP_MS,
): boolean {
  const previous = new Date(previousIso).getTime()
  const next = new Date(nextIso).getTime()
  if (!Number.isFinite(previous) || !Number.isFinite(next)) return true
  return Math.abs(next - previous) <= gapMs
}

/** Leftover wrap-up cards: sessions close themselves now. */
export function isSessionCheckoutCard(message: InboxMessage): boolean {
  if (message.kind !== 'decision_request') return false
  const options = parseDecisionOptions(message.proposal?.options ?? message.payload?.options)
  return options.some(
    (option) =>
      option.action_type === 'session_checkout' || Boolean(option.payload?.session_checkout),
  )
}

/** Decision ids already covered by a real operator answer bubble. */
export function answeredDecisionIds(messages: InboxMessage[]): Set<string> {
  const answered = new Set<string>()
  for (const message of messages) {
    if (!message.decisionResponse) continue
    for (const id of message.decisionResponseDecisionIds ?? []) {
      if (id) answered.add(String(id))
    }
    if (message.decisionResponseDecisionId) {
      answered.add(String(message.decisionResponseDecisionId))
    }
  }
  return answered
}

/**
 * Legacy helper: older builds synthesized operator answer bubbles for silent
 * resolves. Attribution now lives on the decision cloud, so we never rebuild
 * those bubbles.
 */
export function syntheticDecisionAnswers(
  _messages: InboxMessage[],
  _threadId: string,
  _t: (key: string) => string,
): InboxMessage[] {
  return []
}

/** Decision ids that already have a cloud (proposal host or decision card). */
function questionDecisionIdsFrom(messages: InboxMessage[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.proposal?.decisionId) ids.add(message.proposal.decisionId)
    for (const entry of message.proposal?.bundle ?? []) {
      if (entry.decisionId) ids.add(entry.decisionId)
    }
    if (message.kind === 'decision_request' && message.decisionId) {
      ids.add(String(message.decisionId))
    }
  }
  return ids
}

/** Hide legacy Goedgekeurd/Afgewezen operator echoes when the cloud covers them. */
export function isHiddenDecisionResponse(
  message: InboxMessage,
  questionDecisionIds: Set<string>,
): boolean {
  if (!message.decisionResponse) return false
  const ids = [
    ...(message.decisionResponseDecisionIds ?? []),
    ...(message.decisionResponseDecisionId ? [message.decisionResponseDecisionId] : []),
  ]
    .map(String)
    .filter(Boolean)
  if (!ids.length) return false
  return ids.some((id) => questionDecisionIds.has(id))
}

function entryMs(entry: TimelineEntry): number {
  return new Date(entry.time).getTime()
}

/**
 * Messages in ``seq`` order (the server's thread order). Events, sessions and
 * rows without a seq join by time between them.
 */
function orderByThread(entries: TimelineEntry[]): TimelineEntry[] {
  const numbered = entries
    .filter((entry) => entry.kind === 'message' && typeof entry.data.seq === 'number')
    .sort((a, b) => ((a.data as InboxMessage).seq ?? 0) - ((b.data as InboxMessage).seq ?? 0))
  const timed = entries
    .filter((entry) => !(entry.kind === 'message' && typeof entry.data.seq === 'number'))
    .sort((a, b) => entryMs(a) - entryMs(b))
  const out: TimelineEntry[] = []
  let i = 0
  let j = 0
  while (i < numbered.length || j < timed.length) {
    if (j >= timed.length || (i < numbered.length && entryMs(numbered[i]) <= entryMs(timed[j]))) {
      out.push(numbered[i])
      i += 1
    } else {
      out.push(timed[j])
      j += 1
    }
  }
  return out
}

export function buildTimelineRows(
  detail: ThreadDetailType | null,
  t: (key: string) => string,
  locale?: string,
): TimelineRow[] {
  if (!detail) return []
  const threadKey = String(detail.thread.id)
  const healed = [
    ...detail.messages,
    ...syntheticDecisionAnswers(detail.messages, threadKey, t),
  ]
  // A card shown inline under its agent bubble does not render a second time.
  const inlineHosts = new Set(
    healed.filter((m) => m.proposal).map((m) => String(m.id)),
  )
  const answeredIds = answeredDecisionIds(healed)
  const questionDecisionIds = questionDecisionIdsFrom(healed)
  // Older patches stored the full label list; derive per-step diffs for the feed.
  const events = withTagDiffs(detail.events)
  const entries: TimelineEntry[] = [
    ...healed
      .filter(
        (m) =>
          !(m.attachedToMessageId && inlineHosts.has(m.attachedToMessageId)) &&
          !isHiddenDecisionResponse(m, questionDecisionIds),
      )
      .map((m) => ({
      kind: 'message' as const,
      time: m.receivedAt ?? m.createdAt,
      id: `m-${m.listKey || m.id}`,
      data: m,
    })),
    ...events
      .filter((e) => !isHiddenEvent(e.eventType, e.payload, answeredIds, questionDecisionIds))
      .map((e) => ({ kind: 'event' as const, time: e.createdAt, id: `e-${e.id}`, data: e })),
    ...(detail.sessions ?? []).map((s) => ({
      kind: 'session' as const,
      time: s.startedAt,
      id: `s-${s.id}`,
      data: s,
    })),
  ]
    .filter((entry) => !Number.isNaN(new Date(entry.time).getTime()))

  // "Conversation started" is the first action, above the opening message,
  // even when ingest time is later than the mail's sent time.
  const started = entries.filter(
    (entry) => entry.kind === 'event' && entry.data.eventType === 'signal_created',
  )
  const rest = entries.filter((entry) => !started.includes(entry))
  if (started.length && rest.length) {
    const earliest = Math.min(...rest.map((entry) => new Date(entry.time).getTime()))
    started.forEach((entry, index) => {
      entry.time = new Date(earliest - (started.length - index)).toISOString()
    })
  }
  const ordered = [...started, ...orderByThread(rest)]

  const rows: TimelineRow[] = []
  let dayKey: string | null = null
  for (const entry of ordered) {
    const date = new Date(entry.time)
    const key = makeDayKey(date)
    if (key !== dayKey) {
      dayKey = key
      rows.push({ kind: 'day', id: `d-${key}`, time: entry.time, label: makeDayLabel(date, t, locale) })
    }
    if (entry.kind === 'event') {
      const last = rows[rows.length - 1]
      if (last && last.kind === 'events') {
        const previous = last.events[last.events.length - 1]
        if (
          previous &&
          eventsShareCluster(previous.createdAt, entry.time) &&
          eventClusterKey(previous) === eventClusterKey(entry.data)
        ) {
          last.events.push(entry.data)
          continue
        }
      }
      rows.push({ kind: 'events', id: entry.id, time: entry.time, events: [entry.data] })
      continue
    }
    if (entry.kind === 'session') {
      rows.push({ kind: 'session', id: entry.id, time: entry.time, session: entry.data })
      continue
    }
    rows.push({ kind: 'message', id: entry.id, time: entry.time, data: entry.data })
  }
  return rows
}

/**
 * Author + lane key for WhatsApp-style bubble stacking. Notes stay in their
 * own lane so a teammate note does not glue to their customer reply.
 * Decision cards never stack. Anonymous / system rows fall back to kind so
 * consecutive system notes still group.
 */
function messageStackKey(message: InboxMessage): string | null {
  if (message.kind === 'decision_request') return null
  // System activity is a meta row, not a stacked note bubble.
  if (message.kind === 'system_event') return null
  // Session turns stack among themselves, never onto a customer reply.
  const sessionId = sessionIdOf(message)
  const scope = sessionId ? `session:${sessionId}:` : ''
  // Agent notes join that agent's event run (one avatar), not its chat bubbles.
  if (message.kind === 'internal_note') {
    const noteAgentId =
      typeof message.payload?.agent_id === 'string' && message.payload.agent_id
        ? message.payload.agent_id
        : message.role === 'assistant'
          ? 'agent'
          : ''
    if (noteAgentId) return `${scope}agent-activity:${noteAgentId}`
  }
  const isAgent =
    message.kind === 'agent_message' ||
    Boolean(message.payload?.agent_id) ||
    Boolean(message.hasActivity)
  if (isAgent) {
    const aid =
      typeof message.payload?.agent_id === 'string' && message.payload.agent_id
        ? message.payload.agent_id
        : 'agent'
    return `${scope}agent:${aid}`
  }
  const lane = message.kind === 'internal_note' ? 'note' : message.direction
  if (message.authorUserId != null) return `${scope}${lane}:user:${message.authorUserId}`
  const from = (message.fromAddress || '').trim().toLowerCase()
  if (from) return `${scope}${lane}:from:${from}`
  return `${scope}${lane}:kind:${message.kind || 'message'}`
}

/**
 * True when a live agent turn would join the run of the last saved row: a
 * bubble of the same agent within the stack gap. The live view then skips
 * avatar and author line and opens with a flattened corner, like the saved
 * bubble will. Another agent always opens its own run with its name.
 */
export function liveRunContinues(
  rows: TimelineRow[],
  agentId: string | number | null,
  now: number = Date.now(),
): boolean {
  if (agentId == null) return false
  const last = rows[rows.length - 1]
  if (!last || last.kind !== 'message') return false
  const key = messageStackKey(last.data)
  if (!key || !key.endsWith(`agent:${String(agentId)}`)) return false
  return now - new Date(last.time).getTime() <= CHAT_STACK_GAP_MS
}

/**
 * Same key as an agent bubble (`agent:{id}`), so a burst of that agent's
 * events and notes is one run: one avatar, one name, the actions underneath.
 */
function agentEventRunKey(events: InboxEvent[]): string | null {
  if (events.length === 0 || eventClusterKey(events[0]) !== 'agent') return null
  const id =
    events.map((event) => event.actorAgentId).find(Boolean) ||
    events
      .map((event) => (typeof event.payload?.agent_id === 'string' ? event.payload.agent_id : ''))
      .find(Boolean) ||
    ''
  return `agent-activity:${id || 'agent'}`
}

/** Assign start/middle/end/single for consecutive same-author chat bubbles. */
function stacksForRows(rows: TimelineRow[]): Map<string, BubbleStack> {
  return assignBubbleStacks(
    rows.map((row) => {
      const activity = row.kind === 'events' ? agentEventRunKey(row.events) : null
      return {
        id: row.id,
        key: row.kind === 'message' ? messageStackKey(row.data) : activity,
        timeMs: new Date(row.time).getTime(),
        // Agent events stay in the run with that agent's bubbles. Other
        // events, day markers and sessions still split a run.
        breaksRun:
          row.kind === 'day' || row.kind === 'session' || (row.kind === 'events' && activity == null),
      }
    }),
  )
}

export type TimelineLanding = {
  index: number
  align: 'start' | 'center' | 'end'
  /** Follow new output after landing. False for a new inbound email. */
  pinToBottom: boolean
}

/**
 * Clears the top edge fade. Virtuoso's `offset` is added to scrollTop, so a
 * negative value leaves space above an `align: 'start'` item.
 */
const TOP_FADE_CLEARANCE_PX = -48

function isSkippableLandingMessage(message: InboxMessage): boolean {
  const kind = message.kind || ''
  return (
    kind === 'internal_note' ||
    kind === 'system_event' ||
    kind === 'decision_request' ||
    // Team-only session turns never decide where an email thread lands.
    sessionIdOf(message) !== null
  )
}

/** Fresh sends animate once. Older rows stay still when Virtuoso recycles them. */
const BUBBLE_ENTER_MS = 700

function bubbleEnterFresh(message: InboxMessage): boolean {
  const at = Date.parse(message.createdAt || message.receivedAt || '')
  return Number.isFinite(at) && Date.now() - at < BUBBLE_ENTER_MS
}

function isMailDocument(message: InboxMessage): boolean {
  return message.direction !== 'internal' && !isSkippableLandingMessage(message)
}

/**
 * Mail rows that open unfolded: the newest mail and the newest inbound mail
 * (question + answer stay readable); everything older folds to its envelope.
 */
export function openMailRowIds(rows: TimelineRow[]): Set<string> {
  const open = new Set<string>()
  let sawLatest = false
  let sawInbound = false
  for (let i = rows.length - 1; i >= 0 && !(sawLatest && sawInbound); i -= 1) {
    const row = rows[i]
    if (row.kind !== 'message' || !isMailDocument(row.data)) continue
    if (!sawLatest) {
      open.add(row.id)
      sawLatest = true
    }
    if (!sawInbound && row.data.direction === 'inbound') {
      open.add(row.id)
      sawInbound = true
    }
  }
  return open
}

/**
 * Inbound messages at the end of the thread that made it unread. Thread-level
 * unread has no per-message cursor, so we take the trailing inbound cluster
 * after the last outbound reply (or from the start when none).
 */
export function trailingUnreadInboundIds(messages: InboxMessage[]): string[] {
  const ids: string[] = []
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message) continue
    if (isSkippableLandingMessage(message)) continue
    if (message.direction === 'inbound') {
      ids.push(String(message.id))
      continue
    }
    if (message.direction === 'outbound') break
  }
  return ids.reverse()
}

/** Where the timeline should open: bottom of the thread, or the start of a new inbound email. */
export function resolveTimelineLanding(
  rows: TimelineRow[],
  lastIndex: number,
  opts: { focusedMessageId: string | null; messageLayout: 'chat' | 'email' },
): TimelineLanding {
  if (opts.focusedMessageId) {
    const focused = rows.findIndex(
      (row) => row.kind === 'message' && String(row.data.id) === opts.focusedMessageId,
    )
    if (focused >= 0) return { index: focused, align: 'center', pinToBottom: false }
  }
  const bottom: TimelineLanding = {
    index: Math.max(0, lastIndex),
    align: 'end',
    pinToBottom: true,
  }
  if (opts.messageLayout !== 'email') return bottom
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]
    if (row.kind !== 'message') continue
    if (isSkippableLandingMessage(row.data)) continue
    if (row.data.direction === 'inbound') {
      // Include the day pill above the mail so "Gisteren" stays in view.
      const dayIndex = i > 0 && rows[i - 1]?.kind === 'day' ? i - 1 : i
      return { index: dayIndex, align: 'start', pinToBottom: false }
    }
    return bottom
  }
  return bottom
}

export type ThreadTimelineHandle = {
  scrollToBottom: (behavior?: 'auto' | 'smooth') => void
  /** Keep the scroller on the last pixel without Virtuoso index jumps. */
  pinToEnd: () => void
  land: (behavior?: 'auto' | 'smooth') => TimelineLanding
}

type Props = {
  rows: TimelineRow[]
  threadId: ThreadId
  /** Thread channel; delivery labels only show on customer channels. */
  channel?: string | null
  /** Latest message row id; used to pin the initial scroll position. */
  latestMessageRowId: string | null
  language?: string
  messageLayout: 'chat' | 'email'
  membersById: Record<number, InboxMember>
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  contactId?: string | null
  agentName?: string | null
  agentId?: string | null
  /** Bound mailbox for signature preview on decision cards. */
  channelAccountId?: string | null
  agentAvatarKind?: string | null
  agentAvatarIcon?: string | null
  agentAvatarColor?: string | null
  agentAvatarShape?: string | null
  agentAvatarImageUrl?: string | null
  /** Tag name -> kind for #chips in agent/operator bubbles. */
  chatTags?: ChatTagMap
  events: InboxEvent[]
  noteActions?: NoteActions
  /** Reply / Reply all / Forward started from an email bubble. */
  onMailAction?: (message: InboxMessage, mode: MailDraftMode) => void
  /** Our mailbox address(es); hides Reply all when nobody else was copied. */
  mailOwnAddresses?: string[]
  /** Retry a failed outbound send from the bubble. */
  onRetrySend?: (messageId: string) => void | Promise<void>
  /** Deep-linked card (`?message=`): highlighted and scrolled into view. */
  focusedMessageId: string | null
  /** Trailing unread inbound messages briefly flash when the thread opens. */
  unreadHighlightIds?: string[]
  hasOlder?: boolean
  loadingOlder?: boolean
  onLoadOlder?: () => void | Promise<void>
  activeSessionId: string | null
  /** True while the operator's Ask message streams in the active session. */
  agentStreaming: boolean
  onRefresh: (quiet?: boolean) => void
  onDecisionResolved?: (info?: DecisionResolvedInfo) => void
  onAnswer?: (answer: { text: string; decisionId: string } | null) => void
  onEditDraft: (draft: {
    body: string
    subject?: string
    decisionMessageId: string
    sendAs?: ReplySendAs
  }) => void
  /** Open reply proposals shown as the compact agent-cloud pill. */
  compactDecisionMessageIds: string[]
  /** Decision message id currently loaded in the reply composer, if any. */
  composerDecisionMessageId?: string | null
  /** Open proposals that answer an older message than the newest inbound one. */
  outdatedDecisionMessageIds?: string[]
  /** Live AI strip pinned under the last row while a reply streams. */
  liveTrace?: ReactNode
  /**
   * Turn ids whose words the reader already saw. Their saved bubbles land
   * without the enter animation so the hand-off from live to saved is still.
   */
  quietTurnIds?: Set<string>
  emptyState?: ReactNode
  onAtBottomChange?: (atBottom: boolean) => void
}

const TimelineLiveContext = createContext<ReactNode>(null)
const TimelineFooterAttachContext = createContext<(node: HTMLDivElement | null) => void>(() => {})

/** Stable Footer type so Virtuoso does not remount the live bubble on every delta. */
function TimelineFooter() {
  const liveTrace = useContext(TimelineLiveContext)
  const attachFooter = useContext(TimelineFooterAttachContext)
  return (
    <div ref={attachFooter} data-testid="virtuoso-footer" className="px-4">
      <div className={CHAT_COLUMN_CLASS}>
        {liveTrace ? <div className="mb-4">{liveTrace}</div> : null}
        <div className="h-4" aria-hidden />
      </div>
    </div>
  )
}

const TimelineScroller = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function TimelineScroller({ className, style, ...props }, ref) {
    const holder = useContext(TimelineScrollContext)
    return (
      <div
        {...props}
        ref={(node) => {
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
          if (holder) holder.scroller.current = node
        }}
        className={cn('overflow-x-hidden overflow-y-auto', className)}
        style={{
          ...style,
          overflowX: 'hidden',
          overflowY: 'auto',
          // Pin the tail ourselves. Browser overflow-anchor plus a
          // programmatic pin bounce the thread up and down.
          overflowAnchor: 'none',
        }}
      />
    )
  },
)

const ThreadTimeline = forwardRef<ThreadTimelineHandle, Props>(function ThreadTimeline(
  {
    rows,
    threadId,
    channel,
    language,
    messageLayout,
    membersById,
    contactName,
    contactEmail,
    contactPhone,
    contactId,
    agentName,
    agentId,
    channelAccountId = null,
    agentAvatarKind,
    agentAvatarIcon,
    agentAvatarColor,
    agentAvatarShape,
    agentAvatarImageUrl,
    chatTags,
    events,
    noteActions,
    onMailAction,
    mailOwnAddresses,
    onRetrySend,
    focusedMessageId,
    unreadHighlightIds = [],
    hasOlder = false,
    loadingOlder = false,
    onLoadOlder,
    activeSessionId,
    agentStreaming,
    onRefresh,
    onDecisionResolved,
    onAnswer,
    onEditDraft,
    compactDecisionMessageIds,
    composerDecisionMessageId = null,
    outdatedDecisionMessageIds,
    liveTrace,
    quietTurnIds,
    emptyState,
    onAtBottomChange,
  },
  ref,
) {
  const { t } = useTranslation('communication')
  const { user } = useAuth()
  const currentUserId = user?.id ?? null
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const scrollerNode = useRef<HTMLDivElement | null>(null)
  const bottomTimersRef = useRef<number[]>([])
  const flushRafRef = useRef(0)
  /** True after the operator scrolls away from the latest row. */
  const readingHistoryRef = useRef(false)
  /** Scroll events caused by a tail flush. They are not the operator leaving. */
  const followWriteUntilRef = useRef(0)
  const atBottomRef = useRef(true)
  /** Wheel-down shortly before a scroll means the operator returned to the end. */
  const userWheelDownUntilRef = useRef(0)
  // Upward wheel/touch arms this. Follow stops only if the scroll that
  // follows actually leaves the latest messages.
  const wheelUpUntilRef = useRef(0)
  /** Programmatic land may keep snapping until this instant, unless the user scrolls. */
  const settleUntilRef = useRef(0)
  const bubbleStacks = useMemo(() => stacksForRows(rows), [rows])
  const openMailIds = useMemo(
    () => (messageLayout === 'email' ? openMailRowIds(rows) : null),
    [rows, messageLayout],
  )
  const virtuosoData = rows
  const footerNode = useRef<HTMLDivElement | null>(null)
  const footerRoRef = useRef<ResizeObserver | null>(null)
  const lastFooterHeightRef = useRef(0)
  /** Day stuck under the top fade; the next day pill replaces it (relay). */
  const [stickyDay, setStickyDay] = useState<{ id: string; label: string } | null>(null)
  const updateStickyDay = useCallback(
    (range: ListRange) => {
      for (let i = range.startIndex; i >= 0; i -= 1) {
        const row = virtuosoData[i]
        if (row && row.kind === 'day') {
          setStickyDay((prev) =>
            prev?.id === row.id ? prev : { id: row.id, label: row.label },
          )
          return
        }
      }
      setStickyDay(null)
    },
    [virtuosoData],
  )
  useEffect(() => {
    setStickyDay(null)
  }, [threadId])

  const landing = useMemo(
    () =>
      resolveTimelineLanding(rows, virtuosoData.length - 1, {
        focusedMessageId,
        messageLayout,
      }),
    [rows, virtuosoData.length, focusedMessageId, messageLayout],
  )

  const stopSettling = useCallback(() => {
    settleUntilRef.current = 0
    if (flushRafRef.current) {
      window.cancelAnimationFrame(flushRafRef.current)
      flushRafRef.current = 0
    }
    for (const id of bottomTimersRef.current) window.clearTimeout(id)
    bottomTimersRef.current = []
  }, [])

  const releaseFollow = useCallback(() => {
    readingHistoryRef.current = true
    atBottomRef.current = false
    stopSettling()
    onAtBottomChange?.(false)
  }, [onAtBottomChange, stopSettling])

  const noteWheel = useCallback((deltaY: number) => {
    if (deltaY > 6) userWheelDownUntilRef.current = Date.now() + 500
    // Do not release here. A flick on a thread that already shows the latest
    // row never moves the scroller, and releasing anyway raised "N new"
    // while the operator was still reading the bottom.
    if (deltaY < -6) wheelUpUntilRef.current = Date.now() + 400
  }, [])

  const scrollApi = useMemo<TimelineScrollApi>(
    () => ({ scroller: scrollerNode, releaseFollow, noteWheel }),
    [noteWheel, releaseFollow],
  )

  /**
   * Put the tail on the last pixel. One write per growth, not a chase:
   * easing toward a list that is still growing is the air under new rows.
   */
  const flushTail = useCallback(() => {
    if (readingHistoryRef.current) return
    const el = scrollerNode.current
    if (!el) return
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    if (el.scrollTop >= max - 1) return
    followWriteUntilRef.current = performance.now() + 64
    el.scrollTop = max
  }, [])

  const attachFooter = useCallback(
    (node: HTMLDivElement | null) => {
      footerNode.current = node
      footerRoRef.current?.disconnect()
      footerRoRef.current = null
      if (!node) return
      lastFooterHeightRef.current = node.offsetHeight
      const ro = new ResizeObserver(() => {
        const next = node.offsetHeight
        const grew = next - lastFooterHeightRef.current
        lastFooterHeightRef.current = next
        // The live cloud grows in this footer. Close the whole gap; adding
        // only the footer box leaves the margin under the newest row.
        if (grew < 1) return
        flushTail()
        window.requestAnimationFrame(() => flushTail())
      })
      footerRoRef.current = ro
      ro.observe(node)
    },
    [flushTail],
  )

  const scrollToAbsoluteBottom = useCallback(
    (_behavior: 'auto' | 'smooth' = 'auto', settleMs = 0) => {
      readingHistoryRef.current = false
      atBottomRef.current = true
      stopSettling()
      // Footer holds the live bubble. Index-snap on the last message hides
      // it. One flush now, and one after the new row has a height.
      flushTail()
      if (settleMs <= 0) return
      settleUntilRef.current = Date.now() + settleMs
      bottomTimersRef.current = [100]
        .filter((ms) => ms <= settleMs)
        .map((ms) => window.setTimeout(flushTail, ms))
    },
    [flushTail, stopSettling],
  )

  // Cleanup only: a stopSettling() here would run after the layout effect
  // below and cancel the opening snap, leaving the thread underscrolled.
  useEffect(() => () => stopSettling(), [threadId, stopSettling])

  const openedThreadSnapRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    openedThreadSnapRef.current = null
    readingHistoryRef.current = false
    atBottomRef.current = true
  }, [threadId])
  useLayoutEffect(() => {
    if (rows.length === 0) return
    const key = String(threadId)
    if (openedThreadSnapRef.current === key) return
    openedThreadSnapRef.current = key
    if (!landing.pinToBottom) {
      // Landing mid-thread (deep link, top of a new email): stay put.
      readingHistoryRef.current = true
      atBottomRef.current = false
      return
    }
    scrollToAbsoluteBottom('auto', 280)
  }, [threadId, landing.pinToBottom, rows.length, scrollToAbsoluteBottom])

  // Optimistic sends land in the row list before the server message count
  // moves. Pin that new row before paint, or it sits under the fold and the
  // cloud grows below it.
  const rowCountRef = useRef(0)
  useLayoutEffect(() => {
    const next = virtuosoData.length
    const grew = next > rowCountRef.current
    rowCountRef.current = next
    if (!grew) return
    flushTail()
    const frame = window.requestAnimationFrame(() => flushTail())
    return () => window.cancelAnimationFrame(frame)
  }, [virtuosoData.length, flushTail])

  useEffect(() => {
    const el = scrollerNode.current
    if (!el) return
    const userLeavingTail = () => {
      // A flick that cannot move (the thread already fits) stays in follow.
      // Any real move upward lets go at once. Waiting for a 72px gap never
      // happened: the tail glue pulled those pixels back first.
      if (el.scrollTop <= 2 && el.scrollHeight <= el.clientHeight + 8) return
      releaseFollow()
    }
    const onWheel = (event: WheelEvent) => {
      noteWheel(event.deltaY)
      if (event.deltaY < -1) userLeavingTail()
    }
    let touchY = 0
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? 0
    }
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? touchY
      const delta = touchY - y
      noteWheel(delta)
      if (delta < -1) userLeavingTail()
      touchY = y
    }
    // Scrollbar drag: the pointer is down while scrollTop moves. A click
    // without movement does not count, so selecting text stays in follow.
    let pointerDown = false
    let lastTop = el.scrollTop
    const onPointerDown = () => {
      pointerDown = true
    }
    const onPointerUp = () => {
      pointerDown = false
    }
    // The list sizer, the footer and a late item measure all change
    // scrollHeight. Follow that number, not one element: an agent row, a
    // tool line or a live turn grows a different box than a saved message.
    // Rebinding this watcher on every new row resets the baseline after the
    // growth and drops those items under the fold.
    let lastHeight = el.scrollHeight
    let lastClient = el.clientHeight
    let followUp = 0
    const compensateGrowth = () => {
      const nextHeight = el.scrollHeight
      const nextClient = el.clientHeight
      const grew = nextHeight - lastHeight
      const viewportShrunk = lastClient - nextClient
      lastHeight = nextHeight
      lastClient = nextClient
      if (grew <= 1 && viewportShrunk <= 1) return
      flushTail()
      lastTop = el.scrollTop
      // Virtuoso commits the row's real height a frame later. Agent lines,
      // tool rows and the live turn show up in that second measure.
      if (followUp) return
      followUp = window.requestAnimationFrame(() => {
        followUp = 0
        if (!el.isConnected || readingHistoryRef.current) return
        const again = el.scrollHeight
        const client = el.clientHeight
        const more = again - lastHeight > 1 || lastClient - client > 1
        lastHeight = again
        lastClient = client
        if (!more) return
        flushTail()
        lastTop = el.scrollTop
      })
    }
    const contentRo = new ResizeObserver(compensateGrowth)
    const watch = (node: Element | null) => {
      if (node) contentRo.observe(node)
    }
    watch(el)
    const watchTree = () => {
      const list = el.querySelector('[data-testid="virtuoso-item-list"]')
      watch(list)
      if (list) {
        for (const child of list.children) watch(child)
      }
      watch(el.querySelector('[data-testid="virtuoso-footer"]'))
    }
    watchTree()
    const listMo = new MutationObserver(() => {
      watchTree()
      compensateGrowth()
    })
    listMo.observe(el, { childList: true, subtree: true })
    const onScroll = () => {
      const top = el.scrollTop
      const delta = top - lastTop
      lastTop = top
      // Our own flush. Do not treat it as the operator leaving or returning.
      if (performance.now() < followWriteUntilRef.current) return
      const userUp = pointerDown || Date.now() < wheelUpUntilRef.current
      if (userUp && delta < -1) {
        userLeavingTail()
        return
      }
      // Back on the last pixels (wheel or scrollbar): follow again, and
      // sit flush. "Near the end" is not the end.
      const gap = el.scrollHeight - top - el.clientHeight
      const cameBack =
        readingHistoryRef.current &&
        delta > 2 &&
        gap <= 8 &&
        (pointerDown || Date.now() < userWheelDownUntilRef.current)
      if (cameBack) {
        readingHistoryRef.current = false
        atBottomRef.current = true
        onAtBottomChange?.(true)
        flushTail()
        lastTop = el.scrollTop
      }
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('pointerdown', onPointerDown, { passive: true })
    el.addEventListener('pointerup', onPointerUp, { passive: true })
    el.addEventListener('pointercancel', onPointerUp, { passive: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') userLeavingTail()
    }
    el.addEventListener('keydown', onKeyDown)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
      el.removeEventListener('keydown', onKeyDown)
      el.removeEventListener('scroll', onScroll)
      contentRo.disconnect()
      listMo.disconnect()
      if (followUp) window.cancelAnimationFrame(followUp)
    }
  }, [threadId, rows.length > 0, noteWheel, releaseFollow, onAtBottomChange, flushTail])

  useEffect(() => () => footerRoRef.current?.disconnect(), [])

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (behavior: 'auto' | 'smooth' = 'auto') => {
        // Settle only on an explicit land (open thread, send). Stream growth
        // uses pinToEnd so a rAF loop cannot fight Virtuoso.
        scrollToAbsoluteBottom(behavior, behavior === 'smooth' ? 280 : 0)
      },
      pinToEnd: () => {
        // A reader who scrolled up stays there. Forcing the tail back is
        // the fight they feel while the agent is still typing.
        if (readingHistoryRef.current) return
        atBottomRef.current = true
        flushTail()
      },
      land: (behavior: 'auto' | 'smooth' = 'auto') => {
        if (readingHistoryRef.current) return landing
        if (landing.pinToBottom) {
          scrollToAbsoluteBottom(behavior, 280)
        } else {
          stopSettling()
          readingHistoryRef.current = true
          virtuosoRef.current?.scrollToIndex({
            index: landing.index,
            align: landing.align,
            offset: landing.align === 'start' ? TOP_FADE_CLEARANCE_PX : 0,
            behavior,
          })
        }
        return landing
      },
    }),
    [landing, flushTail, scrollToAbsoluteBottom, stopSettling],
  )

  // Deep link from a notification: land on that card instead of the bottom.
  useEffect(() => {
    if (!focusedMessageId) return
    const index = rows.findIndex(
      (row) => row.kind === 'message' && String(row.data.id) === focusedMessageId,
    )
    if (index < 0) return
    readingHistoryRef.current = true
    const timer = window.setTimeout(
      () => virtuosoRef.current?.scrollToIndex({ index, align: 'center' }),
      60,
    )
    return () => window.clearTimeout(timer)
  }, [focusedMessageId, rows])

  const compact = useMemo(
    () => new Set(compactDecisionMessageIds),
    [compactDecisionMessageIds],
  )
  const outdated = useMemo(
    () => new Set(outdatedDecisionMessageIds ?? []),
    [outdatedDecisionMessageIds],
  )

  if (rows.length === 0) {
    // h-full (not flex-1): the parent in ThreadDetail is a sized block box,
    // so flex-1 would collapse to 0 and hide the empty state / live trace.
    return (
      <div className="relative h-full min-h-0">
        <DotGridBackground />
        <div className="absolute inset-0 z-[1] flex min-h-0 flex-col overflow-y-auto overflow-x-hidden px-4 py-4">
          <div className={cn(CHAT_COLUMN_CLASS, 'flex min-h-0 flex-1 flex-col')}>
            <div className="flex flex-1 items-center justify-center">{emptyState}</div>
            {liveTrace ? <div className="mb-3 shrink-0">{liveTrace}</div> : null}
          </div>
        </div>
      </div>
    )
  }

  // One bubble renderer for thread messages and session transcripts.
  const renderMessageItem = (
    message: InboxMessage,
    stack: BubbleStack,
    opts: { focused?: boolean; unreadFlash?: boolean; rowId?: string } = {},
  ) => (
    <MessageTimelineItem
      message={message}
      threadId={threadId}
      channel={channel}
      layout={messageLayout}
      contactName={contactName}
      contactEmail={contactEmail}
      contactPhone={contactPhone}
      contactId={contactId}
      agentName={agentName}
      agentId={agentId}
      agentAvatarKind={agentAvatarKind}
      agentAvatarIcon={agentAvatarIcon}
      agentAvatarColor={agentAvatarColor}
      agentAvatarShape={agentAvatarShape}
      agentAvatarImageUrl={agentAvatarImageUrl}
      membersById={membersById}
      noteActions={noteActions}
      stack={stack}
      onProposalResolved={onDecisionResolved}
      onAnswer={onAnswer}
      chatTags={chatTags}
      onMailAction={onMailAction}
      mailOwnAddresses={mailOwnAddresses}
      onRetrySend={onRetrySend}
      enterAnimation={
        bubbleEnterFresh(message) && !(message.turnId && quietTurnIds?.has(message.turnId))
      }
      mailCollapsedByDefault={
        openMailIds != null &&
        opts.rowId != null &&
        !opts.focused &&
        !opts.unreadFlash &&
        isMailDocument(message) &&
        !openMailIds.has(opts.rowId)
      }
    />
  )

  const dayPillClass =
    'rounded-lg bg-bg-elevated/90 px-2.5 py-0.5 text-2xs font-medium text-text-muted shadow-sm ring-1 ring-border/40 backdrop-blur'

  const renderRow = (row: TimelineRow) => {
    if (row.kind === 'day') {
      // In-flow marker; hide while the sticky overlay shows the same day.
      const isSticky = stickyDay?.id === row.id
      return (
        <div className="flex justify-center pb-3 pt-2">
          <span className={cn(dayPillClass, isSticky && 'opacity-0')}>{row.label}</span>
        </div>
      )
    }
    if (row.kind === 'events') {
      const stack = bubbleStacks.get(row.id) ?? 'single'
      const lead = stack === 'single' || stack === 'start'
      const tightBelow = stack === 'start' || stack === 'middle'
      return (
        <div className={tightBelow ? 'mb-1.5' : 'mb-3'}>
          <EventClusterTimelineItem
            events={row.events}
            lead={lead}
            time={row.time}
            memberNameFor={(userId) => (userId != null ? membersById[userId]?.name : undefined)}
            membersById={membersById}
            currentUserId={currentUserId}
            startedByName={contactName}
            agentName={agentName}
            agentId={agentId}
            agentAvatarKind={agentAvatarKind}
            agentAvatarIcon={agentAvatarIcon}
            agentAvatarColor={agentAvatarColor}
            agentAvatarShape={agentAvatarShape}
            agentAvatarImageUrl={agentAvatarImageUrl}
          />
        </div>
      )
    }
    if (row.kind === 'session') {
      return (
        <div className="mb-3">
          <SessionMarker
            session={row.session}
            threadId={String(threadId)}
            streaming={row.session.id === activeSessionId && agentStreaming}
            onChanged={onRefresh}
          />
        </div>
      )
    }
    const message = row.data
    const focused = focusedMessageId != null && String(message.id) === focusedMessageId
    const unreadFlash = unreadHighlightIds.includes(String(message.id))
    const stack = bubbleStacks.get(row.id) ?? 'single'
    const workTurn =
      message.kind === 'decision_request' || isWorkTranscript(message, channel)
    const tightBelow = !workTurn && (stack === 'start' || stack === 'middle')
    // Reaction dock adds its own clearance; keep a little more air between runs.
    return (
      <div
        data-message-id={String(message.id)}
        className={cn(
          tightBelow ? 'mb-1.5' : 'mb-4',
          focused && 'rounded-[20px] ring-2 ring-accent/50 ring-offset-4 ring-offset-bg-canvas',
          unreadFlash && 'unread-message-flash',
        )}
      >
        {message.kind === 'decision_request' ? (
          <DecisionRequestMessage
            message={message}
            threadId={threadId}
            events={events}
            membersById={membersById}
            agentName={agentName}
            agentId={agentId}
            channelAccountId={channelAccountId}
            agentAvatarKind={agentAvatarKind}
            agentAvatarIcon={agentAvatarIcon}
            agentAvatarColor={agentAvatarColor}
      agentAvatarShape={agentAvatarShape}
            agentAvatarImageUrl={agentAvatarImageUrl}
            compactReplyProposal={compact.has(String(message.id))}
            activeInComposer={composerDecisionMessageId === String(message.id)}
            outdated={outdated.has(String(message.id))}
            onResolved={onDecisionResolved}
            onAnswer={onAnswer}
            onEditDraft={onEditDraft}
          />
        ) : (
          renderMessageItem(message, stack, { focused, unreadFlash, rowId: row.id })
        )}
      </div>
    )
  }

  return (
    <TimelineScrollContext.Provider value={scrollApi}>
    <TimelineLiveContext.Provider value={liveTrace ?? null}>
    <TimelineFooterAttachContext.Provider value={attachFooter}>
    <div className="relative h-full min-h-0">
      <DotGridBackground />
      <Virtuoso
        key={String(threadId)}
        ref={virtuosoRef}
        data={virtuosoData}
        className="absolute inset-0 z-[1] overflow-x-hidden"
        computeItemKey={(_index, row) => row.id}
        initialTopMostItemIndex={{
          index: landing.index,
          align: landing.align,
          offset: landing.align === 'start' ? TOP_FADE_CLEARANCE_PX : 0,
        }}
        defaultItemHeight={72}
        followOutput={false}
        skipAnimationFrameInResizeObserver
        atBottomThreshold={72}
        atBottomStateChange={(atBottom) => {
          atBottomRef.current = atBottom
          // Growing an expanded mail while the operator is still near the
          // end also reports "at bottom". That must not resume follow —
          // the next measure would yank the view back down the message.
          if (atBottom) {
            if (!readingHistoryRef.current) onAtBottomChange?.(true)
            return
          }
          if (readingHistoryRef.current) onAtBottomChange?.(false)
        }}
        // Email bodies render in iframes that measure asynchronously; a
        // generous viewport keeps them mounted so heights stay stable.
        increaseViewportBy={{ top: 1200, bottom: 1200 }}
        rangeChanged={updateStickyDay}
        startReached={() => {
          if (hasOlder && !loadingOlder && onLoadOlder) void onLoadOlder()
        }}
        components={{
          Scroller: TimelineScroller,
          Header: () =>
            hasOlder && onLoadOlder ? (
              <div className={cn(CHAT_COLUMN_CLASS, 'px-4 pb-3 pt-12')}>
                <div className="flex justify-center">
                  <Button variant="secondary" size="xs"
                    type="button"
                    disabled={loadingOlder}
                    onClick={() => void onLoadOlder()}
                   
                  >
                    {loadingOlder ? t('threadChrome.loadingOlder') : t('threadChrome.loadOlder')}
                  </Button>
                </div>
              </div>
            ) : (
              // Clears the top edge fade so the first bubble/header stays readable.
              <div className="pt-12" />
            ),
          Footer: TimelineFooter,
        }}
        itemContent={(_index, row) => (
          <div className="px-4">
            <div className={CHAT_COLUMN_CLASS}>{renderRow(row)}</div>
          </div>
        )}
      />
      {/* Fade + sticky day pill: messages recede under the active day. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 right-0 top-0 z-[5] h-10 bg-gradient-to-b from-bg via-bg/85 to-transparent"
      />
      {stickyDay ? (
        <div className="pointer-events-none absolute left-0 right-0 top-2 z-[6] flex justify-center px-4">
          <span className={dayPillClass}>{stickyDay.label}</span>
        </div>
      ) : null}
    </div>
    </TimelineFooterAttachContext.Provider>
    </TimelineLiveContext.Provider>
    </TimelineScrollContext.Provider>
  )
})

export default ThreadTimeline
