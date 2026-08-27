import type { TFunction } from 'i18next'
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

/** Workspace-knowledge tools; surfaced with the violet brain identity. */
const KNOWLEDGE_TOOLS = new Set(['search_index', 'list_docs', 'read_doc', 'write_doc'])

export function isKnowledgeTool(name?: string | null): boolean {
  return Boolean(name && KNOWLEDGE_TOOLS.has(name))
}

export function isKnowledgeStep(step: AgentStep | PersistedAgentStep): boolean {
  return isKnowledgeTool('name' in step ? step.name : undefined)
}

export function stepLabel(step: AgentStep, t: TFunction): string {
  if (step.stepType === 'tool_call') return t('agentSteps.toolCall', { ns: 'communication' })
  if (step.stepType === 'tool_result') return t('agentSteps.toolResult', { ns: 'communication' })
  if (step.stepType === 'think') return t('agentSteps.thinking', { ns: 'communication' })
  return step.stepType
}

export function stepHeadline(step: AgentStep, t: TFunction): string {
  if (isKnowledgeTool(step.name)) {
    if (step.name === 'write_doc') {
      return step.stepType === 'tool_result'
        ? t('agentSteps.updatedKnowledge', { ns: 'communication' })
        : t('agentSteps.updatingKnowledge', { ns: 'communication' })
    }
    return step.stepType === 'tool_result'
      ? t('agentSteps.consultedKnowledge', { ns: 'communication' })
      : t('agentSteps.consultingKnowledge', { ns: 'communication' })
  }
  if (step.stepType === 'tool_call') {
    return t('agentSteps.runningTool', {
      ns: 'communication',
      name: step.name || t('agentSteps.toolFallback', { ns: 'communication' }),
    })
  }
  if (step.stepType === 'tool_result') {
    return t('agentSteps.finishedTool', {
      ns: 'communication',
      name: step.name || t('agentSteps.toolFallback', { ns: 'communication' }),
    })
  }
  if (step.stepType === 'think') return t('agentSteps.thinkingActive', { ns: 'communication' })
  return step.name || stepLabel(step, t)
}

export function currentActivityHeadline(
  steps: AgentStep[],
  active: boolean,
  t: TFunction,
  opts?: { thinkingText?: string; streamText?: string },
): string {
  const thinking = (opts?.thinkingText ?? '').trim()
  const stream = (opts?.streamText ?? '').trim()
  if (active && thinking && !stream) return t('agentSteps.thinkingActive', { ns: 'communication' })
  if (active && stream) return t('agentSteps.writing', { ns: 'communication' })
  if (steps.length > 0) return stepHeadline(steps[steps.length - 1], t)
  return active
    ? t('agentSteps.thinkingActive', { ns: 'communication' })
    : t('agentSteps.thought', { ns: 'communication' })
}

/** Consecutive unique headlines so live status can stack like Cursor. */
export function activityStatusLines(
  steps: AgentStep[],
  active: boolean,
  t: TFunction,
  opts?: { thinkingText?: string; streamText?: string },
): string[] {
  const lines: string[] = []
  for (const step of steps) {
    const line = stepHeadline(step, t)
    if (line && lines[lines.length - 1] !== line) lines.push(line)
  }
  const current = currentActivityHeadline(steps, active, t, opts)
  if (current && lines[lines.length - 1] !== current) lines.push(current)
  if (lines.length === 0 && active) {
    lines.push(t('agentSteps.thinkingActive', { ns: 'communication' }))
  }
  return lines.slice(-5)
}

export function formatThinkingDuration(ms?: number | null): string | null {
  if (ms == null || ms <= 0) return null
  const seconds = ms / 1000
  if (seconds < 10) return `${seconds.toFixed(1).replace(/\.0$/, '')}s`
  return `${Math.round(seconds)}s`
}

/** Collapsed label above an agent reply: "Thought for 2.4s" or "Thought". */
export function reasoningDisclosureLabel(thinking: AgentThinking | null | undefined, t: TFunction): string {
  const duration = formatThinkingDuration(thinking?.ms)
  if (duration) return t('agentSteps.thoughtFor', { ns: 'communication', duration })
  if ((thinking?.text ?? '').trim()) return t('agentSteps.thought', { ns: 'communication' })
  return t('agentSteps.thought', { ns: 'communication' })
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
  t: TFunction,
  usage?: AgentUsage | null,
): { parts: string[]; tokenLabel: string | null; total: number; usedKnowledge: boolean } {
  const toolCalls = steps.filter((s) => s.stepType === 'tool_call')
  const usedKnowledge = toolCalls.some((s) => isKnowledgeTool(s.name))
  const thinks = steps.filter((s) => s.stepType === 'think')
  const parts: string[] = []

  if (toolCalls.length === 1) {
    parts.push(
      t('agentSteps.usedTool', {
        ns: 'communication',
        name: toolCalls[0].name || t('agentSteps.toolFallback', { ns: 'communication' }),
      }),
    )
  } else if (toolCalls.length > 1) {
    const names = [...new Set(toolCalls.map((s) => s.name).filter(Boolean))]
    if (names.length > 0 && names.length <= 3) {
      parts.push(
        t('agentSteps.toolCallsNamed', {
          ns: 'communication',
          count: toolCalls.length,
          names: names.join(', '),
        }),
      )
    } else {
      parts.push(t('agentSteps.toolCalls', { ns: 'communication', count: toolCalls.length }))
    }
  }

  if (thinks.length === 1) parts.push(t('agentSteps.thinkingStep', { ns: 'communication' }))
  else if (thinks.length > 1) {
    parts.push(t('agentSteps.thinkingSteps', { ns: 'communication', count: thinks.length }))
  }

  if (parts.length === 0 && steps.length > 0) {
    parts.push(t('agentSteps.steps', { ns: 'communication', count: steps.length }))
  }

  const total = totalTokens(usage)
  const tokenLabel =
    total > 0 ? t('agentSteps.tokens', { ns: 'communication', count: formatTokenCount(total) }) : null
  return { parts, tokenLabel, total, usedKnowledge }
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
