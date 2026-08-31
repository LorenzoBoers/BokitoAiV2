import { describe, expect, it } from 'vitest'
import {
  activityEventMessage,
  activityEventTypeLabel,
  collapseCockpitEvents,
  isCockpitHeadlineEvent,
  stripAiScaffolding,
  translateDecisionText,
  translateMockAgentBody,
} from './activity-labels'
import type { TFunction } from 'i18next'

const tImpl = (key: string, opts?: { subject?: string; action?: string; topic?: string; defaultValue?: string }) => {
  const map: Record<string, string> = {
    'decisionCard.knownSubjects.replyToCustomer': 'Antwoord op klantbericht',
    'decisionCard.knownSubjects.dailyPlatformScan': 'Dagelijkse platformscan',
    'decisionCard.knownSubjects.agentPassportUpdate': 'Agenttoegang bijgewerkt',
    'decisionCard.knownSubjects.poWakeBacklog': 'Lead: platformbacklog bekijken',
    'decisionCard.knownSubjects.leadHeartbeat': 'Lead-hartslag',
    'decisionCard.knownSubjects.heartbeat': 'Check-in',
    'mockAgent.replyBody': `Tijdelijk antwoord over ${opts?.topic ?? ''}.`,
    'decisionCard.knownSubjects.tryFirstDecision': 'Probeer je eerste beslissing',
    'decisionCard.knownSubjects.demoMakesSense': 'Is deze demo duidelijk?',
    'decisionCard.knownSubjects.assistPrefix': `Hulp: ${opts?.subject ?? ''}`,
    'decisionCard.knownSubjects.approvalPrefix': `Goedkeuring: ${opts?.subject ?? ''}`,
    'decisionCard.knownSubjects.inboxRoutingRule': 'Inbox-doorstuurregel',
    'activityPage.executedApprovedAction': `Goedgekeurde actie uitgevoerd: ${opts?.action ?? ''}`,
    'activityPage.approvedActions.approve': 'goedkeuren',
    'activityPage.eventTypes.runStarted': 'Run gestart',
    'activityPage.eventTypes.runCompleted': 'Run afgerond',
    'activityPage.eventTypes.decisionApproved': 'Beslissing goedgekeurd',
    'activityPage.eventTypes.decisionDeferred': 'Beslissing uitgesteld',
    'decisionCard.knownSummaries.draftForReview': 'Conceptantwoord klaar voor review.',
  }
  return map[key] ?? opts?.defaultValue ?? ''
}
// The runtime shape is all these helpers use; the brand is irrelevant in tests.
const t = tImpl as unknown as TFunction

describe('activity labels', () => {
  it('translates known decision subjects', () => {
    expect(translateDecisionText('Reply to customer message', t)).toBe('Antwoord op klantbericht')
    expect(translateDecisionText('Daily platform scan', t)).toBe('Dagelijkse platformscan')
    expect(translateDecisionText('Heartbeat', t)).toBe('Check-in')
    expect(translateDecisionText('Try your first decision', t)).toBe('Probeer je eerste beslissing')
    expect(translateDecisionText('Does this demo make sense?', t)).toBe('Is deze demo duidelijk?')
    expect(translateDecisionText('PO wake: review platform backlog', t)).toBe(
      'Lead: platformbacklog bekijken',
    )
  })

  it('strips the Assist prefix and translates the inner subject', () => {
    expect(translateDecisionText('Assist: Daily platform scan', t)).toBe('Hulp: Dagelijkse platformscan')
  })

  it('translates approval subjects for inbox routing', () => {
    expect(translateDecisionText('Goedkeuring: inbox routing rule', t)).toBe(
      'Goedkeuring: Inbox-doorstuurregel',
    )
    expect(translateDecisionText('Approval: inbox routing rule', t)).toBe(
      'Goedkeuring: Inbox-doorstuurregel',
    )
  })

  it('strips leaked invoke-agent instructions from drafts', () => {
    expect(
      stripAiScaffolding(
        'A teammate asked you to draft a reply to the customer in this thread. Return only the reply body text (no meta-commentary). Hallo Sanne, het bedrag klopt.',
      ),
    ).toBe('Hallo Sanne, het bedrag klopt.')
    expect(
      translateMockAgentBody(
        'A teammate asked you to draft a reply to the customer in this thread. Return only the reply body text (no meta-commentary).',
        t,
      ),
    ).toBe('Conceptantwoord klaar voor review.')
    expect(
      translateMockAgentBody(
        'I received your message about: A teammate asked you to draft a reply to the customer in this thread. Return only the reply body text (no meta-commentary).\nTeammate\'s request: keep it short',
        t,
      ),
    ).toBe('Conceptantwoord klaar voor review.')
  })

  it('humanizes mock agent replies', () => {
    expect(
      translateMockAgentBody(
        '[mock] I received your message about: order 4821. This is the Bokito AI OS assistant running in mock mode.',
        t,
      ),
    ).toBe('Tijdelijk antwoord over order 4821.')
    expect(
      translateMockAgentBody(
        'I received your message about: afspraak morgen. This is a placeholder reply while the workspace runs without a live model.',
        t,
      ),
    ).toBe('Tijdelijk antwoord over afspraak morgen.')
  })

  it('translates leftover English activity copy', () => {
    expect(activityEventMessage('Agent passport update', t)).toBe('Agenttoegang bijgewerkt')
    expect(activityEventMessage('Executed approved action approve', t)).toBe(
      'Goedgekeurde actie uitgevoerd: goedkeuren',
    )
    expect(activityEventMessage('Run started', t)).toBe('Run gestart')
    expect(activityEventTypeLabel('run_started', t)).toBe('Run gestart')
    expect(activityEventTypeLabel('Run completed', t)).toBe('Run afgerond')
    expect(activityEventTypeLabel('Decision:execute:approve', t)).toBe('Beslissing goedgekeurd')
    expect(activityEventTypeLabel('decision_defer', t)).toBe('Beslissing uitgesteld')
  })

  it('hides thinking and search noise from the Cockpit headline list', () => {
    expect(isCockpitHeadlineEvent({ event_type: 'thinking', message: 'Loop 3' })).toBe(false)
    expect(isCockpitHeadlineEvent({ event_type: 'think', message: 'Aan het nadenken...' })).toBe(false)
    expect(isCockpitHeadlineEvent({ event_type: 'Nadenken', message: 'Aan het nadenken...' })).toBe(false)
    expect(isCockpitHeadlineEvent({ event_type: 'tool_call', message: 'search_index' })).toBe(false)
    expect(isCockpitHeadlineEvent({ event_type: 'search_index', message: 'search_index' })).toBe(false)
    expect(
      isCockpitHeadlineEvent({ event_type: 'agent_passport.update', message: 'Agent passport update' }),
    ).toBe(true)
    expect(isCockpitHeadlineEvent({ event_type: 'failed', message: 'Run failed' })).toBe(true)
  })

  it('collapses consecutive identical Cockpit events', () => {
    const collapsed = collapseCockpitEvents([
      { signal_id: 's1', event_type: 'thread.updated', message: 'Hello, quick test', actor_name: 'Bokito Admin' },
      { signal_id: 's1', event_type: 'thread.updated', message: 'Hello, quick test', actor_name: 'Bokito Admin' },
      { signal_id: 's2', event_type: 'settings.updated', message: 'Workspace settings updated', actor_name: 'Bokito Staff' },
    ])
    expect(collapsed).toHaveLength(2)
    expect(collapsed[0]?.repeatCount).toBe(2)
    expect(collapsed[1]?.repeatCount).toBe(1)
  })
})
