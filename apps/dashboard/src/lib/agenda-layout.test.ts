import { describe, expect, it } from 'vitest'
import {
  attentionOf,
  dayKey,
  isAllDay,
  itemEnd,
  itemOwner,
  itemStart,
  layerOf,
  layersParam,
  layoutDay,
  matchesWho,
  parseLayers,
  viewRange,
} from './agenda-layout'
import type { TimeItem } from './time-items'

function item(partial: Partial<TimeItem>): TimeItem {
  return {
    id: partial.id ?? Math.random().toString(36),
    kind: 'wake',
    start: '2026-10-06T09:00:00',
    title: 'x',
    status: 'planned',
    agent_id: null,
    agent_name: null,
    ...partial,
  }
}

describe('layerOf', () => {
  it('sorts every kind onto one layer', () => {
    expect(layerOf(item({ kind: 'calendar' }))).toBe('calendar')
    expect(layerOf(item({ kind: 'follow_up' }))).toBe('reminders')
    expect(layerOf(item({ kind: 'wake', trigger_kind: 'event' }))).toBe('reminders')
    expect(layerOf(item({ kind: 'checkup' }))).toBe('checkups')
    expect(layerOf(item({ kind: 'wake', trigger_kind: 'heartbeat' }))).toBe('routines')
    expect(layerOf(item({ kind: 'wake', trigger_kind: 'once' }))).toBe('agents')
    expect(layerOf(item({ kind: 'session', run_type: 'email' }))).toBe('activity')
    expect(layerOf(item({ kind: 'activity' }))).toBe('activity')
  })
})

describe('layers param', () => {
  it('omits the param when every layer is on', () => {
    expect(layersParam(parseLayers(null))).toBeNull()
    expect(layersParam(parseLayers('calendar,checkups'))).toBe('calendar,checkups')
    expect([...parseLayers('calendar,nope')]).toEqual(['calendar'])
  })
})

describe('itemOwner', () => {
  it('prefers the conversation owner, then the agent, then the actor', () => {
    expect(
      itemOwner(item({ owner_kind: 'user', owner_id: 'u1', owner_name: 'Sam', agent_name: 'Bot' })),
    ).toEqual({ kind: 'user', id: 'u1', name: 'Sam' })
    expect(itemOwner(item({ agent_id: 'a1', agent_name: 'Scout' }))).toEqual({
      kind: 'agent',
      id: 'a1',
      name: 'Scout',
    })
    expect(
      itemOwner(item({ kind: 'activity', actor_kind: 'person', actor_id: 'u2', actor_name: 'Lea' })),
    ).toEqual({ kind: 'user', id: 'u2', name: 'Lea' })
    expect(itemOwner(item({ kind: 'calendar', agent_name: 'Bot' }))).toBeNull()
    expect(itemOwner(item({ agent_name: 'orchestrator', actor_name: 'orchestra' }))).toBeNull()
  })
})

describe('matchesWho', () => {
  const mine = item({ kind: 'checkup', owner_kind: 'user', owner_id: 'u1' })
  const agents = item({ kind: 'checkup', owner_kind: 'agent', owner_id: 'a1' })
  it('keeps what a person owns or did', () => {
    expect(matchesWho(mine, 'me', 'u1')).toBe(true)
    expect(matchesWho(agents, 'me', 'u1')).toBe(false)
    expect(matchesWho(agents, 'agent:a1', 'u1')).toBe(true)
    expect(matchesWho(item({ kind: 'calendar' }), 'me', 'u1')).toBe(true)
    expect(matchesWho(item({ kind: 'calendar' }), 'agent:a1', 'u1')).toBe(false)
  })
})

describe('layoutDay', () => {
  it('puts overlapping items side by side and keeps the rest full width', () => {
    const day = new Date(2026, 9, 6)
    const at = (h: number, m = 0) => new Date(2026, 9, 6, h, m).toISOString()
    const placed = layoutDay(
      [
        item({ id: 'a', start: at(9), end: at(10) }),
        item({ id: 'b', start: at(9, 30), end: at(10, 30) }),
        item({ id: 'c', start: at(14) }),
      ],
      day,
    )
    const byId = Object.fromEntries(placed.map((p) => [p.item.id, p]))
    expect(byId.a.cols).toBe(2)
    expect(byId.b.col).toBe(1)
    expect(byId.c.cols).toBe(1)
    expect(byId.a.top).toBe(9 * 60)
    expect(byId.c.height).toBe(30)
  })
})

describe('viewRange', () => {
  it('starts weeks on Monday and months on the Monday before the first', () => {
    const anchor = new Date(2026, 9, 8)
    expect(viewRange('week', anchor).from.getDay()).toBe(1)
    const month = viewRange('month', anchor)
    expect(month.days).toHaveLength(42)
    expect(month.from.getDay()).toBe(1)
  })

  it('keeps three weeks of past above the list land day', () => {
    const anchor = new Date(2026, 9, 6)
    const range = viewRange('list', anchor)
    expect(dayKey(range.from)).toBe('2026-09-15')
    expect(range.days).toHaveLength(70)
  })
})

describe('attentionOf', () => {
  it('lists each overdue check-up once', () => {
    const now = new Date(2026, 9, 6, 12).getTime()
    const due = { kind: 'checkup' as const, status: 'due', series_id: 's1' }
    const result = attentionOf([item(due), item(due), item({ kind: 'checkup', status: 'planned' })], now)
    expect(result.checkups).toHaveLength(1)
  })
})

describe('isAllDay', () => {
  it('treats flagged calendar events as all-day', () => {
    expect(isAllDay(item({ kind: 'calendar', all_day: true }))).toBe(true)
    expect(
      isAllDay(
        item({
          kind: 'calendar',
          start: '2026-10-06T09:00:00',
          end: '2026-10-06T10:00:00',
        }),
      ),
    ).toBe(false)
  })

  it('binds exclusive midnight all-day events to one local date', () => {
    const event = item({
      kind: 'calendar',
      all_day: true,
      start: '2026-10-06T00:00:00',
      end: '2026-10-07T00:00:00',
    })
    expect(dayKey(itemStart(event))).toBe('2026-10-06')
    expect(itemEnd(event).getTime()).toBe(itemStart(event).getTime() + 24 * 3_600_000)
  })
})
