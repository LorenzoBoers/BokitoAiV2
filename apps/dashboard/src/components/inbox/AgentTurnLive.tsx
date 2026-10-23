import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSmoothStreamText } from '../../hooks/useSmoothStreamText'
import {
  imageGenerationFrames,
  liveAttachResults,
  liveBlocks,
  statusLabel,
  type LiveTurn,
} from '../../lib/agentActivity'
import type { BubbleStack } from '../../lib/chat-layout'
import type { ProposalItem } from '../../lib/inbox-api'
import { itemsFromAttachResult } from '../../lib/marketplace-mentions'
import type { BotOrbMotion } from '../../lib/bot-orb-motion'
import { cn } from '../../lib/utils'
import type { AgentAvatarProps } from '../../lib/agent-avatar'
import ActivityTrail from './ActivityTrail'
import { EntityAvatarLink } from './EntityAvatarLink'
import { LiveAgentAvatarSlot, useLiveAgentSeat } from './LiveAgentSeat'
import { CHAT_AVATAR_SIZE, THREAD_GUTTER } from './ThreadMeta'
import { BubbleHeader, ChatBubbleShell, RoleChip } from './ChatBubble'
import ChatText from './ChatText'
import { ProposalItemList } from './ProposalItemPreview'

/** Breath between two bubbles of one turn: the next opens after the last settles. */
const BUBBLE_GAP_MS = 280

function TypingDots({ label }: { label: string }) {
  return (
    <span className="typing-dots align-middle" role="status" aria-label={label}>
      <span />
      <span />
      <span />
    </span>
  )
}

/** Where a live bubble sits in the run it will be saved into. */
function stackFor(lead: boolean, closes: boolean): BubbleStack {
  if (lead && closes) return 'single'
  if (lead) return 'start'
  if (closes) return 'end'
  return 'middle'
}

/**
 * One streaming bubble, rendered through the same shell as a saved agent
 * message: same shape, padding, author line and footer height. The footer
 * carries the typing dots while writing and an invisible spacer afterwards,
 * so the feedback / copy row of the saved bubble lands without a shift.
 */
function LiveBubble({
  text,
  writing,
  stack,
  header,
  avatar,
  items,
  canvasItems,
  enterClass,
  hideGutter = false,
  accent,
  documentMode = false,
}: {
  text: string
  writing: boolean
  stack: BubbleStack
  header: ReactNode
  avatar: ReactNode
  items?: ProposalItem[]
  canvasItems?: ProposalItem[]
  /** First growing bubble fades in; later segments pop in as they open. */
  enterClass: string
  hideGutter?: boolean
  accent?: string | null
  /** Work conversation: prose on the page, not a messenger bubble. */
  documentMode?: boolean
}) {
  const { t } = useTranslation('communication')
  const lead = stack === 'single' || stack === 'start'
  const wasWriting = useRef(writing)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (wasWriting.current && !writing && text) setConfirm(true)
    wasWriting.current = writing
  }, [text, writing])
  // Confirm is a ring only — no scale, so the timeline height stays still
  // when the reveal finishes.
  if (documentMode) {
    return (
      <div className={cn(enterClass, 'w-full text-lg leading-relaxed text-text-primary')}>
        {lead && header ? <div className="mb-1">{header}</div> : null}
        {text || items?.length ? (
          <div>
            {text ? <ChatText content={text} streaming={writing} /> : null}
            {writing && !text ? <TypingDots label={t('activity.writing')} /> : null}
            {items?.length ? <ProposalItemList items={items} /> : null}
          </div>
        ) : writing ? (
          <TypingDots label={t('activity.writing')} />
        ) : null}
        {canvasItems?.length ? (
          <div className="mt-1.5 max-w-2xl">
            <ProposalItemList items={canvasItems} />
          </div>
        ) : null}
      </div>
    )
  }
  return (
    <div className={cn(enterClass, 'flex w-full items-start gap-2')}>
      {hideGutter ? null : <span className={THREAD_GUTTER}>{lead ? avatar : null}</span>}
      <div className="min-w-0 w-full">
        <ChatBubbleShell
          side="left"
          variant="agent"
          stack={stack}
          accent={accent}
          header={header}
          // Parent column is already max-w-[85%] of the row (same as a saved
          // bubble). Nested max-w-[85%] made the live cloud narrower, then the
          // saved remount reflowed and nudged the thread.
          fillWidth
          bubbleClassName={confirm ? 'bubble-confirm' : undefined}
          body={
            text || items?.length ? (
              <div>
                {text ? <ChatText content={text} streaming={writing} /> : null}
                {items?.length ? <ProposalItemList items={items} /> : null}
              </div>
            ) : null
          }
          actions={
            writing ? (
              <span className="flex h-5 items-center px-0.5">
                <TypingDots label={t('activity.writing')} />
              </span>
            ) : (
              <span className="block h-5 w-5" aria-hidden />
            )
          }
          // Reserve the time slot the saved bubble will show, so the footer
          // height does not grow on handoff.
          meta={
            stack === 'single' || stack === 'end' ? (
              <span className="invisible tabular-nums" aria-hidden>
                00:00
              </span>
            ) : null
          }
        />
        {canvasItems?.length ? (
          <div className="mt-1.5 max-w-2xl">
            <ProposalItemList items={canvasItems} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * One speech segment. Reveal uses the same blank-line split as persist, so
 * finished paragraphs become settled bubbles while the last one keeps typing —
 * no sudden re-partition when the turn is saved.
 */
function LiveSpeech({
  text,
  streamActive,
  holdReserve,
  leads,
  closes,
  header,
  avatar,
  attached,
  onRevealed,
  hideGutter = false,
  accent,
  documentMode = false,
}: {
  text: string
  /** False once the gateway closed the turn — drain faster and stop the cursor. */
  streamActive: boolean
  /** Open tail of a live turn: keep a reserve so a network pause stays hidden. */
  holdReserve: boolean
  /** First speech block of a turn that opens a new run: avatar + author line. */
  leads: boolean
  /** Last block of the turn: its last bubble takes the run-closing shape. */
  closes: boolean
  header: ReactNode
  avatar: ReactNode
  /** Parent already shows the live orb; skip this bubble's gutter. */
  hideGutter?: boolean
  attached?: ProposalItem[]
  onRevealed?: (done: boolean) => void
  accent?: string | null
  documentMode?: boolean
}) {
  // Follow the backend buffer at cruise. holdReserve keeps a short lead
  // while the model is still sending; after that the leftover drains.
  const smooth = useSmoothStreamText(text, streamActive, holdReserve)
  const caughtUp = text.length === 0 || smooth.length >= text.length
  useEffect(() => {
    onRevealed?.(caughtUp)
  }, [caughtUp, onRevealed])
  const writing = smooth.length < text.length
  const items = attached ?? []
  const canvasItems = items.filter((item) => item.type === 'canvas')
  const inlineItems = items.filter((item) => item.type !== 'canvas')
  // The API already split this segment. One segment is one bubble.
  const bubbles = smooth ? [smooth] : writing || holdReserve || items.length ? [''] : []
  if (!bubbles.length) return null
  return (
    <>
      {bubbles.map((part, index) => {
        const isLast = index === bubbles.length - 1
        const partWriting = isLast && (writing || (!smooth && holdReserve))
        return (
          <LiveBubble
            key={index}
            text={part}
            writing={partWriting}
            stack={stackFor(leads && index === 0, closes && isLast)}
            header={leads && index === 0 ? header : null}
            avatar={avatar}
            hideGutter={hideGutter}
            accent={accent}
            documentMode={documentMode}
            items={isLast ? inlineItems : undefined}
            canvasItems={isLast ? canvasItems : undefined}
            enterClass={index === 0 ? 'msg-bubble-enter-live' : 'bubble-pop-enter'}
          />
        )
      })}
    </>
  )
}

/**
 * The agent turn as it happens: activity groups between short chat bubbles.
 * While nothing visible runs (the model is deciding), a thinking line shows
 * so the turn never looks stalled.
 *
 * Layout mirrors `ChatMessageBubble` (avatar column, gaps, run shapes) so the
 * saved bubbles replace the live ones in place.
 */
export default function AgentTurnLive({
  turn,
  avatar,
  agentName,
  agentId,
  avatarMark,
  orbMotion,
  orbPulseId,
  orbBaseMotion,
  continuesRun = false,
  onPlaybackDone,
  onSpeechShown,
  documentMode = false,
}: {
  turn: LiveTurn
  /** The working agent's avatar (28px); the generic AI mark when unknown. */
  avatar?: ReactNode
  /** Author line on the first bubble; falls back to the generic AI label. */
  agentName?: string | null
  /** When set, avatar uses the thread live-seat (spawn + FLIP). */
  agentId?: string | null
  avatarMark?: AgentAvatarProps | null
  orbMotion?: BotOrbMotion | null
  orbPulseId?: string | null
  orbBaseMotion?: BotOrbMotion | null
  /** The last saved row is this agent's bubble: no avatar, no author line. */
  continuesRun?: boolean
  /** Saved bubbles may replace this overlay once the reveal has caught up. */
  onPlaybackDone?: (streamId: string) => void
  /** The reader has seen this turn's words, so the saved bubble must not replay them. */
  onSpeechShown?: (streamId: string) => void
  /** The agent's answer in an assistant chat or a session, as a document. */
  documentMode?: boolean
}) {
  const { t } = useTranslation('communication')
  const seat = useLiveAgentSeat()
  const seated = Boolean(agentId && avatarMark)
  const [statusReady, setStatusReady] = useState(!seated)
  const enteringNow = Boolean(seated && seat?.isEntering(String(agentId)))
  // Hide the line only while the orb is rising. Before the claim, `seated`
  // is already true and `entering` is still false; the first paint stays
  // quiet because statusReady starts false. Once the rise is over — or this
  // seat never rose — the line must show. Waiting until an entrance was
  // observed left the orb up with no text for the whole turn.
  useEffect(() => {
    setStatusReady(!seated || !enteringNow)
  }, [seated, enteringNow, turn.streamId])
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const markRevealed = useCallback((key: string, done: boolean) => {
    setRevealed((prev) => (prev[key] === done ? prev : { ...prev, [key]: done }))
  }, [])
  const allBlocks = liveBlocks(turn)
  const speechKeys = allBlocks.filter((block) => block.type === 'speech').map((block) => block.key)
  // One bubble at a time: a segment opens once the one before it finished
  // revealing plus a short pause, so two bubbles never pop in together.
  const [opened, setOpened] = useState<string[]>([])
  useEffect(() => {
    setOpened([])
  }, [turn.streamId])
  const nextKey = speechKeys.find((key) => !opened.includes(key)) ?? null
  const prevKey = nextKey ? speechKeys[speechKeys.indexOf(nextKey) - 1] ?? null : null
  const prevDone = prevKey == null || Boolean(revealed[prevKey])
  useEffect(() => {
    if (!nextKey || !prevDone) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prevKey == null || reduceMotion) {
      setOpened((prev) => (prev.includes(nextKey) ? prev : [...prev, nextKey]))
      return
    }
    const timer = window.setTimeout(
      () => setOpened((prev) => (prev.includes(nextKey) ? prev : [...prev, nextKey])),
      BUBBLE_GAP_MS,
    )
    return () => window.clearTimeout(timer)
  }, [nextKey, prevKey, prevDone])
  const firstClosed = allBlocks.findIndex((block) => block.type === 'speech' && !opened.includes(block.key))
  const blocks = firstClosed < 0 ? allBlocks : allBlocks.slice(0, firstClosed)
  const frames = turn.status
    ? turn.status.frames
    : blocks
        .filter((block) => block.type === 'activity')
        .flatMap((block) => imageGenerationFrames(block.items))
  const shownImages = frames.map((frame) => frame.src).filter((src): src is string => Boolean(src))
  const playbackDone =
    !turn.active && (speechKeys.length === 0 || speechKeys.every((key) => revealed[key]))
  useEffect(() => {
    if (playbackDone && turn.streamId) onPlaybackDone?.(turn.streamId)
  }, [onPlaybackDone, playbackDone, turn.streamId])
  const spokeForRef = useRef<string | null>(null)
  const spokeNow = allBlocks.some((block) => block.type === 'speech' && block.text.trim().length > 0)
  if (turn.streamId && onSpeechShown && spokeNow && spokeForRef.current !== turn.streamId) {
    spokeForRef.current = turn.streamId
    onSpeechShown(turn.streamId)
  }
  if (!turn.active && allBlocks.length === 0) return null
  const firstSpeechIndex = blocks.findIndex((block) => block.type === 'speech')
  const serverLine = statusLabel(turn.status, t)
  // The floor can show the orb before the server publishes a line (prepare
  // is still running). Keep the looking line so the seat is never mute.
  const liveLine = serverLine || (turn.active ? t('activity.looking') : '')
  const lastActivityIndex = blocks.reduce(
    (found, block, index) => (block.type === 'activity' ? index : found),
    -1,
  )
  // After gated tools, before speech/card reveal — avoid a blank gap.
  const lastSpeechIndex = allBlocks.reduce(
    (found, block, index) => (block.type === 'speech' ? index : found),
    -1,
  )
  const attached = liveAttachResults(turn)
    .flatMap(itemsFromAttachResult)
    .filter((item) => {
      const src = item.imageUrl || item.url || ''
      return !(item.type === 'image' && src && shownImages.includes(src))
    })
  const lead = !continuesRun
  const header = lead ? (
    <BubbleHeader name={agentName || t('timeline.aiAgent')} chip={<RoleChip kind="ai" />} />
  ) : null
  // One seat for the whole turn. Slot id must not follow activity/speech/
  // stream id — each change remounted the orb and restarted the rise.
  const seatSlotId = `live:${agentId ?? 'turn'}`
  // Nadenken / tools wait until the entrance finishes, then the face takes
  // the real mood (thinking, working, …).
  const entering = Boolean(agentId && seat?.isEntering(String(agentId)))

  const avatarNode =
    agentId && avatarMark ? (
      <LiveAgentAvatarSlot
        agentId={String(agentId)}
        slotId={seatSlotId}
        claim
        spawn
        size={CHAT_AVATAR_SIZE}
        decorative
        name={avatarMark.name ?? agentName}
        kind={avatarMark.kind}
        icon={avatarMark.icon}
        color={avatarMark.color}
        shape={avatarMark.shape}
        imageUrl={avatarMark.imageUrl}
        motion={entering ? 'idle' : orbMotion}
        pulseId={entering ? null : orbPulseId}
        baseMotion={orbBaseMotion}
      />
    ) : avatar ? (
      avatar
    ) : (
      <span
        className="inline-block"
        style={{ width: CHAT_AVATAR_SIZE, height: CHAT_AVATAR_SIZE }}
        aria-hidden
      />
    )
  const hasActivityBlock = blocks.some((block) => block.type === 'activity')
  const showBlocks =
    hasActivityBlock || Boolean(serverLine) || firstSpeechIndex >= 0
  // Status ("Kiest de volgende stap", "Nadenken") waits until the rise finishes.
  // The first paint is before the seat claims, so `entering` alone still flashes it.
  const openingLine =
    seated && statusReady && !entering && blocks.length === 0 && Boolean(liveLine)

  return (
    <div className="flex items-start gap-2">
      <span className={THREAD_GUTTER}>
        <EntityAvatarLink
          to={agentId ? `/agents/${agentId}` : null}
          label={t('timeline.openProfile', { name: agentName || t('timeline.aiAgent') })}
        >
          {avatarNode}
        </EntityAvatarLink>
      </span>
      {/* Same 85% cap as ChatBubbleShell on a saved row, relative to the
          full timeline width — not to the leftover after the gutter. */}
      <div className={cn('min-w-0 w-full space-y-1.5', documentMode ? 'flex-1' : 'max-w-[85%]')}>
        {openingLine ? (
          <ActivityTrail items={[]} live showLine holdLabel={liveLine} frames={frames} />
        ) : blocks.length === 0 ? (
          <div className="min-h-7" />
        ) : null}
        {showBlocks
          ? blocks.map((block, index) => {
              return block.type === 'activity' ? (
                statusReady && !entering ? (
                  <ActivityTrail
                    key={block.key}
                    items={block.items}
                    live
                    showLine={Boolean(serverLine) && index === blocks.length - 1}
                    holdLabel={index === blocks.length - 1 ? serverLine || null : null}
                    frames={index === lastActivityIndex ? frames : []}
                  />
                ) : null
              ) : (
                <LiveSpeech
                  key={block.key}
                  text={block.text}
                  streamActive={turn.active}
                  holdReserve={turn.active && index === allBlocks.length - 1}
                  leads={lead && index === firstSpeechIndex}
                  closes={index === allBlocks.length - 1}
                  header={header}
                  avatar={null}
                  hideGutter
                  accent={avatarMark?.color}
                  documentMode={documentMode}
                  attached={index === lastSpeechIndex ? attached : undefined}
                  onRevealed={(done) => markRevealed(block.key, done)}
                />
              )
            })
          : null}
      </div>
    </div>
  )
}
