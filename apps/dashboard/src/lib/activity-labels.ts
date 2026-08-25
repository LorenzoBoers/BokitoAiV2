import type { TFunction } from 'i18next'
import { humanizeLabel } from './labels'

const KNOWN_TOOLS: Record<string, string> = {
  create_decision_request: 'activityPage.tools.createDecision',
  search_index: 'activityPage.tools.searchIndex',
}

function auditActionKey(action: string): string {
  return action.replace(/:/g, '_')
}

/** Translate cockpit/activity feed lines from backend telemetry. */
export function activityEventTypeLabel(eventType: string | null | undefined, t: TFunction): string {
  if (!eventType) return ''
  const auditKey = auditActionKey(eventType)
  const auditTranslated = t(`activityPage.auditActions.${auditKey}`, { defaultValue: '' })
  if (auditTranslated) return auditTranslated
  const key = `activityPage.eventTypes.${eventType}`
  const translated = t(key, { defaultValue: '' })
  if (translated) return translated
  return humanizeLabel(eventType)
}

export function activityEventMessage(message: string | null | undefined, t: TFunction): string {
  if (!message) return ''
  const trimmed = message.trim()
  if (/^loop \d+$/i.test(trimmed)) return t('agentSteps.thinkingActive', { ns: 'communication' })
  const toolKey = KNOWN_TOOLS[trimmed]
  if (toolKey) {
    const translated = t(toolKey)
    if (translated) return translated
  }
  const auditTranslated = t(`activityPage.auditActions.${auditActionKey(trimmed)}`, { defaultValue: '' })
  if (auditTranslated) return auditTranslated
  return humanizeLabel(trimmed)
}

/** Known decision card copy from backend mock / agent tools. */
export function translateDecisionText(text: string | null | undefined, t: TFunction): string {
  if (!text) return ''
  const trimmed = text.trim()
  const subjects: Record<string, string> = {
    'Reply to customer message': 'decisionCard.knownSubjects.replyToCustomer',
  }
  const summaries: Record<string, string> = {
    'Draft reply prepared for review.': 'decisionCard.knownSummaries.draftForReview',
  }
  const subjectKey = subjects[trimmed]
  if (subjectKey) return t(subjectKey, { ns: 'communication' })
  const summaryKey = summaries[trimmed]
  if (summaryKey) return t(summaryKey, { ns: 'communication' })
  return trimmed
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
