import { describe, expect, it } from 'vitest'
import {
  activityIconKind,
  clusterTimelineItems,
  formatActivityMoment,
  parseTimelineMs,
  timeItemHref,
  timelinePct,
  triggerThreadPath,
  type TimeItem,
} from './time-items'

function item(partial: Partial<TimeItem> & Pick<TimeItem, 'id' | 'start'>): TimeItem {
  return {
    kind: 'session',
    agent_id: 'a1',
    agent_name: 'Agent',
    title: 'Work',
    status: 'completed',
    ...partial,
  }
}

describe('timelinePct', () => {
  it('puts now at 50% of a symmetric window', () => {
    const from = Date.parse('2026-10-01T00:00:00Z')
    const to = Date.parse('2026-10-08T00:00:00Z')
    const now = Date.parse('2026-10-04T12:00:00Z')
    expect(timelinePct(now, from, to)).toBeCloseTo(50, 5)
  })

  it('clamps outside the window', () => {
    expect(timelinePct(0, 10, 20)).toBe(0)
    expect(timelinePct(30, 10, 20)).toBe(100)
  })
})

describe('timeItemHref', () => {
  const now = Date.parse('2026-08-26T10:00:00Z')

  it('opens a conversation for a chat session', () => {
    expect(
      timeItemHref(item({ id: 'session:1', start: '2026-10-04T10:00:00Z', run_id: 'r1', signal_id: 'sig-1' })),
    ).toBe('/communication/inbox/all/t/sig-1')
  })

  it('opens the run page when there is no thread', () => {
    expect(timeItemHref(item({ id: 'session:2', start: '2026-10-04T10:00:00Z', run_id: 'r2' }))).toBe(
      '/agents/a1/runs/r2',
    )
  })

  it('keeps a future wake on Agenda instead of a past same-subject run', () => {
    expect(
      timeItemHref(
        item({
          id: 'wake:1',
          kind: 'wake',
          title: 'Dagelijkse platformscan',
          status: 'planned',
          start: '2026-08-30T14:57:00Z',
          trigger_id: 'trig-scan',
        }),
        [{ id: 'old-run', emailSubject: 'Daily platform scan', lastMessageAt: '2026-08-24T14:56:00Z' }],
        now,
      ),
    ).toBe('/agenda?trigger=trig-scan')
  })

  it('opens the matching conversation for a past session', () => {
    expect(
      timeItemHref(
        item({ id: 'session:3', title: 'Daily platform scan', start: '2026-08-24T14:56:00Z' }),
        [{ id: 'near', emailSubject: 'Daily platform scan', lastMessageAt: '2026-08-24T14:56:00Z' }],
        now,
      ),
    ).toBe('/communication/inbox/all/t/near')
  })

  it('prefers the trigger own thread over a subject match', () => {
    expect(
      timeItemHref(
        item({
          id: 'session:4',
          title: 'Check-in: Assistant',
          start: '2026-08-24T14:56:00Z',
          trigger_kind: 'heartbeat',
          signal_id: 'chan-1',
        }),
        [{ id: 'near', emailSubject: 'Check-in: Assistant', lastMessageAt: '2026-08-24T14:56:00Z' }],
        now,
      ),
    ).toBe('/communication/inbox/all/t/chan-1')
  })

  it('opens the thread of a future wake', () => {
    expect(
      timeItemHref(
        item({ id: 'wake:2', kind: 'wake', start: '2026-08-30T14:57:00Z', trigger_id: 't', signal_id: 'rule-thread' }),
        [],
        now,
      ),
    ).toBe('/communication/inbox/all/t/rule-thread')
  })

  it('opens the conversation for a dated thread', () => {
    expect(
      timeItemHref(item({ id: 'task:s', kind: 'task', start: '2026-08-27T10:00:00Z', signal_id: 's' })),
    ).toBe('/communication/inbox/all/t/s')
  })
})

describe('triggerThreadPath', () => {
  it('opens every rule thread in All communication', () => {
    expect(triggerThreadPath({ signal_id: 'chan-1' })).toBe('/communication/inbox/all/t/chan-1')
    expect(triggerThreadPath({ signal_id: null })).toBeNull()
  })
})

describe('parseTimelineMs', () => {
  it('treats naive timestamps as UTC', () => {
    expect(parseTimelineMs('2026-10-04T12:00:00')).toBe(Date.parse('2026-10-04T12:00:00Z'))
  })
})

describe('formatActivityMoment', () => {
  it('shows the day once and clock times from–to', () => {
    const out = formatActivityMoment('2026-10-01T10:44:00+02:00', '2026-10-01T11:02:00+02:00', 'nl')
    expect(out.day.toLowerCase()).toMatch(/do\s+1\s+okt/)
    expect(out.time).toBe('10:44 – 11:02')
  })

  it('collapses ranges of two minutes or less to one clock time', () => {
    const out = formatActivityMoment('2026-10-01T10:44:00+02:00', '2026-10-01T10:44:40+02:00', 'nl')
    expect(out.time).toBe('10:44')
  })

  it('uses English weekday then day then month', () => {
    const out = formatActivityMoment('2026-10-07T09:00:00+02:00', null, 'en')
    expect(out.day).toMatch(/Wed 7 Oct/)
    expect(out.time).toBe('09:00')
  })
})

describe('activityIconKind', () => {
  it('maps chat and wake triggers', () => {
    expect(activityIconKind(item({ id: '1', start: '2026-10-01T10:00:00Z', run_type: 'chat' }))).toBe('chat')
    expect(activityIconKind(item({ id: '2', start: '2026-10-01T10:00:00Z', kind: 'wake' }))).toBe('wake')
    expect(activityIconKind(item({ id: '3', start: '2026-10-01T10:00:00Z', run_type: 'trigger_heartbeat' }))).toBe(
      'heartbeat',
    )
  })
})

describe('clusterTimelineItems', () => {
  it('keeps distant marks separate and merges close ones', () => {
    const from = Date.parse('2026-10-01T00:00:00Z')
    const to = Date.parse('2026-10-08T00:00:00Z')
    const clusters = clusterTimelineItems(
      [
        item({ id: 'a', start: '2026-10-02T10:00:00Z', title: 'A' }),
        item({ id: 'b', start: '2026-10-02T10:05:00Z', title: 'B' }),
        item({ id: 'c', start: '2026-10-06T10:00:00Z', title: 'C' }),
      ],
      from,
      to,
      2,
    )
    expect(clusters).toHaveLength(2)
    expect(clusters[0].items.map((row) => row.id)).toEqual(['a', 'b'])
    expect(clusters[1].items.map((row) => row.id)).toEqual(['c'])
  })
})
