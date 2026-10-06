import { describe, expect, it } from 'vitest'
import {
  attentionOf,
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
})

describe('attentionOf', () => {
  it('lists each overdue check-up once', () => {
    const now = new Date(2026, 9, 6, 12).getTime()
    const due = { kind: 'checkup' as const, status: 'due', series_id: 's1' }
    const result = attentionOf([item(due), item(due), item({ kind: 'checkup', status: 'planned' })], now)
    expect(result.checkups).toHaveLength(1)
  })
})
