import { describe, expect, it, beforeEach } from 'vitest'
import {
  __resetAgentLiveForTests,
  seedAgentPresence,
  applyAgentLive,
  agentPresenceOf,
  agentLiveOf,
  withAgentLive,
  snapshotFromSeed,
} from './useAgentPresence'

describe('agent live cache', () => {
  beforeEach(() => {
    __resetAgentLiveForTests()
  })

  it('treats working runtime and running activity as working', () => {
    expect(snapshotFromSeed({ id: 'a', status: 'working' }).status).toBe('working')
    expect(snapshotFromSeed({ id: 'a', current_activity_id: 'run-1' }).status).toBe('working')
  })

  it('does not let a lagging REST standby wipe a live working snapshot', () => {
    applyAgentLive('a', {
      status: 'working',
      summary: 'Replying',
      threadId: 'sig-1',
      activityId: null,
      lastActiveAt: 1,
      source: 'ws',
    })
    seedAgentPresence([{ id: 'a', status: 'standby' }])
    expect(agentPresenceOf('a')).toBe('working')
    expect(agentLiveOf('a')?.threadId).toBe('sig-1')
  })

  it('does not let a stale REST working row undo a newer live standby', () => {
    applyAgentLive('a', {
      status: 'standby',
      summary: null,
      threadId: null,
      activityId: null,
      lastActiveAt: 2_000,
      source: 'ws',
    })
    seedAgentPresence([
      { id: 'a', status: 'working', current_thread_id: 'sig-1', last_active_at: 1_000 },
    ])
    expect(agentPresenceOf('a')).toBe('standby')
    expect(agentLiveOf('a')?.threadId).toBeNull()
  })

  it('accepts a newer REST working row after standby', () => {
    applyAgentLive('a', {
      status: 'standby',
      summary: null,
      threadId: null,
      activityId: null,
      lastActiveAt: 1_000,
      source: 'ws',
    })
    seedAgentPresence([
      { id: 'a', status: 'working', current_thread_id: 'sig-2', last_active_at: 3_000 },
    ])
    expect(agentPresenceOf('a')).toBe('working')
    expect(agentLiveOf('a')?.threadId).toBe('sig-2')
  })

  it('merges REST working details onto an agent for click-through', () => {
    seedAgentPresence([
      {
        id: 'a',
        status: 'working',
        current_thread_id: 'sig-2',
        current_activity_summary: 'Quote follow-up',
      },
    ])
    const view = withAgentLive<{
      id: string
      status: string
      name: string
      current_thread_id?: string | null
      current_activity_summary?: string | null
    }>({ id: 'a', status: 'standby', name: 'Bokito' })
    expect(view.status).toBe('working')
    expect(view.current_thread_id).toBe('sig-2')
    expect(view.current_activity_summary).toBe('Quote follow-up')
  })
})
