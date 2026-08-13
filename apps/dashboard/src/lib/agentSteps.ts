import type { AgentStep } from '../hooks/useSignalStream'

export type AgentUsage = {
  input_tokens?: number
  output_tokens?: number
}

export type AgentThinking = {
  text?: string
  ms?: number
  budget?: number
}

export type PersistedAgentStep = {
  step_type?: string
  stepType?: string
  name?: string
  payload?: Record<string, unknown>
}

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

export function currentActivityHeadline(
  steps: AgentStep[],
  active: boolean,
  opts?: { thinkingText?: string; streamText?: string },
): string {
  const thinking = (opts?.thinkingText ?? '').trim()
  const stream = (opts?.streamText ?? '').trim()
  if (active && thinking && !stream) return 'Thinking...'
  if (active && stream) return 'Writing...'
  if (steps.length > 0) return stepHeadline(steps[steps.length - 1])
  return active ? 'Thinking...' : 'Thought'
}

export function formatThinkingDuration(ms?: number | null): string | null {
  if (ms == null || ms <= 0) return null
  const seconds = ms / 1000
  if (seconds < 10) return `${seconds.toFixed(1).replace(/\.0$/, '')}s`
  return `${Math.round(seconds)}s`
}

/** Collapsed label above an agent reply: "Thought for 2.4s" or "Thought". */
export function reasoningDisclosureLabel(thinking?: AgentThinking | null): string {
  const duration = formatThinkingDuration(thinking?.ms)
  if (duration) return `Thought for ${duration}`
  if ((thinking?.text ?? '').trim()) return 'Thought'
  return 'Thought'
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

export function normalizePersistedSteps(raw: PersistedAgentStep[] | undefined | null): AgentStep[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  return raw.map((step, index) => {
    const stepType = String(step.stepType ?? step.step_type ?? '')
    const name = String(step.name ?? '')
    return {
      id: `${stepType}-${name}-${index}`,
      stepType,
      name,
      payload: step.payload && typeof step.payload === 'object' ? step.payload : {},
    }
  })
}

export function totalTokens(usage?: AgentUsage | null): number {
  if (!usage) return 0
  return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
}

export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${Math.round(n / 1000)}k`
}

/** Cursor-style one-line activity summary parts (plain + token highlight). */
export function summarizeAgentActivity(
  steps: AgentStep[],
  usage?: AgentUsage | null,
): { parts: string[]; tokenLabel: string | null; total: number } {
  const toolCalls = steps.filter((s) => s.stepType === 'tool_call')
  const thinks = steps.filter((s) => s.stepType === 'think')
  const parts: string[] = []

  if (toolCalls.length === 1) {
    parts.push(`Used ${toolCalls[0].name || 'tool'}`)
  } else if (toolCalls.length > 1) {
    const names = [...new Set(toolCalls.map((s) => s.name).filter(Boolean))]
    if (names.length > 0 && names.length <= 3) {
      parts.push(`${toolCalls.length} tool calls (${names.join(', ')})`)
    } else {
      parts.push(`${toolCalls.length} tool calls`)
    }
  }

  if (thinks.length === 1) parts.push('1 thinking step')
  else if (thinks.length > 1) parts.push(`${thinks.length} thinking steps`)

  if (parts.length === 0 && steps.length > 0) {
    parts.push(`${steps.length} steps`)
  }

  const total = totalTokens(usage)
  const tokenLabel = total > 0 ? `+${formatTokenCount(total)} tokens` : null
  return { parts, tokenLabel, total }
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
