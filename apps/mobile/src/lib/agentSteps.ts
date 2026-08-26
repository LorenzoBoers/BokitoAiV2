import type { AgentStep } from '../hooks/useSignalStream'
import { translate, type Locale } from './copy'

const KNOWLEDGE_TOOLS = new Set(['search_index', 'list_docs', 'read_doc', 'write_doc'])

export function isKnowledgeTool(name?: string | null): boolean {
  return Boolean(name && KNOWLEDGE_TOOLS.has(name))
}

export function stepLabel(step: AgentStep, locale: Locale = 'en'): string {
  if (isKnowledgeTool(step.name)) {
    return step.stepType === 'tool_result'
      ? translate(locale, 'agent.knowledgeDone')
      : translate(locale, 'agent.knowledge')
  }
  if (step.stepType === 'tool_call') return translate(locale, 'agent.working')
  if (step.stepType === 'tool_result') return translate(locale, 'agent.done')
  if (step.stepType === 'think') return translate(locale, 'agent.thinking')
  return step.stepType.replace(/[_-]+/g, ' ')
}

export function stepHeadline(step: AgentStep, locale: Locale = 'en'): string {
  if (isKnowledgeTool(step.name)) {
    if (step.name === 'write_doc') {
      return step.stepType === 'tool_result'
        ? translate(locale, 'agent.updatedKnowledge')
        : translate(locale, 'agent.updatingKnowledge')
    }
    return step.stepType === 'tool_result'
      ? translate(locale, 'agent.consultedKnowledge')
      : translate(locale, 'agent.consultingKnowledge')
  }
  if (step.stepType === 'tool_call') {
    return step.name ? translate(locale, 'agent.using', { name: humanToolName(step.name) }) : translate(locale, 'agent.working')
  }
  if (step.stepType === 'tool_result') {
    return step.name
      ? translate(locale, 'agent.finished', { name: humanToolName(step.name) })
      : translate(locale, 'agent.done')
  }
  if (step.stepType === 'think') return step.name || translate(locale, 'agent.thinking')
  return step.name || stepLabel(step, locale)
}

export function currentActivityHeadline(steps: AgentStep[], active: boolean, locale: Locale = 'en'): string {
  if (steps.length > 0) return stepHeadline(steps[steps.length - 1], locale)
  return active ? translate(locale, 'agent.thinkingActive') : translate(locale, 'agent.whatDid')
}

export function formatStepDetail(step: AgentStep): string | null {
  if (isKnowledgeTool(step.name)) return null
  const payload = step.payload ?? {}
  if (step.stepType === 'tool_call' && payload.input != null) {
    return truncateJson(payload.input)
  }
  if (step.stepType === 'tool_result' && payload.result != null) {
    return truncateJson(payload.result)
  }
  return null
}

function humanToolName(name: string): string {
  return name.replace(/[_-]+/g, ' ').trim()
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
