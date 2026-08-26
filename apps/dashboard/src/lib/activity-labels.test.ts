import { describe, expect, it } from 'vitest'
import {
  activityEventMessage,
  activityEventTypeLabel,
  collapseCockpitEvents,
  isCockpitHeadlineEvent,
  translateDecisionText,
} from './activity-labels'

const t = (key: string, opts?: { subject?: string; action?: string; defaultValue?: string }) => {
  const map: Record<string, string> = {
    'decisionCard.knownSubjects.replyToCustomer': 'Antwoord op klantbericht',
    'decisionCard.knownSubjects.dailyPlatformScan': 'Dagelijkse platformscan',
    'decisionCard.knownSubjects.agentPassportUpdate': 'Agenttoegang bijgewerkt',
    'decisionCard.knownSubjects.poWakeBacklog': 'Lead: platformbacklog bekijken',
    'decisionCard.knownSubjects.leadHeartbeat': 'Lead-hartslag',
    'decisionCard.knownSubjects.heartbeat': 'Check-in',
    'decisionCard.knownSubjects.assistPrefix': `Hulp: ${opts?.subject ?? ''}`,
    'activityPage.executedApprovedAction': `Goedgekeurde actie uitgevoerd: ${opts?.action ?? ''}`,
    'activityPage.approvedActions.approve': 'goedkeuren',
    'activityPage.eventTypes.runStarted': 'Run gestart',
    'activityPage.eventTypes.runCompleted': 'Run afgerond',
    'activityPage.eventTypes.decisionApproved': 'Beslissing goedgekeurd',
  }
  return map[key] ?? opts?.defaultValue ?? ''
}

describe('activity labels', () => {
  it('translates known decision subjects', () => {
    expect(translateDecisionText('Reply to customer message', t)).toBe('Antwoord op klantbericht')
    expect(translateDecisionText('Daily platform scan', t)).toBe('Dagelijkse platformscan')
    expect(translateDecisionText('Heartbeat', t)).toBe('Check-in')
    expect(translateDecisionText('PO wake: review platform backlog', t)).toBe(
      'Lead: platformbacklog bekijken',
    )
  })

  it('strips the Assist prefix and translates the inner subject', () => {
    expect(translateDecisionText('Assist: Daily platform scan', t)).toBe('Hulp: Dagelijkse platformscan')
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
