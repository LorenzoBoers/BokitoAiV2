import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AgentStep } from '../../hooks/useSignalStream'
import {
  formatStepDetail,
  normalizePersistedSteps,
  stepHeadline,
  stepLabel,
  summarizeAgentActivity,
  type AgentUsage,
  type PersistedAgentStep,
} from '../../lib/agentSteps'
import { cn } from '../../lib/utils'

type Props = {
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

/** Cursor-style muted expandable line under an assistant reply. */
export default function AgentActivityLog({ steps, usage, className }: Props) {
  const [expanded, setExpanded] = useState(false)
  const normalized = normalizePersistedSteps(Array.isArray(steps) ? toPersisted(steps) : [])

  const { parts, tokenLabel } = summarizeAgentActivity(normalized, usage)
  if (parts.length === 0 && !tokenLabel) return null

  const summary = parts.join(', ')
  const canExpand = normalized.length > 0

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
          {summary ? <span>{summary}</span> : null}
          {summary && tokenLabel ? <span className="text-text-muted/80">, </span> : null}
          {tokenLabel ? (
            <span className="font-medium text-emerald-600 dark:text-emerald-400">{tokenLabel}</span>
          ) : null}
        </span>
      </button>

      {expanded && canExpand ? (
        <ul className="mt-1 space-y-1.5 border-l border-border/50 pl-3 ml-1.5">
          {normalized.map((step) => {
            const detail = formatStepDetail(step)
            return (
              <li key={step.id} className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                  {stepLabel(step)}
                </p>
                <p className="text-[12px] text-text-secondary">{stepHeadline(step)}</p>
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
  )
}
