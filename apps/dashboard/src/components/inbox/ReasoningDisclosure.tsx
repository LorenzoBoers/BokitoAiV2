import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AgentStep } from '../../hooks/useSignalStream'
import {
  formatStepDetail,
  isKnowledgeStep,
  normalizePersistedSteps,
  reasoningDisclosureLabel,
  stepHeadline,
  stepLabel,
  summarizeAgentActivity,
  totalTokens,
  formatTokenCount,
  type AgentThinking,
  type AgentUsage,
  type PersistedAgentStep,
} from '../../lib/agentSteps'
import { KnowledgeMark } from '../knowledge/KnowledgeMark'
import { cn } from '../../lib/utils'

type Props = {
  thinking?: AgentThinking | null
  steps?: Array<AgentStep | PersistedAgentStep> | null
  usage?: AgentUsage | null
  className?: string
}

function toPersisted(steps: Array<AgentStep | PersistedAgentStep>): PersistedAgentStep[] {
  return steps.map((step) => {
    if ('stepType' in step && typeof step.stepType === 'string') {
      return {
        step_type: step.stepType,
        name: step.name,
        payload: step.payload,
      }
    }
    return step as PersistedAgentStep
  })
}

/**
 * Cursor/Claude-style disclosure ABOVE an agent reply:
 * "Nagedacht voor 2.4s · +3.5k tokens" — expands to reasoning + tool steps.
 */
export default function ReasoningDisclosure({ thinking, steps, usage, className }: Props) {
  const [expanded, setExpanded] = useState(false)
  const normalized = normalizePersistedSteps(Array.isArray(steps) ? toPersisted(steps) : [])
  const reasoning = (thinking?.text ?? '').trim()
  const { parts, tokenLabel, usedKnowledge } = summarizeAgentActivity(normalized, usage)
  const total = totalTokens(usage)
  const hasTokens = total > 0
  const hasContent = Boolean(reasoning || normalized.length > 0 || hasTokens)
  if (!hasContent) return null

  const label = reasoningDisclosureLabel(thinking)
  const fallbackSummary = !reasoning && parts.length > 0 ? parts.join(', ') : null
  const canExpand = Boolean(reasoning || normalized.length > 0)

  return (
    <div className={cn('min-w-0 max-w-[82%]', className)}>
      <button
        type="button"
        className={cn(
          'group flex w-full items-start gap-1 py-0.5 text-left text-[12px] leading-snug text-text-muted',
          canExpand ? 'hover:text-text-secondary' : 'cursor-default',
        )}
        onClick={() => canExpand && setExpanded((v) => !v)}
        disabled={!canExpand}
        aria-expanded={canExpand ? expanded : undefined}
      >
        {canExpand ? (
          expanded ? (
            <ChevronDown size={12} className="mt-0.5 shrink-0 opacity-70" />
          ) : (
            <ChevronRight size={12} className="mt-0.5 shrink-0 opacity-70" />
          )
        ) : (
          <span className="mt-0.5 w-3 shrink-0" />
        )}
        <span className="min-w-0">
          {usedKnowledge ? (
            <KnowledgeMark size={12} className="mr-1 inline-block align-[-2px]" />
          ) : null}
          <span>{fallbackSummary ? `${label} · ${fallbackSummary}` : label}</span>
          {hasTokens ? (
            <>
              <span className="text-text-muted/80"> · </span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                {tokenLabel ?? `+${formatTokenCount(total)} tokens`}
              </span>
            </>
          ) : null}
        </span>
      </button>

      {expanded && canExpand ? (
        <div className="mt-1 space-y-2 border-l border-border/60 pl-3 ml-1.5">
          {reasoning ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-text-secondary">
              {reasoning}
            </pre>
          ) : null}
          {normalized.length > 0 ? (
            <ul className="space-y-1.5">
              {normalized.map((step) => {
                const detail = formatStepDetail(step)
                return (
                  <li key={step.id} className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                      {stepLabel(step)}
                    </p>
                    <p className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                      {isKnowledgeStep(step) ? <KnowledgeMark size={12} /> : null}
                      {stepHeadline(step)}
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
    </div>
  )
}
