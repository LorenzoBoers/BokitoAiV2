import type { TFunction } from 'i18next'
import { humanizeLabel } from './labels'

const KNOWN_TOOLS: Record<string, string> = {
  create_decision_request: 'activityPage.tools.createDecision',
  search_index: 'activityPage.tools.searchIndex',
}

const KNOWN_EVENT_TYPES: Record<string, string> = {
  'run started': 'activityPage.eventTypes.runStarted',
  'run_started': 'activityPage.eventTypes.runStarted',
  'run.started': 'activityPage.eventTypes.runStarted',
  'run completed': 'activityPage.eventTypes.runCompleted',
  'run_completed': 'activityPage.eventTypes.runCompleted',
  'run.completed': 'activityPage.eventTypes.runCompleted',
  'decision:execute:approve': 'activityPage.eventTypes.decisionApproved',
  'decision_execute_approve': 'activityPage.eventTypes.decisionApproved',
}

function knownEventTypeKey(raw: string): string | undefined {
  return KNOWN_EVENT_TYPES[raw.trim().toLowerCase()]
}

function auditActionKey(action: string): string {
  return action.replace(/:/g, '_')
}

/** Translate cockpit/activity feed lines from backend telemetry. */
export function activityEventTypeLabel(eventType: string | null | undefined, t: TFunction): string {
  if (!eventType) return ''
  const typeKey = knownEventTypeKey(eventType)
  if (typeKey) {
    const mapped = t(typeKey, { defaultValue: '' })
    if (mapped) return mapped
  }
  const knownEvent = KNOWN_MESSAGES[eventType.trim()]
  if (knownEvent) {
    const known = t(knownEvent, { ns: 'communication', defaultValue: '' })
    if (known) return known
  }
  const auditKey = auditActionKey(eventType)
  const auditTranslated = t(`activityPage.auditActions.${auditKey}`, { defaultValue: '' })
  if (auditTranslated) return auditTranslated
  const key = `activityPage.eventTypes.${eventType}`
  const translated = t(key, { defaultValue: '' })
  if (translated) return translated
  return humanizeLabel(eventType)
}

const KNOWN_MESSAGES: Record<string, string> = {
  'Agent passport update': 'decisionCard.knownSubjects.agentPassportUpdate',
  agent_passport_update: 'decisionCard.knownSubjects.agentPassportUpdate',
  'agent_passport.update': 'decisionCard.knownSubjects.agentPassportUpdate',
}

export function activityEventMessage(message: string | null | undefined, t: TFunction): string {
  if (!message) return ''
  const trimmed = message.trim()
  const executed = trimmed.match(/^Executed approved action\s+(\w+)/i)
  if (executed) {
    const actionKey = executed[1].toLowerCase()
    const action = t(`activityPage.approvedActions.${actionKey}`, { defaultValue: executed[1] })
    return t('activityPage.executedApprovedAction', { action })
  }
  const typeMapped = knownEventTypeKey(trimmed)
  if (typeMapped) {
    const mapped = t(typeMapped, { defaultValue: '' })
    if (mapped) return mapped
  }
  const decision = translateDecisionText(trimmed, t)
  if (decision && decision !== trimmed) return decision
  if (/^loop \d+$/i.test(trimmed)) return t('agentSteps.thinkingActive', { ns: 'communication' })
  const knownKey = KNOWN_MESSAGES[trimmed]
  if (knownKey) {
    const known = t(knownKey, { ns: 'communication', defaultValue: '' })
    if (known) return known
  }
  const toolKey = KNOWN_TOOLS[trimmed]
  if (toolKey) {
    const translated = t(toolKey)
    if (translated) return translated
  }
  const auditTranslated = t(`activityPage.auditActions.${auditActionKey(trimmed)}`, { defaultValue: '' })
  if (auditTranslated) return auditTranslated
  return humanizeLabel(trimmed)
}

const KNOWN_SUBJECTS: Record<string, string> = {
  'Reply to customer message': 'decisionCard.knownSubjects.replyToCustomer',
  'Daily platform scan': 'decisionCard.knownSubjects.dailyPlatformScan',
  'Agent passport update': 'decisionCard.knownSubjects.agentPassportUpdate',
  'PO wake: review platform backlog': 'decisionCard.knownSubjects.poWakeBacklog',
  'PO heartbeat': 'decisionCard.knownSubjects.leadHeartbeat',
  'Orchestrator heartbeat': 'decisionCard.knownSubjects.leadHeartbeat',
  Heartbeat: 'decisionCard.knownSubjects.heartbeat',
}

const KNOWN_SUMMARIES: Record<string, string> = {
  'Draft reply prepared for review.': 'decisionCard.knownSummaries.draftForReview',
}

function translateKnownSubject(trimmed: string, t: TFunction): string | null {
  const subjectKey = KNOWN_SUBJECTS[trimmed]
  if (subjectKey) return t(subjectKey, { ns: 'communication' })
  const summaryKey = KNOWN_SUMMARIES[trimmed]
  if (summaryKey) return t(summaryKey, { ns: 'communication' })
  return null
}

/** Known decision card copy from backend mock / agent tools. */
export function translateDecisionText(text: string | null | undefined, t: TFunction): string {
  if (!text) return ''
  const trimmed = text.trim()
  const assistMatch = trimmed.match(/^Assist:\s*(.+)$/i)
  const body = assistMatch ? assistMatch[1].trim() : trimmed
  const mapped = translateKnownSubject(body, t)
  if (assistMatch) {
    return t('decisionCard.knownSubjects.assistPrefix', {
      ns: 'communication',
      subject: mapped ?? body,
    })
  }
  return mapped ?? trimmed
}

const COCKPIT_NOISE_TYPES = new Set([
  'think',
  'thinking',
  'thought',
  'nadenken',
  'tool_call',
  'tool_result',
  'loop',
  'search',
  'search_index',
])

/** Collapse consecutive identical Cockpit rows (same thread + action + actor). */
export function collapseCockpitEvents<
  T extends {
    signal_id?: string | null
    event_type?: string | null
    message?: string | null
    actor_name?: string | null
  },
>(events: T[]): Array<T & { repeatCount: number }> {
  const out: Array<T & { repeatCount: number }> = []
  for (const event of events) {
    const last = out[out.length - 1]
    const key = [event.signal_id ?? '', event.event_type ?? '', event.message ?? '', event.actor_name ?? ''].join(
      '|',
    )
    const lastKey = last
      ? [last.signal_id ?? '', last.event_type ?? '', last.message ?? '', last.actor_name ?? ''].join('|')
      : ''
    if (last && key === lastKey) {
      last.repeatCount += 1
      continue
    }
    out.push({ ...event, repeatCount: 1 })
  }
  return out
}

/** Cockpit overview should show outcomes, not every thinking step. */
export function isCockpitHeadlineEvent(event: {
  event_type?: string | null
  message?: string | null
}): boolean {
  const type = (event.event_type ?? '').trim().toLowerCase()
  if (COCKPIT_NOISE_TYPES.has(type)) return false
  if (/nadenken|opzoeken/.test(type)) return false
  const message = (event.message ?? '').trim()
  if (!message && !type) return false
  if (/^loop \d+$/i.test(message)) return false
  if (/^(search_index|thinking|thought|think|tool_call|tool_result)$/i.test(message)) return false
  if (/aan het nadenken|kennis doorzoeken|aan het opzoeken/i.test(message)) return false
  return true
}

/** Mock-mode agent replies from the API LLM stub. */
export function translateMockAgentBody(text: string | null | undefined, t: TFunction): string {
  if (!text) return ''
  const match = text.match(
    /^\[mock\] I received your message about:\s*(.+?)\.+\s*This is the Bokito AI OS assistant running in mock mode\.\s*$/s,
  )
  if (match) {
    return t('mockAgent.replyBody', { ns: 'communication', topic: match[1].trim() })
  }
  return text
}
