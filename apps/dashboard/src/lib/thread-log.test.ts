import { describe, expect, it } from 'vitest'
import {
  applyThreadEvent,
  beginSync,
  compareEventIds,
  dropTurn,
  EMPTY_LOG,
  orderedTurns,
  type ThreadLogState,
} from './thread-log'

function speech(text: string, id = 'seg-1') {
  return { blocks: [{ type: 'speech', id, text }] }
}

function apply(state: ThreadLogState, event: string, data: Record<string, unknown>) {
  return applyThreadEvent(state, { event, data })
}

/** Steady state: a cursor and no sync in flight. */
function steady(cursor = '100-0'): ThreadLogState {
  return { ...EMPTY_LOG, cursor, maxSeen: cursor }
}

describe('compareEventIds', () => {
  it('orders by milliseconds, then sequence', () => {
    expect(compareEventIds('100-2', '100-10')).toBeLessThan(0)
    expect(compareEventIds('101-0', '100-9')).toBeGreaterThan(0)
    expect(compareEventIds('', '1-0')).toBeLessThan(0)
  })
})

describe('applyThreadEvent', () => {
  it('opens one turn per stream and draws it from the surface', () => {
    let { state } = apply(steady(), 'agent.turn', {
      event_id: '101-0',
      prev_id: '100-0',
      stream_id: 'a',
      phase: 'start',
      author: { id: 'agent-a', name: 'Ana' },
    })
    ;({ state } = apply(state, 'message.delta', {
      event_id: '102-0',
      prev_id: '101-0',
      stream_id: 'a',
      segment_id: 'seg-1',
      delta: 'Hoi',
      surface: speech('Hoi'),
    }))
    ;({ state } = apply(state, 'agent.turn', {
      event_id: '103-0',
      prev_id: '102-0',
      stream_id: 'b',
      phase: 'start',
      author: { id: 'agent-b', name: 'Bo' },
    }))
    const turns = orderedTurns(state)
    expect(turns.map((t) => t.streamId)).toEqual(['a', 'b'])
    expect(turns[0].author?.name).toBe('Ana')
    expect(turns[0].blocks?.[0]).toMatchObject({ type: 'speech', text: 'Hoi' })
    expect(state.cursor).toBe('103-0')
  })

  it('asks for a replay on a gap and does not apply the event', () => {
    const { state, effect } = apply(steady('100-0'), 'agent.turn', {
      event_id: '105-0',
      prev_id: '104-0',
      stream_id: 'a',
      phase: 'start',
    })
    expect(effect).toBe('resync')
    expect(state.syncing).toBe(true)
    expect(state.turns).toEqual({})
    expect(state.cursor).toBe('100-0')
  })

  it('skips events at or before the cursor', () => {
    const start = steady('100-0')
    const { state, effect } = apply(start, 'agent.turn', {
      event_id: '99-0',
      prev_id: '98-0',
      stream_id: 'a',
      phase: 'start',
    })
    expect(effect).toBe('none')
    expect(state).toBe(start)
  })

  it('never reopens a completed turn', () => {
    let { state } = apply(steady(), 'agent.turn', { event_id: '101-0', prev_id: '100-0', stream_id: 'a', phase: 'start' })
    ;({ state } = apply(state, 'agent.turn', {
      event_id: '102-0',
      prev_id: '101-0',
      stream_id: 'a',
      phase: 'end',
      stop_reason: 'end_turn',
      surface: speech('Klaar'),
    }))
    expect(state.turns.a.ended).toBe(true)
    expect(state.turns.a.active).toBe(false)
    ;({ state } = apply(state, 'message.delta', {
      event_id: '103-0',
      prev_id: '102-0',
      stream_id: 'a',
      delta: 'late',
    }))
    expect(state.turns.a.ended).toBe(true)
    expect(state.turns.a.lastEventId).toBe('102-0')
  })

  it('drops a turn that passed or was superseded', () => {
    for (const reason of ['passed', 'superseded', 'cancelled']) {
      let { state } = apply(steady(), 'agent.turn', { event_id: '101-0', prev_id: '100-0', stream_id: 'a', phase: 'start' })
      ;({ state } = apply(state, 'agent.turn', {
        event_id: '102-0',
        prev_id: '101-0',
        stream_id: 'a',
        phase: 'end',
        stop_reason: reason,
      }))
      expect(state.turns.a).toBeUndefined()
      expect(state.completed).toContain('a')
    }
  })

  it('replays out of order while syncing and moves the cursor on log.synced', () => {
    let state = beginSync(steady('100-0'))
    // A live event lands before the replay of the ones before it.
    ;({ state } = apply(state, 'message.delta', {
      event_id: '103-0',
      prev_id: '102-0',
      stream_id: 'a',
      surface: speech('Hoi daar'),
    }))
    ;({ state } = apply(state, 'agent.turn', { event_id: '101-0', prev_id: '100-0', stream_id: 'a', phase: 'start' }))
    ;({ state } = apply(state, 'message.delta', {
      event_id: '102-0',
      prev_id: '101-0',
      stream_id: 'a',
      surface: speech('Hoi'),
    }))
    // The older surfaces do not overwrite the newer one.
    expect(state.turns.a.blocks?.[0]).toMatchObject({ text: 'Hoi daar' })
    let effect
    ;({ state, effect } = apply(state, 'log.synced', { head: '102-0', complete: true }))
    expect(effect).toBe('none')
    expect(state.syncing).toBe(false)
    expect(state.cursor).toBe('103-0')
  })

  it('a snapshot drops turns the server no longer has open', () => {
    let { state } = apply(steady(), 'agent.turn', { event_id: '101-0', prev_id: '100-0', stream_id: 'gone', phase: 'start' })
    state = beginSync({ ...state, cursor: null })
    expect(state.snapshot).toBe(true)
    ;({ state } = apply(state, 'agent.turn', { event_id: '150-0', prev_id: '149-0', stream_id: 'open', phase: 'start' }))
    ;({ state } = apply(state, 'log.synced', { head: '160-0', complete: true }))
    expect(Object.keys(state.turns)).toEqual(['open'])
    expect(state.cursor).toBe('160-0')
  })

  it('asks for a refetch when the replay could not cover the gap', () => {
    const { effect } = apply(beginSync(steady()), 'log.synced', { head: '200-0', complete: false })
    expect(effect).toBe('refetch')
  })

  it('keeps the newest floor', () => {
    let { state } = apply(steady(), 'floor', {
      event_id: '101-0',
      prev_id: '100-0',
      active_turn: { kind: 'agent', ref_id: 'x' },
    })
    expect(state.floorSeen).toBe(true)
    expect(state.floor).toEqual({ kind: 'agent', ref_id: 'x' })
    state = beginSync(state)
    ;({ state } = apply(state, 'floor', { event_id: '100-5', prev_id: '100-4', active_turn: null }))
    expect(state.floor).toEqual({ kind: 'agent', ref_id: 'x' })
  })

  it('dropTurn removes a turn and keeps it closed', () => {
    let { state } = apply(steady(), 'agent.turn', { event_id: '101-0', prev_id: '100-0', stream_id: 'a', phase: 'start' })
    state = dropTurn(state, 'a')
    expect(state.turns.a).toBeUndefined()
    ;({ state } = apply(state, 'message.delta', { event_id: '102-0', prev_id: '101-0', stream_id: 'a', delta: 'x' }))
    expect(state.turns.a).toBeUndefined()
  })
})
