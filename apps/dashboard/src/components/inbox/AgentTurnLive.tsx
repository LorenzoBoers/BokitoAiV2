import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSmoothStreamText } from '../../hooks/useSmoothStreamText'
import {
  liveAttachResults,
  liveBlocks,
  shouldShowWaitingTurn,
  turnPreparesProposal,
  type LiveTurn,
} from '../../lib/agentActivity'
import type { BubbleStack } from '../../lib/chat-layout'
import type { ProposalItem } from '../../lib/inbox-api'
import {
  inferMarketplaceItems,
  itemsFromAttachResult,
  mergeShowcaseItems,
} from '../../lib/marketplace-mentions'
import { ListChecks } from 'lucide-react'
import { AiAvatar } from '../ui/AiAvatar'
import ActivityTrail, { ActivityIcon } from './ActivityTrail'
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
}: {
  text: string
  writing: boolean
  stack: BubbleStack
  header: ReactNode
  avatar: ReactNode
  items?: ProposalItem[]
}) {
  const { t } = useTranslation('communication')
  const lead = stack === 'single' || stack === 'start'
  const wasWriting = useRef(writing)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (wasWriting.current && !writing && text) setConfirm(true)
    wasWriting.current = writing
  }, [text, writing])
  // Enter once, like a sent user bubble. Confirm is a ring only — no scale,
  // so the timeline height stays still when the reveal finishes.
  return (
    <div className="msg-bubble-enter-live flex items-start gap-2">
      <span className="flex w-7 shrink-0 justify-center">{lead ? avatar : null}</span>
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

/** One speech segment. Live stays a single bubble so the timeline does not jump. */
function LiveSpeech({
  text,
  holdReserve,
  leads,
  closes,
  header,
  avatar,
  attached,
  onRevealed,
}: {
  text: string
  /** Open tail of a live turn: keep a reserve so a network pause stays hidden. */
  holdReserve: boolean
  /** First speech block of a turn that opens a new run: avatar + author line. */
  leads: boolean
  /** Last block of the turn: its last bubble takes the run-closing shape. */
  closes: boolean
  header: ReactNode
  avatar: ReactNode
  attached?: ProposalItem[]
  onRevealed?: (done: boolean) => void
}) {
  // Follow the backend buffer at cruise. holdReserve keeps a short lead
  // while the model is still sending; after that the leftover drains.
  const smooth = useSmoothStreamText(text, true, holdReserve)
  const caughtUp = text.length === 0 || smooth.length >= text.length
  useEffect(() => {
    onRevealed?.(caughtUp)
  }, [caughtUp, onRevealed])
  const writing = smooth.length < text.length
  const items = mergeShowcaseItems(attached, writing ? [] : inferMarketplaceItems(smooth))
  if (!smooth && !items.length && !(writing || holdReserve)) return null
  return (
    <LiveBubble
      text={smooth}
      writing={writing || (!smooth && holdReserve)}
      stack={stackFor(leads, closes)}
      header={header}
      avatar={avatar}
      items={items}
    />
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
  continuesRun = false,
  onPlaybackDone,
}: {
  turn: LiveTurn
  /** The working agent's avatar (28px); the generic AI mark when unknown. */
  avatar?: ReactNode
  /** Author line on the first bubble; falls back to the generic AI label. */
  agentName?: string | null
  /** The last saved row is this agent's bubble: no avatar, no author line. */
  continuesRun?: boolean
  /** Saved bubbles may replace this overlay once the reveal has caught up. */
  onPlaybackDone?: (streamId: string) => void
}) {
  const { t } = useTranslation('communication')
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const markRevealed = useCallback((key: string, done: boolean) => {
    setRevealed((prev) => (prev[key] === done ? prev : { ...prev, [key]: done }))
  }, [])
  const blocks = liveBlocks(turn)
  const speechKeys = blocks.filter((block) => block.type === 'speech').map((block) => block.key)
  const playbackDone =
    !turn.active && (speechKeys.length === 0 || speechKeys.every((key) => revealed[key]))
  useEffect(() => {
    if (playbackDone && turn.streamId) onPlaybackDone?.(turn.streamId)
  }, [onPlaybackDone, playbackDone, turn.streamId])
  if (!turn.active && blocks.length === 0) return null
  const last = blocks[blocks.length - 1]
  const lastRunning =
    last?.type === 'activity' && last.items.some((i) => i.status === 'running')
  const preparing = turnPreparesProposal(turn)
  const firstSpeechIndex = blocks.findIndex((block) => block.type === 'speech')
  const waiting = shouldShowWaitingTurn(turn, {
    lastRunning,
    lastIsSpeech: last?.type === 'speech',
    hasSpeech: firstSpeechIndex >= 0,
  })
  const lastSpeechIndex = blocks.reduce(
    (found, block, index) => (block.type === 'speech' ? index : found),
    -1,
  )
  const attached = liveAttachResults(turn).flatMap(itemsFromAttachResult)
  const lead = !continuesRun
  const header = lead ? (
    <BubbleHeader name={agentName || t('timeline.aiAgent')} chip={<RoleChip kind="ai" />} />
  ) : null
  const avatarNode = avatar ?? (
    <AiAvatar name={agentName} kind="icon" icon="sparkles" size={28} decorative />
  )
  // The avatar normally rides on the first speech bubble. Until one exists
  // (thinking, tool calls), it marks the first activity row instead.
  const avatarOnActivity = lead && firstSpeechIndex < 0

  return (
    <div className="space-y-0.5">
      {blocks.map((block, index) =>
        block.type === 'activity' ? (
          <div key={block.key} className="flex items-start gap-2 py-0.5">
            <span className="flex w-7 shrink-0 justify-center">
              {avatarOnActivity && index === 0 ? avatarNode : null}
            </span>
            <div className="min-w-0 flex-1">
              <ActivityTrail items={block.items} live={turn.active} />
            </div>
          </div>
        ) : (
          <LiveSpeech
            key={block.key}
            text={block.text}
            holdReserve={turn.active && index === blocks.length - 1}
            leads={lead && index === firstSpeechIndex}
            closes={index === blocks.length - 1}
            header={header}
            avatar={avatarNode}
            attached={index === lastSpeechIndex ? attached : undefined}
            onRevealed={(done) => markRevealed(block.key, done)}
          />
        ),
      )}
      {preparing ? (
        <div
          className="proposal-preparing-enter flex h-7 min-w-0 items-center gap-2 pl-9 text-xs text-text-muted"
          role="status"
          aria-live="polite"
          data-testid="proposal-preparing"
        >
          <ListChecks size={14} className="text-ai-ink" aria-hidden />
          <span className="activity-live-label">
            <span className="thinking-shimmer-text">{t('proposal.preparing')}</span>
          </span>
        </div>
      ) : null}
      {waiting ? (
        <div className="flex h-7 min-w-0 items-center gap-2 text-sm" role="status" aria-live="polite">
          <span className="flex w-7 shrink-0 justify-center">
            {lead && blocks.length === 0 ? avatarNode : null}
          </span>
          <ActivityIcon kind="think" size={14} live />
          <span className="activity-live-label">
            <span className="thinking-shimmer-text font-medium">{t('activity.thinking')}</span>
          </span>
        </div>
      ) : null}
    </div>
  )
}
