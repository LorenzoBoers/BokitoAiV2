import { describe, expect, it } from 'vitest'
import {
  agendaOccurrenceHref,
  pickClosestThreadBySubject,
  triggerThreadPath,
  workLogRunsPath,
} from './agenda-thread'

describe('pickClosestThreadBySubject', () => {
  it('picks the same-titled thread nearest the occurrence time', () => {
    const picked = pickClosestThreadBySubject(
      [
        { id: 'old', emailSubject: 'Daily platform scan', lastMessageAt: '2026-06-18T14:57:00Z' },
        { id: 'near', emailSubject: 'Daily platform scan', lastMessageAt: '2026-08-24T14:56:00Z' },
        { id: 'other', emailSubject: 'Reply to customer message', lastMessageAt: '2026-08-24T14:56:00Z' },
      ],
      'Daily platform scan',
      '2026-08-24T14:56:00Z',
    )
    expect(picked?.id).toBe('near')
  })

  it('returns null when there is nothing to match', () => {
    expect(pickClosestThreadBySubject([], 'Daily platform scan', '2026-08-24T14:56:00Z')).toBeNull()
    expect(
      pickClosestThreadBySubject(
        [{ id: 'other', emailSubject: 'Daily platform scan', lastMessageAt: '2026-08-24T14:56:00Z' }],
        'Lead: platformbacklog bekijken',
        '2026-08-24T14:56:00Z',
      ),
    ).toBeNull()
  })

  it('matches check-in labels to heartbeat threads', () => {
    const picked = pickClosestThreadBySubject(
      [{ id: 'beat', emailSubject: 'Heartbeat', lastMessageAt: '2026-08-24T14:56:00Z' }],
      'Check-in',
      '2026-08-24T14:56:00Z',
    )
    expect(picked?.id).toBe('beat')
  })

  it('matches Dutch activity titles to English thread subjects', () => {
    const picked = pickClosestThreadBySubject(
      [
        { id: 'scan', emailSubject: 'Daily platform scan', lastMessageAt: '2026-08-24T14:56:00Z' },
        { id: 'lead', emailSubject: 'PO wake: review platform backlog', lastMessageAt: '2026-08-24T12:53:00Z' },
      ],
      'Lead: platformbacklog bekijken',
      '2026-08-24T12:53:00Z',
    )
    expect(picked?.id).toBe('lead')
  })

  it('keeps future agenda rows on Agenda instead of a past same-subject run', () => {
    const pastThread = {
      id: 'old-run',
      emailSubject: 'Daily platform scan',
      lastMessageAt: '2026-08-24T14:56:00Z',
    }
    expect(
      agendaOccurrenceHref(
        {
          name: 'Dagelijkse platformscan',
          at: '2026-08-30T14:57:00Z',
          trigger_id: 'trig-scan',
        },
        [pastThread],
        'agent-1',
        Date.parse('2026-08-26T10:00:00Z'),
      ),
    ).toBe('/agenda?trigger=trig-scan')
  })

  it('still opens the matching Agent-runs conversation for a past occurrence', () => {
    expect(
      agendaOccurrenceHref(
        {
          name: 'Daily platform scan',
          at: '2026-08-24T14:56:00Z',
        },
        [
          { id: 'near', emailSubject: 'Daily platform scan', lastMessageAt: '2026-08-24T14:56:00Z' },
        ],
        'agent-1',
        Date.parse('2026-08-26T10:00:00Z'),
      ),
    ).toBe('/communication/runs/all/t/near')
  })

  it('sends a check-in to the agent channel and other triggers to Agent runs', () => {
    expect(
      triggerThreadPath({
        kind: 'heartbeat',
        signal_id: 'chan-1',
        agent_id: 'agent-1',
        status: 'reported',
      }),
    ).toBe('/communication/agent/agent-1/t/chan-1')
    expect(
      triggerThreadPath({ kind: 'interval', signal_id: 'thread-1', status: 'completed' }),
    ).toBe('/communication/runs/results/t/thread-1')
    expect(triggerThreadPath({ kind: 'heartbeat', signal_id: null })).toBeNull()
  })

  it('prefers the trigger own thread over a subject match', () => {
    expect(
      agendaOccurrenceHref(
        {
          name: 'Check-in: Assistant',
          at: '2026-08-24T14:56:00Z',
          kind: 'heartbeat',
          signal_id: 'chan-1',
          agent_id: 'agent-1',
        },
        [{ id: 'near', emailSubject: 'Check-in: Assistant', lastMessageAt: '2026-08-24T14:56:00Z' }],
        'agent-1',
        Date.parse('2026-08-26T10:00:00Z'),
      ),
    ).toBe('/communication/agent/agent-1/t/chan-1')
  })

  it('opens the matching Agent-runs conversation for a completed work log', () => {
    expect(
      workLogRunsPath(
        { task_subject: 'Daily platform scan', started_at: '2026-08-24T14:56:00Z', status: 'completed' },
        [
          { id: 'near', emailSubject: 'Daily platform scan', lastMessageAt: '2026-08-24T14:56:00Z' },
          { id: 'old', emailSubject: 'Daily platform scan', lastMessageAt: '2026-06-18T14:57:00Z' },
        ],
        '/agents/a/runs/r',
      ),
    ).toBe('/communication/runs/results/t/near')
  })
})
