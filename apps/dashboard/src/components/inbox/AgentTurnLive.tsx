import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSmoothStreamText } from '../../hooks/useSmoothStreamText'
import {
  liveBlocks,
  shouldShowWaitingTurn,
  turnPreparesProposal,
  type LiveTurn,
} from '../../lib/agentActivity'
import { splitChatMessages } from '../../lib/chatMessages'
import type { BubbleStack } from '../../lib/chat-layout'
import { ListChecks } from 'lucide-react'
import { AiAvatar } from '../ui/AiAvatar'
import ActivityTrail, { ActivityIcon } from './ActivityTrail'
import { BubbleHeader, ChatBubbleShell, RoleChip } from './ChatBubble'
import ChatText from './ChatText'

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
}: {
  text: string
  writing: boolean
  stack: BubbleStack
  header: ReactNode
  avatar: ReactNode
}) {
  const { t } = useTranslation('communication')
  const lead = stack === 'single' || stack === 'start'
  // Same row geometry as ChatMessageBubble: avatar column + bubble at 85%.
  return (
    <div className="bubble-pop-enter flex items-start gap-2">
      <span className="flex w-7 shrink-0 justify-center">{lead ? avatar : null}</span>
      <ChatBubbleShell
        side="left"
        variant="agent"
        stack={stack}
        header={header}
        body={text ? <ChatText content={text} streaming={writing} /> : null}
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

/** One speech segment: blank lines open new bubbles while it streams. */
function LiveSpeech({
  text,
  writing,
  leads,
  closes,
  header,
  avatar,
}: {
  text: string
  writing: boolean
  /** First speech block of a turn that opens a new run: avatar + author line. */
  leads: boolean
  /** Last block of the turn: its last bubble takes the run-closing shape. */
  closes: boolean
  header: ReactNode
  avatar: ReactNode
}) {
  const smooth = useSmoothStreamText(text, writing)
  const bubbles = splitChatMessages(smooth, 0)
  if (bubbles.length === 0) {
    return writing ? (
      <LiveBubble
        text=""
        writing
        stack={stackFor(leads, closes)}
        header={header}
        avatar={avatar}
      />
    ) : null
  }
  return (
    <div className="space-y-0.5">
      {bubbles.map((bubble, index) => (
        <LiveBubble
          key={index}
          text={bubble}
          writing={writing && index === bubbles.length - 1}
          stack={stackFor(leads && index === 0, closes && index === bubbles.length - 1)}
          header={header}
          avatar={avatar}
        />
      ))}
    </div>
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
}: {
  turn: LiveTurn
  /** The working agent's avatar (28px); the generic AI mark when unknown. */
  avatar?: ReactNode
  /** Author line on the first bubble; falls back to the generic AI label. */
  agentName?: string | null
  /** The last saved row is this agent's bubble: no avatar, no author line. */
  continuesRun?: boolean
}) {
  const { t } = useTranslation('communication')
  const blocks = liveBlocks(turn)
  if (!turn.active && blocks.length === 0) return null
  const last = blocks[blocks.length - 1]
  const lastRunning =
    last?.type === 'activity' && last.items.some((i) => i.status === 'running')
  const preparing = turnPreparesProposal(turn)
  const waiting = shouldShowWaitingTurn(turn, {
    lastRunning,
    lastIsSpeech: last?.type === 'speech',
  })
  const firstSpeechIndex = blocks.findIndex((block) => block.type === 'speech')
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
          <div key={block.key} className="bubble-pop-enter flex items-start gap-2 py-0.5">
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
            writing={turn.active && index === blocks.length - 1}
            leads={lead && index === firstSpeechIndex}
            closes={index === blocks.length - 1}
            header={header}
            avatar={avatarNode}
          />
        ),
      )}
      {preparing ? (
        <div
          className="flex h-7 min-w-0 items-center gap-2 pl-9 text-xs text-text-muted"
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
