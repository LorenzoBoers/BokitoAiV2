import { Loader2, Wrench } from 'lucide-react'
import type { AgentStep } from '../../hooks/useSignalStream'

function stepLabel(step: AgentStep): string {
  if (step.stepType === 'think') return step.name || 'Thinking'
  if (step.stepType === 'tool_call') return `Calling ${step.name || 'tool'}`
  if (step.stepType === 'tool_result') return `Result from ${step.name || 'tool'}`
  return step.name || step.stepType
}

export default function AgentSteps({ steps }: { steps: AgentStep[] }) {
  if (steps.length === 0) return null
  return (
    <div className="space-y-1 rounded-xl border border-border/50 bg-bg-surface/60 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Agent activity</p>
      <ul className="space-y-1">
        {steps.map((step) => (
          <li key={step.id} className="flex items-center gap-2 text-[12px] text-text-secondary">
            {step.stepType === 'tool_call' || step.stepType === 'think' ? (
              <Loader2 size={12} className="shrink-0 animate-spin text-accent" />
            ) : (
              <Wrench size={12} className="shrink-0 text-text-muted" />
            )}
            <span>{stepLabel(step)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
