import type { AgentStep } from '../hooks/useSignalStream'

export function stepLabel(step: AgentStep): string {
  if (step.stepType === 'tool_call') return 'Tool call'
  if (step.stepType === 'tool_result') return 'Tool result'
  if (step.stepType === 'think') return 'Thinking'
  return step.stepType
}

export function stepHeadline(step: AgentStep): string {
  if (step.stepType === 'tool_call') return `Running ${step.name || 'tool'}`
  if (step.stepType === 'tool_result') return `Finished ${step.name || 'tool'}`
  if (step.stepType === 'think') return step.name || 'Thinking'
  return step.name || stepLabel(step)
}

export function currentActivityHeadline(steps: AgentStep[], active: boolean): string {
  if (steps.length > 0) return stepHeadline(steps[steps.length - 1])
  return active ? 'Thinking' : 'Thought process'
}

export function formatStepDetail(step: AgentStep): string | null {
  const payload = step.payload ?? {}
  if (step.stepType === 'tool_call' && payload.input != null) {
    return truncateJson(payload.input)
  }
  if (step.stepType === 'tool_result' && payload.result != null) {
    return truncateJson(payload.result)
  }
  if (step.name) return step.name
  return null
}

function truncateJson(value: unknown, max = 480): string {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    if (text.length <= max) return text
    return `${text.slice(0, max)}...`
  } catch {
    return String(value)
  }
}
