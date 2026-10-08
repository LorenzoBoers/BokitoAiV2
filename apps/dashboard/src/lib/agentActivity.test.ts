import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import {
  applyTurnEvent,
  EMPTY_TURN,
  formatDuration,
  groupActivity,
  groupProvider,
  groupSummary,
  isVisibleActivity,
  itemLabel,
  liveBlocks,
  normalizeActivity,
  normalizeMessageActivity,
  shouldShowWaitingTurn,
  turnPreparesProposal,
  turnSaved,
  webSearchFavicon,
  webSearchHost,
  webSearchQuery,
  type ActivityItem,
} from './agentActivity'

describe('turnPreparesProposal', () => {
  it('is true while an active turn has a proposing tool call', () => {
    const turn = {
      ...EMPTY_TURN,
      active: true,
      entries: [
        {
          type: 'activity' as const,
          item: normalizeActivity([{ id: 'x', kind: 'work', tool: 'restore_trash_item', proposes: true }])[0],
        },
      ],
    }
    expect(turnPreparesProposal(turn)).toBe(true)
    expect(turnPreparesProposal({ ...turn, active: false })).toBe(false)
    expect(turnPreparesProposal({ ...turn, entries: [] })).toBe(false)
  })

  it('hides the waiting brain while a proposal is preparing', () => {
    const turn = {
      ...EMPTY_TURN,
      active: true,
      entries: [
        {
          type: 'activity' as const,
          item: normalizeActivity([{ id: 'x', kind: 'work', tool: 'propose_action', proposes: true }])[0],
        },
      ],
    }
    expect(shouldShowWaitingTurn(turn, { lastRunning: false, lastIsSpeech: false })).toBe(false)
    expect(
      shouldShowWaitingTurn(
        { ...EMPTY_TURN, active: true },
        { lastRunning: false, lastIsSpeech: false },
      ),
    ).toBe(true)
  })
})

const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify({ ...opts, ns: undefined })}` : key) as unknown as TFunction

function item(id: string, kind: ActivityItem['kind'], start: number, end: number | null, extra: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id,
    kind,
    label: extra.label ?? id,
    tool: extra.tool ?? '',
    provider: extra.provider ?? '',
    startedAt: new Date(start).toISOString(),
    endedAt: end == null ? null : new Date(end).toISOString(),
    durationMs: null,
    status: end == null ? 'running' : 'ok',
    ...extra,
  }
}

describe('isVisibleActivity', () => {
  it('hides finished think items without reasoning text', () => {
    expect(isVisibleActivity(item('t', 'think', 0, 500, { text: '' }))).toBe(false)
    expect(isVisibleActivity(item('t', 'think', 0, 500, { hasText: false }))).toBe(false)
    expect(isVisibleActivity(item('t', 'think', 0, 500, { hasText: true }))).toBe(true)
    expect(isVisibleActivity(item('t', 'think', 0, 500, { text: 'weighing options' }))).toBe(true)
    expect(isVisibleActivity(item('t', 'think', 0, null))).toBe(true)
    expect(isVisibleActivity(item('w', 'work', 0, 500))).toBe(true)
  })

  it('reads has_text from list payloads', () => {
    const [slim] = normalizeActivity([{ id: 't', kind: 'think', has_text: false }])
    expect(slim.hasText).toBe(false)
    expect(normalizeMessageActivity({ payload: { activity: [{ id: 't', kind: 'think', has_text: false }] } }).hasActivity).toBe(false)
  })
})

describe('groupActivity', () => {
  it('groups consecutive items of the same kind and measures wall time', () => {
    const groups = groupActivity([
      item('t1', 'think', 0, 3000),
      item('w1', 'work', 3000, 5000),
      item('w2', 'work', 5000, 9000),
      item('t2', 'think', 9000, 10_000),
    ])
    expect(groups.map((g) => [g.kind, g.items.length])).toEqual([
      ['think', 1],
      ['work', 2],
      ['think', 1],
    ])
    expect(groups[1].durationMs).toBe(6000)
    expect(groups.every((g) => !g.running)).toBe(true)
  })

  it('marks a group with a running item as running and counts until now', () => {
    const [group] = groupActivity([item('w1', 'work', 0, 1000), item('w2', 'work', 1000, null)], 4000)
    expect(group.running).toBe(true)
    expect(group.durationMs).toBe(4000)
  })

  it('falls back to saved durations for items without timestamps', () => {
    const [group] = groupActivity(
      normalizeActivity([
        { id: 'a', kind: 'work', duration_ms: 1200 },
        { id: 'b', kind: 'work', duration_ms: 800 },
      ]),
    )
    expect(group.durationMs).toBe(2000)
  })
})

describe('labels', () => {
  it('formats durations', () => {
    expect(formatDuration(400)).toBe('<1s')
    expect(formatDuration(12_400)).toBe('12s')
    expect(formatDuration(65_000)).toBe('1m 05s')
  })

  it('summarizes finished groups with duration and action count', () => {
    const [think, work] = groupActivity([
      item('t', 'think', 0, 3000),
      item('w1', 'work', 3000, 8000),
      item('w2', 'work', 8000, 15_000),
    ])
    expect(groupSummary(think, t)).toContain('activity.thoughtFor')
    expect(groupSummary(think, t)).toContain('"duration":"3s"')
    expect(groupSummary(work, t)).toContain('activity.workedFor')
    expect(groupSummary(work, t)).toContain('"count":2')
  })

  it('drops the duration when a group took under a second', () => {
    const [think, work] = groupActivity([item('t', 'think', 0, 300), item('w', 'work', 300, 700)])
    expect(groupSummary(think, t)).toBe('activity.thoughtBriefly:{}')
    expect(groupSummary(work, t)).toContain('activity.actionCount')
    expect(groupSummary(work, t)).toContain('"count":1')
  })

  it('keeps one provider only when every action used it', () => {
    const [same] = groupActivity([
      item('a', 'work', 0, 1, { provider: 'hubspot' }),
      item('b', 'work', 1, 2, { provider: 'hubspot' }),
    ])
    const [mixed] = groupActivity([
      item('a', 'work', 0, 1, { provider: 'hubspot' }),
      item('b', 'work', 1, 2, { provider: 'gmail' }),
    ])
    expect(groupProvider(same)).toBe('hubspot')
    expect(groupProvider(mixed)).toBe('')
  })
})

describe('applyTurnEvent', () => {
  it('builds activity and speech blocks in order and ends on agent.turn end', () => {
    let turn = applyTurnEvent(EMPTY_TURN, 'agent.turn', { stream_id: 's1', phase: 'start' })
    turn = applyTurnEvent(turn, 'agent.activity', {
      stream_id: 's1',
      item: { id: 'th', kind: 'think', status: 'running' },
    })
    turn = applyTurnEvent(turn, 'agent.thinking', { stream_id: 's1', item_id: 'th', delta: 'hmm' })
    turn = applyTurnEvent(turn, 'message.delta', { stream_id: 's1', segment_id: 'a', delta: 'Hi ' })
    turn = applyTurnEvent(turn, 'message.delta', { stream_id: 's1', segment_id: 'a', delta: 'there' })
    turn = applyTurnEvent(turn, 'agent.activity', {
      stream_id: 's1',
      item: { id: 'w', kind: 'work', status: 'running', tool: 'search_index' },
    })
    turn = applyTurnEvent(turn, 'agent.activity', {
      stream_id: 's1',
      item: { id: 'w', kind: 'work', status: 'ok' },
    })
    turn = applyTurnEvent(turn, 'message.delta', { stream_id: 's1', segment_id: 'b', delta: 'Done' })

    const blocks = liveBlocks(turn)
    expect(blocks.map((b) => b.type)).toEqual(['activity', 'speech', 'activity', 'speech'])
    expect(blocks[0].type === 'activity' && blocks[0].items[0].text).toBe('hmm')
    expect(blocks[1].type === 'speech' && blocks[1].text).toBe('Hi there')
    expect(blocks[2].type === 'activity' && blocks[2].items[0].status).toBe('ok')
    expect(blocks[2].type === 'activity' && blocks[2].items[0].tool).toBe('search_index')

    // A saved message mid-turn is not a turn event; only `end` stops it.
    expect(applyTurnEvent(turn, 'message', { stream_id: 's1' })).toBe(turn)
    const ended = applyTurnEvent(turn, 'agent.turn', { stream_id: 's1', phase: 'end' })
    expect(ended.active).toBe(false)
    expect(ended.ended).toBe(true)
  })

  it('starts fresh on a new stream and ignores a late end of an old one', () => {
    const first = applyTurnEvent(EMPTY_TURN, 'message.delta', { stream_id: 's1', delta: 'a' })
    const second = applyTurnEvent(first, 'message.delta', { stream_id: 's2', delta: 'b' })
    expect(second.streamId).toBe('s2')
    expect(second.entries).toHaveLength(1)
    expect(applyTurnEvent(second, 'agent.turn', { stream_id: 's1', phase: 'end' })).toBe(second)
  })
})

describe('web_search activity', () => {
  it('prefers host + favicon from results over the raw query', () => {
    const row = item('s', 'work', 0, 1000, {
      tool: 'web_search',
      label: 'Search: bokito ai',
      input: { query: 'bokito ai' },
      result: {
        results: [{ host: 'bokito.ai', favicon_url: 'https://icons.example/b.png' }],
      },
    })
    expect(webSearchQuery(row)).toBe('bokito ai')
    expect(webSearchHost(row)).toBe('bokito.ai')
    expect(webSearchFavicon(row)).toBe('https://icons.example/b.png')
    expect(itemLabel(row, t)).toBe('bokito.ai')
  })

  it('pulls a host from site: or a bare domain in the query while running', () => {
    const row = item('s', 'work', 0, null, {
      tool: 'web_search',
      status: 'running',
      input: { query: 'site:chargecars.nl laadpas prijs' },
    })
    expect(webSearchHost(row)).toBe('chargecars.nl')
    expect(webSearchFavicon(row)).toContain('chargecars.nl')
    expect(itemLabel(row, t)).toBe('chargecars.nl')
  })
})

describe('saved messages', () => {
  it('reads payload activity and the turn id', () => {
    const parsed = normalizeMessageActivity({
      has_activity: true,
      payload: {
        activity: [{ id: 'x', kind: 'work' }],
        activity_after: [{ id: 'y', kind: 'other', label: 'note' }],
        activity_detail: false,
        turn_id: 'turn-1',
      },
    })
    expect(parsed.activity).toHaveLength(1)
    expect(parsed.activityAfter[0].kind).toBe('other')
    expect(parsed.activityDetail).toBe(false)
    expect(parsed.turnId).toBe('turn-1')
    const live = applyTurnEvent(EMPTY_TURN, 'agent.turn', { stream_id: 'turn-1', phase: 'start' })
    expect(turnSaved(live, [{ turnId: 'turn-1' }])).toBe(true)
    expect(turnSaved(live, [{ turnId: 'other' }])).toBe(false)
  })
})
