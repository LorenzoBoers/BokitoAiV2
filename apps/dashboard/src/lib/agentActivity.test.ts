import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import {
  applyTurnEvent,
  EMPTY_TURN,
  eventTargetsSignal,
  formatDuration,
  groupActivity,
  groupProvider,
  groupSummary,
  isVisibleActivity,
  itemLabel,
  liveAttachResults,
  liveBlocks,
  liveProposalHold,
  liveTurnFromMessage,
  liveTurnOrbMotion,
  mergeTurns,
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
    expect(
      shouldShowWaitingTurn(
        { ...EMPTY_TURN, active: true },
        { lastRunning: false, lastIsSpeech: false, hasSpeech: true },
      ),
    ).toBe(false)
  })
})

describe('liveProposalHold', () => {
  it('is a no-op: server reveals cards after speech, so the client does not hide them', () => {
    const turn = {
      ...EMPTY_TURN,
      active: true,
      entries: [
        {
          type: 'activity' as const,
          item: normalizeActivity([
            {
              id: 'g1',
              kind: 'work',
              tool: 'set_thread_schedule',
              proposes: true,
              started_at: '2026-10-13T07:34:00.000Z',
              result: { decision_request_id: 'dec-1', status: 'awaiting_human' },
            },
          ])[0],
        },
        { type: 'speech' as const, segmentId: 's1', text: 'Akkoord?' },
      ],
    }
    const hold = liveProposalHold(turn)
    expect(hold.decisionIds.size).toBe(0)
    expect(hold.holdNewSince).toBeNull()
    expect(liveProposalHold(null).decisionIds.size).toBe(0)
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
  it('hides attach_items tool rows (showcase renders under the bubble)', () => {
    expect(
      isVisibleActivity(
        item('a1', 'other', 0, 1, { tool: 'attach_items', label: 'Attach items' }),
      ),
    ).toBe(false)
  })

  it('hides update_progress tool rows (the tool posts a bubble)', () => {
    expect(
      isVisibleActivity(
        item('p1', 'other', 0, 1, { tool: 'update_progress', label: 'Update progress' }),
      ),
    ).toBe(false)
  })

  it('hides post_internal_note tool rows (the note is the message)', () => {
    expect(
      isVisibleActivity(
        item('n1', 'other', 0, 1, { tool: 'post_internal_note', label: 'Post internal note' }),
      ),
    ).toBe(false)
  })

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
    // A single quick tool shows its label, not "1 action".
    expect(groupSummary(work, t)).toBe(itemLabel(work.items[0], t))
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

describe('eventTargetsSignal', () => {
  it('rejects a payload that names another conversation', () => {
    expect(eventTargetsSignal({ signal_id: 'b' }, 'a')).toBe(false)
    expect(eventTargetsSignal({ signal_id: 'a' }, 'a')).toBe(true)
    expect(eventTargetsSignal({}, 'a')).toBe(true)
    expect(eventTargetsSignal({ signal_id: 'a' }, null)).toBe(false)
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
    expect(turnSaved(live, [{ turnId: 'turn-1', inProgress: true }])).toBe(false)
    expect(turnSaved(live, [{ turnId: 'other' }])).toBe(false)
  })

  it('hydrates an in-progress checkpoint into a live turn', () => {
    const turn = liveTurnFromMessage({
      turnId: 'turn-live',
      inProgress: true,
      bodyText: 'Working on this.',
      activity: [
        { id: 't1', kind: 'think', label: '', tool: '', provider: '', startedAt: null, endedAt: null, durationMs: 2000, status: 'ok' },
        { id: 'w1', kind: 'work', label: 'create_canvas', tool: 'create_canvas', provider: '', startedAt: null, endedAt: null, durationMs: null, status: 'running' },
      ],
    })
    expect(turn?.active).toBe(true)
    expect(turn?.streamId).toBe('turn-live')
    expect(turn?.entries.some((e) => e.type === 'speech')).toBe(false)
    expect(turn?.entries[1]).toMatchObject({ type: 'activity', item: { id: 'w1', status: 'running' } })
    const merged = mergeTurns(turn!, applyTurnEvent(EMPTY_TURN, 'agent.activity', {
      stream_id: 'turn-live',
      item: { id: 'w1', kind: 'work', status: 'ok', label: 'create_canvas' },
    }))
    expect(merged.entries).toHaveLength(2)
    expect(merged.entries[1]).toMatchObject({ type: 'activity', item: { id: 'w1', status: 'ok' } })
  })

  it('drops checkpoint speech that duplicates a live speech segment', () => {
    const checkpoint = liveTurnFromMessage({
      turnId: 'turn-dup',
      inProgress: true,
      bodyText: 'In deze workspace zijn er 3 agents: klaar.',
    })
    expect(checkpoint?.entries.some((e) => e.type === 'speech')).toBe(true)
    let live = applyTurnEvent(EMPTY_TURN, 'agent.turn', { stream_id: 'turn-dup', phase: 'start' })
    live = applyTurnEvent(live, 'message.delta', {
      stream_id: 'turn-dup',
      segment_id: 'seg-1',
      delta: 'In deze workspace zijn er 3 agents: kla',
    })
    const merged = mergeTurns(checkpoint!, live)
    const speech = liveBlocks(merged).filter((b) => b.type === 'speech')
    expect(speech).toHaveLength(1)
    expect(speech[0].type === 'speech' && speech[0].text).toBe(
      'In deze workspace zijn er 3 agents: kla',
    )
  })

  it('keeps appending to the same segment after a think row', () => {
    let turn = applyTurnEvent(EMPTY_TURN, 'message.delta', {
      stream_id: 's1',
      segment_id: 'seg-1',
      delta: 'Er was eens',
    })
    turn = applyTurnEvent(turn, 'agent.activity', {
      stream_id: 's1',
      item: { id: 'think-2', kind: 'think', status: 'running' },
    })
    turn = applyTurnEvent(turn, 'message.delta', {
      stream_id: 's1',
      segment_id: 'seg-1',
      delta: ' een platform.',
    })
    const speech = liveBlocks(turn).filter((block) => block.type === 'speech')
    expect(speech).toHaveLength(1)
    expect(speech[0].type === 'speech' && speech[0].text).toBe('Er was eens een platform.')
  })

  it('does not open a new speech bubble for a writing presence echo', () => {
    let turn = applyTurnEvent(EMPTY_TURN, 'message.delta', {
      stream_id: 's1',
      segment_id: 'seg-1',
      delta: 'Hier zijn',
    })
    turn = applyTurnEvent(turn, 'thread.presence', {
      stream_id: 's1',
      phase: 'writing',
      delta: 'Hier zijn',
    })
    turn = applyTurnEvent(turn, 'message.delta', {
      stream_id: 's1',
      segment_id: 'seg-1',
      delta: ' een paar',
    })
    turn = applyTurnEvent(turn, 'thread.presence', {
      stream_id: 's1',
      phase: 'writing',
      delta: ' een paar',
    })
    const speech = liveBlocks(turn).filter((block) => block.type === 'speech')
    expect(speech).toHaveLength(1)
    expect(speech[0].type === 'speech' && speech[0].text).toBe('Hier zijn een paar')
  })

  it('maps thread.presence typing onto the live overlay', () => {
    const live = applyTurnEvent(EMPTY_TURN, 'thread.presence', {
      stream_id: 'p1',
      phase: 'typing',
      actor: { kind: 'contact', id: 'c1', name: 'Sam' },
    })
    expect(live.active).toBe(true)
    expect(live.entries[0]).toMatchObject({
      type: 'activity',
      item: { id: 'typing-c1', label: 'typing', status: 'running' },
    })
  })
})

describe('liveTurnOrbMotion', () => {
  it('returns idle when the turn is inactive', () => {
    expect(liveTurnOrbMotion(EMPTY_TURN)).toBe('idle')
    expect(liveTurnOrbMotion(null)).toBe('idle')
  })

  it('returns typing while speech streams', () => {
    const turn = applyTurnEvent(EMPTY_TURN, 'message.delta', {
      stream_id: 's1',
      delta: 'Hallo',
    })
    expect(liveTurnOrbMotion(turn)).toBe('typing')
  })

  it('returns thinking while waiting with no visible work (Nadenken)', () => {
    expect(liveTurnOrbMotion({ ...EMPTY_TURN, active: true })).toBe('thinking')
  })

  it('returns thinking with reasoning text and working while tools run', () => {
    const thinking = { ...EMPTY_TURN, active: true, thinking: { t1: 'hmm' } }
    expect(liveTurnOrbMotion(thinking)).toBe('thinking')
    const working = applyTurnEvent(EMPTY_TURN, 'agent.activity', {
      stream_id: 's2',
      item: {
        id: 'w1',
        kind: 'work',
        label: 'search',
        tool: 'search_index',
        status: 'running',
      },
    })
    expect(liveTurnOrbMotion(working)).toBe('working')
  })

  it('stays idle while a proposal is preparing', () => {
    const preparing = {
      ...EMPTY_TURN,
      active: true,
      entries: [
        {
          type: 'activity' as const,
          item: normalizeActivity([
            { id: 'p1', kind: 'work', tool: 'propose_action', proposes: true },
          ])[0],
        },
      ],
    }
    expect(liveTurnOrbMotion(preparing)).toBe('idle')
  })
})

describe('liveAttachResults', () => {
  it('collects attach_items snapshots from the live turn', () => {
    const turn = {
      ...EMPTY_TURN,
      entries: [
        {
          type: 'activity' as const,
          item: normalizeActivity([
            {
              id: 'a1',
              kind: 'work',
              tool: 'attach_items',
              result: { items: [{ type: 'marketplace', id: 'moneybird', title: 'Moneybird' }] },
            },
          ])[0],
        },
      ],
    }
    expect(liveAttachResults(turn)).toEqual([
      { items: [{ type: 'marketplace', id: 'moneybird', title: 'Moneybird' }] },
    ])
  })

  it('collects folder cards from list_folders without an attach_items call', () => {
    const turn = {
      ...EMPTY_TURN,
      entries: [
        {
          type: 'activity' as const,
          item: normalizeActivity([
            {
              id: 'lf',
              kind: 'work',
              tool: 'list_folders',
              result: {
                folders: [{ id: 'f1', name: '2025' }],
                items: [{ type: 'folder', id: 'f1', title: '2025', subtitle: '' }],
              },
            },
          ])[0],
        },
      ],
    }
    expect(liveAttachResults(turn)).toEqual([
      {
        folders: [{ id: 'f1', name: '2025' }],
        items: [{ type: 'folder', id: 'f1', title: '2025', subtitle: '' }],
      },
    ])
  })
})
