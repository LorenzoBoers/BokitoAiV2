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
  'decision_approve': 'activityPage.eventTypes.decisionApproved',
  'decision_approved': 'activityPage.eventTypes.decisionApproved',
  'decision.approve': 'activityPage.eventTypes.decisionApproved',
  'decision_defer': 'activityPage.eventTypes.decisionDeferred',
  'decision_deferred': 'activityPage.eventTypes.decisionDeferred',
  'decision.reject': 'activityPage.eventTypes.decisionRejected',
  'decision_reject': 'activityPage.eventTypes.decisionRejected',
  'decision_rejected': 'activityPage.eventTypes.decisionRejected',
  'thread.updated': 'activityPage.eventTypes.threadUpdated',
  'thread_updated': 'activityPage.eventTypes.threadUpdated',
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
  if (/^loop \d+$/i.test(trimmed)) return t('activity.thinking', { ns: 'communication' })
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
  'Suggested reply': 'decisionCard.titleSuggestedReply',
  'Reply to customer message': 'decisionCard.knownSubjects.replyToCustomer',
  'Daily platform scan': 'decisionCard.knownSubjects.dailyPlatformScan',
  'Agent passport update': 'decisionCard.knownSubjects.agentPassportUpdate',
  'PO wake: review platform backlog': 'decisionCard.knownSubjects.poWakeBacklog',
  'PO heartbeat': 'decisionCard.knownSubjects.leadHeartbeat',
  'Orchestrator heartbeat': 'decisionCard.knownSubjects.leadHeartbeat',
  Heartbeat: 'decisionCard.knownSubjects.heartbeat',
  'Try your first decision': 'decisionCard.knownSubjects.tryFirstDecision',
  'Does this demo make sense?': 'decisionCard.knownSubjects.demoMakesSense',
  'inbox routing rule': 'decisionCard.knownSubjects.inboxRoutingRule',
  'Inbox routing rule': 'decisionCard.knownSubjects.inboxRoutingRule',
  'New conversation': 'listItem.untitled',
  'Deep-link check: approve this?': 'decisionCard.knownSubjects.deepLinkCheck',
}

const KNOWN_SUMMARIES: Record<string, string> = {
  'Draft reply prepared for review.': 'decisionCard.knownSummaries.draftForReview',
  'Created by a dev script to verify the bell jumps to this card.':
    'decisionCard.knownSummaries.deepLinkCheck',
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
  const approvalMatch = trimmed.match(/^(?:Approval|Goedkeuring):\s*(.+)$/i)
  const body = assistMatch ? assistMatch[1].trim() : approvalMatch ? approvalMatch[1].trim() : trimmed
  const mapped = translateKnownSubject(body, t)
  if (assistMatch) {
    return t('decisionCard.knownSubjects.assistPrefix', {
      ns: 'communication',
      subject: mapped ?? body,
    })
  }
  if (approvalMatch) {
    return t('decisionCard.knownSubjects.approvalPrefix', {
      ns: 'communication',
      subject: mapped ?? body,
    })
  }
  return mapped ?? trimmed
}

const HANDOFF_TITLE = /^(?:Human takeover requested|Medewerker gevraagd):\s*(.+)$/i
const HANDOFF_BODY_EN =
  /^(.+) asked for a human\. AI replies are paused until someone takes over the thread\.?$/i
const HANDOFF_BODY_NL =
  /^(.+) vroeg om een medewerker\. AI-antwoorden staan gepauzeerd tot iemand dit gesprek overneemt\.?$/i

/** Stored notification copy is written in the workspace language; translate for the UI language. */
export function translateNotificationCopy(text: string | null | undefined, t: TFunction): string {
  if (!text) return ''
  const trimmed = text.trim()
  const title = trimmed.match(HANDOFF_TITLE)
  if (title) {
    return t('notificationsUi.handoffTitle', { ns: 'nav', topic: title[1].trim() })
  }
  const bodyEn = trimmed.match(HANDOFF_BODY_EN)
  const bodyNl = trimmed.match(HANDOFF_BODY_NL)
  if (bodyEn || bodyNl) {
    const who = (bodyEn?.[1] ?? bodyNl?.[1] ?? '').trim()
    return t('notificationsUi.handoffBody', { ns: 'nav', who })
  }
  return translateDecisionText(trimmed, t)
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

const OPERATOR_PROMPT_RE =
  /^(?:A teammate asked you to draft a reply to the customer in this thread\.\s*(?:Return only the reply body text \(no meta-commentary\)\.\s*)?(?:Teammate's request:\s*[^\n]*\n*)?|Draft a concise, professional reply to the latest customer message in this thread\.\s*(?:Return only the reply body text \(no meta-commentary\)\.\s*)?(?:Operator guidance:\s*[^\n]*\n*)?|A teammate invoked you on this conversation\.[^\n]*\n?)/i

/** Strip invoke/draft instructions that leaked into a stored suggestion. */
export function stripAiScaffolding(text: string): string {
  if (!text) return ''
  return text
    .replace(OPERATOR_PROMPT_RE, '')
    .replace(/^> Note for the reviewer:.*$/gim, '')
    .replace(/^\*\*(?:Internal note|Proposed reply|Interne notitie):\*\*\s*/gim, '')
    .trim()
}

const HEARTBEAT_WAKE_RE = /scheduled heartbeat wake/i

function heartbeatCheckInLabel(t: TFunction): string {
  return (
    t('decisionCard.knownSubjects.heartbeat', { ns: 'communication', defaultValue: '' }) ||
    t('mockAgent.heartbeatReply', {
      ns: 'communication',
      defaultValue: 'Scheduled check-in.',
    })
  )
}

/** True for mock/placeholder agent bodies (never treat as customer-delivered). */
export function isMockAgentBody(text: string | null | undefined): boolean {
  if (!text) return false
  const low = text.toLowerCase()
  return (
    low.startsWith('[mock]') ||
    low.startsWith('i received your message about:') ||
    low.startsWith('ik heb je bericht ontvangen over:') ||
    low.includes('placeholder reply while the workspace') ||
    low.includes('tijdelijk antwoord zolang de workspace') ||
    low.includes('without a live model') ||
    low.includes('zonder live model')
  )
}

/** Mock-mode agent replies from the API LLM stub. */
export function translateMockAgentBody(text: string | null | undefined, t: TFunction): string {
  if (!text) return ''
  // Stored mock drafts sometimes wrap the invoke prompt ("I received your
  // message about: A teammate asked you…"). Never show that scaffolding.
  if (/A teammate asked you to draft a reply/i.test(text)) {
    return (
      t('decisionCard.knownSummaries.draftForReview', { ns: 'communication', defaultValue: '' }) ||
      stripAiScaffolding(text) ||
      text
    )
  }
  if (HEARTBEAT_WAKE_RE.test(text)) {
    return heartbeatCheckInLabel(t)
  }
  const cleaned = stripAiScaffolding(text)
  const patterns = [
    /^\[mock\] I received your message about:\s*(.+?)\.+\s*This is the Bokito AI OS assistant running in mock mode\.\s*$/s,
    /^I received your message about:\s*(.+?)\.+\s*This is a placeholder reply while the workspace runs without a live model\.\s*$/s,
    /^Ik heb je bericht ontvangen over:\s*(.+?)\.+\s*Dit is een tijdelijk antwoord zolang de workspace zonder live model draait\.\s*$/s,
  ]
  for (const pattern of patterns) {
    const match = cleaned.match(pattern)
    if (match) {
      const topic = match[1].trim()
      if (HEARTBEAT_WAKE_RE.test(topic)) {
        return heartbeatCheckInLabel(t)
      }
      return t('mockAgent.replyBody', { ns: 'communication', topic })
    }
  }
  return cleaned || text
}
