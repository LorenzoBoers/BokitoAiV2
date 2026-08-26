import { describe, expect, it } from 'vitest'
import { formatWorkLogSubject } from './work-log-labels'

const t = (key: string, opts?: { subject?: string }) => {
  const map: Record<string, string> = {
    'decisionCard.knownSubjects.dailyPlatformScan': 'Dagelijkse platformscan',
    'decisionCard.knownSubjects.poWakeBacklog': 'Lead: platformbacklog bekijken',
    'decisionCard.knownSubjects.leadHeartbeat': 'Lead-hartslag',
    'decisionCard.knownSubjects.assistPrefix': `Hulp: ${opts?.subject ?? ''}`,
  }
  return map[key] ?? ''
}

describe('formatWorkLogSubject', () => {
  it('translates known run titles including leftover PO copy', () => {
    expect(formatWorkLogSubject('Daily platform scan', t as never, 'Run')).toBe('Dagelijkse platformscan')
    expect(formatWorkLogSubject('PO wake: review platform backlog', t as never, 'Run')).toBe(
      'Lead: platformbacklog bekijken',
    )
    expect(formatWorkLogSubject('PO heartbeat', t as never, 'Run')).toBe('Lead-hartslag')
  })

  it('returns the fallback when the subject is empty', () => {
    expect(formatWorkLogSubject('  ', t as never, 'Run')).toBe('Run')
  })
})
