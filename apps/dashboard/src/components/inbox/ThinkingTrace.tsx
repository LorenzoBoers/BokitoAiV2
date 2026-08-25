import { useState } from 'react'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentStep } from '../../hooks/useSignalStream'
import {
  currentActivityHeadline,
  formatStepDetail,
  isKnowledgeStep,
  stepHeadline,
  stepLabel,
} from '../../lib/agentSteps'
import { cn } from '../../lib/utils'
import { useSmoothStreamText } from '../../hooks/useSmoothStreamText'
import { AiMark } from '../ai/AiMark'
import { KnowledgeMark } from '../knowledge/KnowledgeMark'
import ChatMarkdown from './ChatMarkdown'

type Props = {
  steps: AgentStep[]
  active?: boolean
  streamText?: string
  thinkingText?: string
}

function ShimmerHeadline({ text, active }: { text: string; active: boolean }) {
  if (!active) {
    return <span className="text-[13.5px] font-medium text-text-secondary">{text}</span>
  }
  return (
    <span className="thinking-shimmer-text text-[13.5px] font-medium">{text}</span>
  )
}

export default function ThinkingTrace({
  steps,
  active = false,
  streamText = '',
  thinkingText = '',
}: Props) {
  const { t } = useTranslation('communication')
  const [expanded, setExpanded] = useState(false)
  const smoothStream = useSmoothStreamText(streamText, active)

  if (steps.length === 0 && !active && !streamText && !thinkingText) return null

  const headline = currentActivityHeadline(steps, active, t, { thinkingText, streamText })
  const canExpand = steps.length > 0 || Boolean(thinkingText.trim())
  const trimmedStream = smoothStream.trim()
  const trimmedThinking = thinkingText.trim()
  const showLiveThinking = active && trimmedThinking && !trimmedStream

  return (
    <div
      className={cn(
        'relative min-w-0 max-w-[82%] overflow-hidden rounded-2xl rounded-tl-md border border-border/60 bg-bg-surface',
        active && 'ring-1 ring-ai/25',
      )}
    >
      {active ? (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
          <div className="thinking-wave-bar h-full w-[42%] rounded-full bg-ai/75" />
        </div>
      ) : null}

      <button
        type="button"
        className={cn(
          'flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left',
          !canExpand && 'cursor-default',
        )}
        onClick={() => canExpand && setExpanded((v) => !v)}
        disabled={!canExpand}
        aria-expanded={canExpand ? expanded : undefined}
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          {active ? (
            <Loader2 size={13} className="shrink-0 animate-spin text-ai-ink" />
          ) : (
            <AiMark size={13} />
          )}
          <ShimmerHeadline text={headline} active={active} />
        </span>
        {canExpand ? (
          expanded ? (
            <ChevronUp size={14} className="shrink-0 text-text-muted" />
          ) : (
            <ChevronDown size={14} className="shrink-0 text-text-muted" />
          )
        ) : null}
      </button>

      {expanded ? (
        <div className="space-y-2 border-t border-border/40 px-3.5 py-2.5">
          {trimmedThinking ? (
            <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-text-secondary">
              {trimmedThinking}
            </pre>
          ) : null}
          {steps.length > 0 ? (
            <ul className="space-y-1.5">
              {steps.map((step) => {
                const detail = formatStepDetail(step)
                return (
                  <li key={step.id} className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                      {stepLabel(step, t)}
                    </p>
                    <p className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                      {isKnowledgeStep(step) ? <KnowledgeMark size={12} /> : null}
                      {stepHeadline(step, t)}
                    </p>
                    {detail ? (
                      <pre className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg-elevated/70 px-2 py-1 text-[11px] text-text-muted">
                        {detail}
                      </pre>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      {showLiveThinking && !expanded ? (
        <div className="border-t border-border/40 px-3.5 py-2 text-[12px] leading-relaxed text-text-muted whitespace-pre-wrap break-words line-clamp-4">
          {trimmedThinking}
        </div>
      ) : null}

      {trimmedStream ? (
        <div className="border-t border-border/40 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-text-primary">
          <ChatMarkdown content={trimmedStream} />
          {active ? <span aria-hidden className="stream-caret" /> : null}
        </div>
      ) : null}
    </div>
  )
}
