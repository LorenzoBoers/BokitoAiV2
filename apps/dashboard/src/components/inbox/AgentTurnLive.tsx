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
import { AiAvatar } from '../ui/AiAvatar'
import type { AgentAvatarProps } from '../../lib/agent-avatar'
import ActivityTrail from './ActivityTrail'
import { EntityAvatarLink } from './EntityAvatarLink'
import { LiveAgentAvatarSlot, useLiveAgentSeat } from './LiveAgentSeat'
import { THREAD_GUTTER } from './ThreadMeta'
import { BubbleHeader, ChatBubbleShell, RoleChip } from './ChatBubble'
import ChatText from './ChatText'
import { ProposalItemList } from './ProposalItemPreview'

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
/** Matches `.msg-bubble-enter` in index.css, plus a short beat after it lands. */
const USER_BUBBLE_ENTER_MS = 480
const AGENT_AFTER_USER_MS = USER_BUBBLE_ENTER_MS + 160

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
  enterClass,
  hideGutter = false,
}: {
  text: string
  writing: boolean
  stack: BubbleStack
  header: ReactNode
  avatar: ReactNode
  items?: ProposalItem[]
  /** First growing bubble fades in; later segments pop in as they open. */
  enterClass: string
  hideGutter?: boolean
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
  return (
    <div className={cn(enterClass, 'flex items-start gap-2')}>
      {hideGutter ? null : <span className={THREAD_GUTTER}>{lead ? avatar : null}</span>}
      <ChatBubbleShell
        side="left"
        variant="agent"
        stack={stack}
        header={header}
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
      />
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
}) {
  // Follow the backend buffer at cruise. holdReserve keeps a short lead
  // while the model is still sending; after that the leftover drains.
  const smooth = useSmoothStreamText(text, streamActive, holdReserve)
  const caughtUp = text.length === 0 || smooth.length >= text.length
  useEffect(() => {
    onRevealed?.(caughtUp)
  }, [caughtUp, onRevealed])
  // If the turn already ended but the reveal stall (tab throttle, reset),
  // force caught-up so the parent can hand off to saved bubbles.
  useEffect(() => {
    if (streamActive || caughtUp) return
    const timer = window.setTimeout(() => onRevealed?.(true), 1200)
    return () => window.clearTimeout(timer)
  }, [streamActive, caughtUp, onRevealed])
  const writing = smooth.length < text.length
  const items = attached ?? []
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
            items={isLast ? items : undefined}
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
  /** Fresh user bubble is still entering: wait until it lands before this seat rises. */
  waitForUserBubble = false,
  onPlaybackDone,
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
  /** Fresh user bubble is still entering: wait until it lands before this seat rises. */
  waitForUserBubble?: boolean
  /** Saved bubbles may replace this overlay once the reveal has caught up. */
  onPlaybackDone?: (streamId: string) => void
}) {
  const { t } = useTranslation('communication')
  const seat = useLiveAgentSeat()
  const [entranceReady, setEntranceReady] = useState(() => !waitForUserBubble)
  // Once the seat is on screen, a new stream id must not unmount it. That
  // dropped the orb mid-rise and the next mount played the spawn again.
  const riseStartedRef = useRef(!waitForUserBubble)
  const waitTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (riseStartedRef.current) return
    if (!waitForUserBubble || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (waitTimerRef.current != null) {
        window.clearTimeout(waitTimerRef.current)
        waitTimerRef.current = null
      }
      riseStartedRef.current = true
      setEntranceReady(true)
      return
    }
    if (waitTimerRef.current != null) return
    setEntranceReady(false)
    waitTimerRef.current = window.setTimeout(() => {
      waitTimerRef.current = null
      riseStartedRef.current = true
      setEntranceReady(true)
    }, AGENT_AFTER_USER_MS)
  }, [waitForUserBubble, turn.streamId])
  useEffect(
    () => () => {
      if (waitTimerRef.current != null) window.clearTimeout(waitTimerRef.current)
    },
    [],
  )
  const seated = Boolean(agentId && avatarMark)
  const [statusReady, setStatusReady] = useState(!seated)
  const sawEnterRef = useRef(false)
  const enteringNow = Boolean(seated && seat?.isEntering(String(agentId)))
  useEffect(() => {
    sawEnterRef.current = false
    if (!seated) {
      setStatusReady(true)
      return
    }
    setStatusReady(false)
  }, [seated, turn.streamId])
  useEffect(() => {
    if (!seated) return
    if (enteringNow) {
      sawEnterRef.current = true
      setStatusReady(false)
      return
    }
    if (sawEnterRef.current) setStatusReady(true)
  }, [seated, enteringNow])
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const markRevealed = useCallback((key: string, done: boolean) => {
    setRevealed((prev) => (prev[key] === done ? prev : { ...prev, [key]: done }))
  }, [])
  const blocks = liveBlocks(turn)
  const frames = turn.status
    ? turn.status.frames
    : blocks
        .filter((block) => block.type === 'activity')
        .flatMap((block) => imageGenerationFrames(block.items))
  const shownImages = frames.map((frame) => frame.src).filter((src): src is string => Boolean(src))
  const speechKeys = blocks.filter((block) => block.type === 'speech').map((block) => block.key)
  const playbackDone =
    !turn.active && (speechKeys.length === 0 || speechKeys.every((key) => revealed[key]))
  useEffect(() => {
    if (playbackDone && turn.streamId) onPlaybackDone?.(turn.streamId)
  }, [onPlaybackDone, playbackDone, turn.streamId])
  if (!turn.active && blocks.length === 0) return null
  // Keep the row in the footer while the user bubble lands. Unmounting and
  // mounting again changes the footer height and restarts the bubble motion.
  if (!entranceReady) {
    return (
      <div className="flex items-start gap-2" aria-hidden>
        <span className={THREAD_GUTTER}>
          <span className="inline-block size-7 shrink-0" />
        </span>
        <div className="min-h-7 min-w-0 flex-1" />
      </div>
    )
  }
  const firstSpeechIndex = blocks.findIndex((block) => block.type === 'speech')
  const serverLine = statusLabel(turn.status, t)
  const lastActivityIndex = blocks.reduce(
    (found, block, index) => (block.type === 'activity' ? index : found),
    -1,
  )
  // After gated tools, before speech/card reveal — avoid a blank gap.
  const lastSpeechIndex = blocks.reduce(
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
        size={28}
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
    ) : (
      (avatar ?? <AiAvatar name={agentName} kind={null} size={28} decorative mode="live" />)
    )
  const hasActivityBlock = blocks.some((block) => block.type === 'activity')
  const showBlocks =
    hasActivityBlock || Boolean(serverLine) || firstSpeechIndex >= 0
  // Status ("Kiest de volgende stap", "Nadenken") waits until the rise finishes.
  // The first paint is before the seat claims, so `entering` alone still flashes it.
  const openingLine = statusReady && !entering && blocks.length === 0 && Boolean(serverLine)

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
      <div className="min-w-0 flex-1 space-y-1.5">
        {openingLine ? (
          <ActivityTrail items={[]} live showLine holdLabel={serverLine} frames={frames} />
        ) : blocks.length === 0 ? (
          <div className="min-h-7" />
        ) : null}
        {showBlocks
          ? blocks.map((block, index) =>
              block.type === 'activity' ? (
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
                  holdReserve={turn.active && index === blocks.length - 1}
                  leads={lead && index === firstSpeechIndex}
                  closes={index === blocks.length - 1}
                  header={header}
                  avatar={null}
                  hideGutter
                  attached={index === lastSpeechIndex ? attached : undefined}
                  onRevealed={(done) => markRevealed(block.key, done)}
                />
              ),
            )
          : null}
      </div>
    </div>
  )
}
