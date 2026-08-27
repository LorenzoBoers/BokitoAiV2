import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentStep } from '../../hooks/useSignalStream'
import {
  activityStatusLines,
  formatStepDetail,
  isKnowledgeStep,
  stepHeadline,
} from '../../lib/agentSteps'
import { cn } from '../../lib/utils'
import { useSmoothStreamText } from '../../hooks/useSmoothStreamText'
import { AI_ICON_BOX_CLASS, AiMark } from '../ai/AiMark'
import { KnowledgeMark } from '../knowledge/KnowledgeMark'
import ChatMarkdown from './ChatMarkdown'

type Props = {
  steps: AgentStep[]
  active?: boolean
  streamText?: string
  thinkingText?: string
  /** When false, skip the speech bubble (parent already shows the persisted reply). */
  showSpeechBubble?: boolean
}

function StatusLine({
  text,
  current,
  onToggle,
  expanded,
  canExpand,
}: {
  text: string
  current: boolean
  onToggle?: () => void
  expanded?: boolean
  canExpand?: boolean
}) {
  const Tag = canExpand && current ? 'button' : 'div'
  return (
    <Tag
      type={canExpand && current ? 'button' : undefined}
      className={cn(
        'agent-live-line flex w-full min-w-0 items-center gap-2 text-left',
        current ? 'is-current' : 'is-past',
      )}
      onClick={canExpand && current ? onToggle : undefined}
      aria-expanded={canExpand && current ? expanded : undefined}
    >
      {current ? (
        <span aria-hidden className="agent-live-dot shrink-0" />
      ) : (
        <AiMark size={11} className="shrink-0 opacity-50" />
      )}
      <span
        className={cn(
          'min-w-0 truncate text-[13.5px] font-medium',
          current ? 'thinking-shimmer-text agent-live-ink' : 'text-ai-ink/55',
        )}
      >
        {text}
      </span>
    </Tag>
  )
}

/** Loose purple live lines — not a bubble. Used while an agent is working. */
export function AgentLiveStatus({
  steps,
  active = false,
  thinkingText = '',
  streamText = '',
}: Omit<Props, 'showSpeechBubble'>) {
  const { t } = useTranslation('communication')
  const [expanded, setExpanded] = useState(false)
  const lines = activityStatusLines(steps, active, t, { thinkingText, streamText })
  const trimmedThinking = thinkingText.trim()
  const canExpand = steps.length > 0 || Boolean(trimmedThinking)

  if (lines.length === 0 && !active) return null

  return (
    <div
      className={cn('agent-live-status min-w-0 max-w-[82%]', active && 'is-active')}
      role="status"
      aria-live="polite"
      aria-busy={active}
    >
      <div className="space-y-1">
        {lines.map((line, index) => {
          const current = active && index === lines.length - 1
          return (
            <StatusLine
              key={`${index}-${line}`}
              text={line}
              current={current}
              canExpand={canExpand && current}
              expanded={expanded}
              onToggle={() => setExpanded((v) => !v)}
            />
          )
        })}
      </div>
      {expanded ? (
        <div className="mt-1.5 space-y-1.5 pl-5 text-[12px] leading-relaxed text-text-muted">
          {trimmedThinking ? (
            <p className="whitespace-pre-wrap break-words line-clamp-6">{trimmedThinking}</p>
          ) : null}
          {steps.map((step) => {
            const detail = formatStepDetail(step)
            return (
              <p key={step.id} className="flex min-w-0 items-start gap-1.5">
                {isKnowledgeStep(step) ? <KnowledgeMark size={11} /> : null}
                <span className="min-w-0">
                  {stepHeadline(step, t)}
                  {detail ? <span className="block truncate text-[11px] opacity-70">{detail}</span> : null}
                </span>
              </p>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/** Real speech while tokens stream — a normal agent bubble, not a status card. */
export function AgentStreamBubble({ streamText, active = false }: { streamText: string; active?: boolean }) {
  const smooth = useSmoothStreamText(streamText, active)
  const trimmed = smooth.trim()
  if (!trimmed) return null
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={`mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border ${AI_ICON_BOX_CLASS}`}
      >
        <AiMark size={13} />
      </span>
      <div className="min-w-0 max-w-[82%] rounded-2xl rounded-tl-md border border-border/60 bg-bg-surface px-4 py-2.5 text-[13.5px] leading-relaxed text-text-primary">
        <ChatMarkdown content={trimmed} />
        {active ? <span aria-hidden className="stream-caret" /> : null}
      </div>
    </div>
  )
}

/**
 * Live agent turn: status lines (always, while active) plus a speech bubble
 * only when the agent has started writing.
 */
export default function ThinkingTrace({
  steps,
  active = false,
  streamText = '',
  thinkingText = '',
  showSpeechBubble = true,
}: Props) {
  if (!active && !streamText && steps.length === 0 && !thinkingText) return null
  return (
    <div className="space-y-3">
      {active || steps.length > 0 ? (
        <AgentLiveStatus
          steps={steps}
          active={active}
          thinkingText={thinkingText}
          streamText={streamText}
        />
      ) : null}
      {showSpeechBubble ? <AgentStreamBubble streamText={streamText} active={active} /> : null}
    </div>
  )
}
