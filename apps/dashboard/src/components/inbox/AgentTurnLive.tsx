import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSmoothStreamText } from '../../hooks/useSmoothStreamText'
import { liveBlocks, type LiveTurn } from '../../lib/agentActivity'
import { splitChatMessages } from '../../lib/chatMessages'
import { Sparkles } from 'lucide-react'
import { IconTile } from '../ui/icon-tile'
import ActivityTrail from './ActivityTrail'
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

function LiveBubble({ text, writing }: { text: string; writing: boolean }) {
  const { t } = useTranslation('communication')
  return (
    <div className="min-w-0 max-w-[82%] rounded-xl rounded-tl-md border border-border/60 bg-bg-surface px-4 py-2.5 text-base leading-relaxed text-text-primary">
      {text ? <ChatText content={text} streaming={writing} /> : null}
      {writing ? (
        <div className={text ? 'mt-1' : undefined}>
          <TypingDots label={t('activity.writing')} />
        </div>
      ) : null}
    </div>
  )
}

/** One speech segment: blank lines open new bubbles while it streams. */
function LiveSpeech({ text, writing }: { text: string; writing: boolean }) {
  const smooth = useSmoothStreamText(text, writing)
  const bubbles = splitChatMessages(smooth, 0)
  if (bubbles.length === 0) return writing ? <LiveBubble text="" writing /> : null
  return (
    <div className="space-y-1">
      {bubbles.map((bubble, index) => (
        <LiveBubble key={index} text={bubble} writing={writing && index === bubbles.length - 1} />
      ))}
    </div>
  )
}

/**
 * The agent turn as it happens: activity groups between short chat bubbles.
 * While nothing visible runs (the model is deciding), a thinking line shows
 * so the turn never looks stalled.
 */
export default function AgentTurnLive({
  turn,
  avatar,
}: {
  turn: LiveTurn
  /** The working agent's avatar (28px); the generic AI mark when unknown. */
  avatar?: ReactNode
}) {
  const { t } = useTranslation('communication')
  const blocks = liveBlocks(turn)
  if (!turn.active && blocks.length === 0) return null
  const last = blocks[blocks.length - 1]
  const lastRunning =
    last?.type === 'activity' && last.items.some((i) => i.status === 'running')
  const waiting = turn.active && !lastRunning && last?.type !== 'speech'

  return (
    <div className="flex items-start gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center">
        {avatar ?? <IconTile icon={Sparkles} tone="ai" size="md" className="h-7 w-7" />}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        {blocks.map((block, index) =>
          block.type === 'activity' ? (
            <ActivityTrail key={block.key} items={block.items} live={turn.active} />
          ) : (
            <LiveSpeech
              key={block.key}
              text={block.text}
              writing={turn.active && index === blocks.length - 1}
            />
          ),
        )}
        {waiting ? (
          <div className="flex h-7 min-w-0 items-center text-sm" role="status" aria-live="polite">
            <span className="activity-live-label">
              <span className="thinking-shimmer-text font-medium">{t('activity.thinking')}</span>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
