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
  type HTMLAttributes,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
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
import type { ChatMessage } from '../../lib/signals-api'
import type { LiveTurn } from '../../lib/agentActivity'
import {
  mergeSessionLiveMessages,
  type SessionStreamState,
} from '../../lib/use-agent-session-chat'
import { assignBubbleStacks, CHAT_COLUMN_CLASS, CHAT_STACK_GAP_MS } from '../../lib/chat-layout'
import { threadPatchHasMeaning } from '../../lib/thread-events'
import { cn } from '../../lib/utils'
import { EventClusterTimelineItem, MessageTimelineItem, isAgentSideEvent } from './TimelineItem'
import DecisionRequestMessage from './DecisionRequestMessage'
import AgentSessionCard from './AgentSessionCard'
import type { NoteActions } from './TimelineItem'
import type { BubbleStack } from './ChatBubble'

type ThreadSession = ThreadDetailType['sessions'][number]

type VirtuosoRow =
  | TimelineRow
  | { kind: 'live'; id: string }
  | { kind: 'end'; id: string }

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
    eventType === 'agent_processed'
  ) {
    return true
  }
  // Operator reply bubble already carries the answer — skip the status pill.
  if (
    eventType.startsWith('decision_') &&
    answeredDecisionIds &&
    typeof payload?.decision_id === 'string' &&
    answeredDecisionIds.has(payload.decision_id)
  ) {
    return true
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

export function buildTimelineRows(
  detail: ThreadDetailType | null,
  t: (key: string) => string,
  locale?: string,
): TimelineRow[] {
  if (!detail) return []
  // A card shown inline under its agent bubble does not render a second time.
  const inlineHosts = new Set(
    detail.messages.filter((m) => m.proposal).map((m) => String(m.id)),
  )
  const answeredDecisionIds = new Set(
    detail.messages
      .filter((m) => m.decisionResponse && m.decisionResponseDecisionId)
      .map((m) => String(m.decisionResponseDecisionId)),
  )
  const entries: TimelineEntry[] = [
    ...detail.messages
      .filter((m) => !(m.attachedToMessageId && inlineHosts.has(m.attachedToMessageId)))
      .map((m) => ({
      kind: 'message' as const,
      time: m.receivedAt ?? m.createdAt,
      id: `m-${m.id}`,
      data: m,
    })),
    ...detail.events
      .filter((e) => !isHiddenEvent(e.eventType, e.payload, answeredDecisionIds))
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
  const ordered = [...started, ...rest].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
  )

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
          isAgentSideEvent(previous) === isAgentSideEvent(entry.data)
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
  // System activity renders as centered pills, not stacked note bubbles.
  if (message.kind === 'system_event') return null
  const isAgent =
    message.kind === 'agent_message' ||
    Boolean(message.payload?.agent_id) ||
    Boolean(message.hasActivity)
  if (isAgent) {
    const aid =
      typeof message.payload?.agent_id === 'string' && message.payload.agent_id
        ? message.payload.agent_id
        : 'agent'
    return `agent:${aid}`
  }
  const lane = message.direction === 'internal' ? 'note' : message.direction
  if (message.authorUserId != null) return `${lane}:user:${message.authorUserId}`
  const from = (message.fromAddress || '').trim().toLowerCase()
  if (from) return `${lane}:from:${from}`
  return `${lane}:kind:${message.kind || 'message'}`
}

/** Assign start/middle/end/single for consecutive same-author chat bubbles. */
function stacksForRows(rows: TimelineRow[]): Map<string, BubbleStack> {
  return assignBubbleStacks(
    rows.map((row) => ({
      id: row.id,
      key: row.kind === 'message' ? messageStackKey(row.data) : null,
      timeMs: new Date(row.time).getTime(),
      breaksRun: row.kind !== 'message',
    })),
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
    kind === 'decision_request'
  )
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
  agentName?: string | null
  agentId?: string | null
  /** Bound mailbox for signature preview on decision cards. */
  channelAccountId?: string | null
  agentAvatarKind?: string | null
  agentAvatarIcon?: string | null
  agentAvatarColor?: string | null
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
  sessionMessages: ChatMessage[] | null
  sessionStream: SessionStreamState
  agentStreaming: boolean
  /** Live agent turn inside the active session (gateway activity). */
  sessionTurn?: LiveTurn
  onRefresh: (quiet?: boolean) => void
  onUseSessionAsReply: (text: string) => void
  onDecisionResolved?: (info?: { closed?: boolean }) => void
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
  emptyState?: ReactNode
  onAtBottomChange?: (atBottom: boolean) => void
}

const ScrollerNodeContext = createContext<MutableRefObject<HTMLDivElement | null> | null>(null)

const TimelineScroller = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function TimelineScroller({ className, style, ...props }, ref) {
    const holder = useContext(ScrollerNodeContext)
    return (
      <div
        {...props}
        ref={(node) => {
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
          if (holder) holder.current = node
        }}
        className={cn('overflow-x-hidden overflow-y-auto', className)}
        style={{
          ...style,
          overflowX: 'hidden',
          overflowY: 'auto',
          // Prefer keeping the row under the cursor stable when email/image
          // heights settle above or below the viewport.
          overflowAnchor: 'auto',
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
    agentName,
    agentId,
    channelAccountId = null,
    agentAvatarKind,
    agentAvatarIcon,
    agentAvatarColor,
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
    sessionMessages,
    sessionStream,
    agentStreaming,
    sessionTurn,
    onRefresh,
    onUseSessionAsReply,
    onDecisionResolved,
    onEditDraft,
    compactDecisionMessageIds,
    composerDecisionMessageId = null,
    outdatedDecisionMessageIds,
    liveTrace,
    emptyState,
    onAtBottomChange,
  },
  ref,
) {
  const { t } = useTranslation('communication')
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const scrollerNode = useRef<HTMLDivElement | null>(null)
  const bottomTimersRef = useRef<number[]>([])
  const flushRafRef = useRef(0)
  /** True after the operator scrolls away from the latest row. */
  const readingHistoryRef = useRef(false)
  const atBottomRef = useRef(true)
  /** Programmatic land may keep snapping until this instant, unless the user scrolls. */
  const settleUntilRef = useRef(0)
  const bubbleStacks = useMemo(() => stacksForRows(rows), [rows])
  const openMailIds = useMemo(
    () => (messageLayout === 'email' ? openMailRowIds(rows) : null),
    [rows, messageLayout],
  )
  const virtuosoData = useMemo<VirtuosoRow[]>(() => {
    const extra: VirtuosoRow[] = []
    if (liveTrace) extra.push({ kind: 'live', id: '__live__' })
    extra.push({ kind: 'end', id: '__end__' })
    return [...rows, ...extra]
  }, [rows, liveTrace])

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

  const snapScrollerToEnd = useCallback(() => {
    if (readingHistoryRef.current) return
    const el = scrollerNode.current
    const top = el ? Math.max(0, el.scrollHeight - el.clientHeight) : Number.MAX_SAFE_INTEGER
    virtuosoRef.current?.scrollTo({ top, behavior: 'auto' })
    if (el) el.scrollTop = top
  }, [])

  const scrollToAbsoluteBottom = useCallback(
    (behavior: 'auto' | 'smooth' = 'auto', settleMs = 0) => {
      readingHistoryRef.current = false
      atBottomRef.current = true
      stopSettling()
      const last = Math.max(0, virtuosoData.length - 1)
      virtuosoRef.current?.scrollToIndex({
        index: last,
        align: 'end',
        behavior,
      })
      snapScrollerToEnd()
      if (settleMs <= 0) return
      settleUntilRef.current = Date.now() + settleMs
      const loop = () => {
        if (readingHistoryRef.current || Date.now() > settleUntilRef.current) {
          flushRafRef.current = 0
          return
        }
        snapScrollerToEnd()
        flushRafRef.current = window.requestAnimationFrame(loop)
      }
      flushRafRef.current = window.requestAnimationFrame(loop)
      bottomTimersRef.current = [40, 120].map((ms) => window.setTimeout(snapScrollerToEnd, ms))
    },
    [snapScrollerToEnd, stopSettling, virtuosoData.length],
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

  useEffect(() => {
    const el = scrollerNode.current
    if (!el) return
    const releaseIfScrollingUp = (delta: number) => {
      if (delta >= -6) return
      readingHistoryRef.current = true
      atBottomRef.current = false
      stopSettling()
      onAtBottomChange?.(false)
    }
    const onWheel = (event: WheelEvent) => releaseIfScrollingUp(event.deltaY)
    let touchY = 0
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? 0
    }
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? touchY
      releaseIfScrollingUp(touchY - y)
      touchY = y
    }
    // Scrollbar drags and keyboard scrolling have no wheel/touch event: treat
    // an upward scroll shortly after a pointer or key press as reading.
    let gestureUntil = 0
    let lastTop = el.scrollTop
    const markGesture = () => {
      gestureUntil = Date.now() + 1000
    }
    const onScroll = () => {
      const top = el.scrollTop
      if (Date.now() < gestureUntil) releaseIfScrollingUp(top - lastTop)
      lastTop = top
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('pointerdown', markGesture, { passive: true })
    el.addEventListener('keydown', markGesture)
    el.addEventListener('scroll', onScroll, { passive: true })
    // Follow growth (a streamed answer, a reply replacing the live trace)
    // until the operator scrolls up. Virtuoso's first child is a fixed-height
    // viewport, so watch the item list itself.
    const onResize = () => {
      if (!readingHistoryRef.current) snapScrollerToEnd()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(el)
    const list = el.querySelector('[data-testid="virtuoso-item-list"]') ?? el.firstElementChild
    if (list) ro.observe(list)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('pointerdown', markGesture)
      el.removeEventListener('keydown', markGesture)
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [threadId, virtuosoData.length, snapScrollerToEnd, stopSettling, onAtBottomChange])

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (behavior: 'auto' | 'smooth' = 'auto') => {
        scrollToAbsoluteBottom(behavior, 0)
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
    [landing, scrollToAbsoluteBottom, stopSettling],
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
        <div className="absolute inset-0 flex min-h-0 flex-col overflow-y-auto overflow-x-hidden px-4 py-4">
          <div className={cn(CHAT_COLUMN_CLASS, 'flex min-h-0 flex-1 flex-col')}>
            <div className="flex flex-1 items-center justify-center">{emptyState}</div>
            {liveTrace ? <div className="mb-3 shrink-0">{liveTrace}</div> : null}
          </div>
        </div>
      </div>
    )
  }

  const renderRow = (row: TimelineRow) => {
    if (row.kind === 'day') {
      return (
        <div className="flex justify-center pb-3 pt-2">
          <span className="rounded-lg bg-bg-elevated/80 px-2.5 py-0.5 text-2xs font-medium text-text-muted backdrop-blur">
            {row.label}
          </span>
        </div>
      )
    }
    if (row.kind === 'events') {
      return (
        <div className="mb-3">
          <EventClusterTimelineItem
            events={row.events}
            time={row.time}
            memberNameFor={(userId) => (userId != null ? membersById[userId]?.name : undefined)}
            startedByName={contactName}
            agentName={agentName}
            agentId={agentId}
            agentAvatarKind={agentAvatarKind}
            agentAvatarIcon={agentAvatarIcon}
            agentAvatarColor={agentAvatarColor}
            agentAvatarImageUrl={agentAvatarImageUrl}
          />
        </div>
      )
    }
    if (row.kind === 'session') {
      return (
        <div className="mb-4">
          <AgentSessionCard
            session={row.session}
            threadId={String(threadId)}
            liveMessages={
              row.session.id === activeSessionId
                ? mergeSessionLiveMessages(sessionMessages, sessionStream)
                : undefined
            }
            streaming={row.session.id === activeSessionId && agentStreaming}
            liveTurn={row.session.id === activeSessionId ? sessionTurn : undefined}
            onChanged={onRefresh}
            onUseAsReply={onUseSessionAsReply}
            agentAvatarKind={agentAvatarKind}
            agentAvatarIcon={agentAvatarIcon}
            agentAvatarColor={agentAvatarColor}
            agentAvatarImageUrl={agentAvatarImageUrl}
          />
        </div>
      )
    }
    const message = row.data
    const focused = focusedMessageId != null && String(message.id) === focusedMessageId
    const unreadFlash = unreadHighlightIds.includes(String(message.id))
    const stack = bubbleStacks.get(row.id) ?? 'single'
    const tightBelow = stack === 'start' || stack === 'middle'
    return (
      <div
        data-message-id={String(message.id)}
        className={cn(
          tightBelow ? 'mb-0.5' : 'mb-4',
          focused && 'rounded-[20px] ring-2 ring-accent/50 ring-offset-4 ring-offset-bg-canvas',
          unreadFlash && 'unread-message-flash',
        )}
      >
        {message.kind === 'decision_request' ? (
          <DecisionRequestMessage
            message={message}
            threadId={threadId}
            events={events}
            agentName={agentName}
            agentId={agentId}
            channelAccountId={channelAccountId}
            agentAvatarKind={agentAvatarKind}
            agentAvatarIcon={agentAvatarIcon}
            agentAvatarColor={agentAvatarColor}
            agentAvatarImageUrl={agentAvatarImageUrl}
            compactReplyProposal={compact.has(String(message.id))}
            activeInComposer={composerDecisionMessageId === String(message.id)}
            outdated={outdated.has(String(message.id))}
            onResolved={onDecisionResolved}
            onEditDraft={onEditDraft}
          />
        ) : (
          <MessageTimelineItem
            message={message}
            threadId={threadId}
            channel={channel}
            layout={messageLayout}
            contactName={contactName}
            contactEmail={contactEmail}
            contactPhone={contactPhone}
            agentName={agentName}
            agentId={agentId}
            agentAvatarKind={agentAvatarKind}
            agentAvatarIcon={agentAvatarIcon}
            agentAvatarColor={agentAvatarColor}
            agentAvatarImageUrl={agentAvatarImageUrl}
            membersById={membersById}
            noteActions={noteActions}
            stack={stack}
            onProposalResolved={onDecisionResolved}
            chatTags={chatTags}
            onMailAction={onMailAction}
            mailOwnAddresses={mailOwnAddresses}
            onRetrySend={onRetrySend}
            mailCollapsedByDefault={
              openMailIds != null &&
              !focused &&
              !unreadFlash &&
              isMailDocument(message) &&
              !openMailIds.has(row.id)
            }
          />
        )}
      </div>
    )
  }

  return (
    <ScrollerNodeContext.Provider value={scrollerNode}>
    <div className="relative h-full min-h-0">
      <Virtuoso
        key={String(threadId)}
        ref={virtuosoRef}
        data={virtuosoData}
        className="absolute inset-0 overflow-x-hidden"
        computeItemKey={(_index, row) => row.id}
        initialTopMostItemIndex={{
          index: landing.index,
          align: landing.align,
          offset: landing.align === 'start' ? TOP_FADE_CLEARANCE_PX : 0,
        }}
        defaultItemHeight={72}
        alignToBottom
        followOutput={() => (readingHistoryRef.current ? false : 'auto')}
        atBottomThreshold={72}
        atBottomStateChange={(atBottom) => {
          atBottomRef.current = atBottom
          if (atBottom) {
            readingHistoryRef.current = false
            onAtBottomChange?.(true)
            return
          }
          // Content growing past the threshold (a long answer arriving) also
          // reports "not at bottom". Only operator input means reading, and
          // that already flipped `readingHistoryRef` in the scroll listeners.
          if (readingHistoryRef.current) onAtBottomChange?.(false)
        }}
        // Email bodies render in iframes that measure asynchronously; a
        // generous viewport keeps them mounted so heights stay stable.
        increaseViewportBy={{ top: 1200, bottom: 1200 }}
        startReached={() => {
          if (hasOlder && !loadingOlder && onLoadOlder) void onLoadOlder()
        }}
        components={{
          Scroller: TimelineScroller,
          Header: () =>
            hasOlder && onLoadOlder ? (
              <div className={cn(CHAT_COLUMN_CLASS, 'px-4 pb-3 pt-12')}>
                <div className="flex justify-center">
                  <button
                    type="button"
                    disabled={loadingOlder}
                    onClick={() => void onLoadOlder()}
                    className="rounded-md border border-border/50 bg-bg-elevated/70 px-3 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-60"
                  >
                    {loadingOlder ? t('threadChrome.loadingOlder') : t('threadChrome.loadOlder')}
                  </button>
                </div>
              </div>
            ) : (
              // Clears the top edge fade so the first bubble/header stays readable.
              <div className="pt-12" />
            ),
        }}
        itemContent={(_index, row) => {
          if (row.kind === 'live') {
            return (
              <div className="px-4">
                <div className={CHAT_COLUMN_CLASS}>
                  <div className="mb-3">{liveTrace}</div>
                </div>
              </div>
            )
          }
          if (row.kind === 'end') {
            // Room for the composer mode-tab fade so the last bubble can sit in it.
            return <div className="h-10" aria-hidden />
          }
          return (
            <div className="px-4">
              <div className={CHAT_COLUMN_CLASS}>{renderRow(row)}</div>
            </div>
          )
        }}
      />
      {/* Fade at the top so messages recede under the day pill. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 right-0 top-0 z-[5] h-10 bg-gradient-to-b from-bg via-bg/85 to-transparent"
      />
    </div>
    </ScrollerNodeContext.Provider>
  )
})

export default ThreadTimeline
