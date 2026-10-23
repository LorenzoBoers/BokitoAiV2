import { beforeEach, describe, expect, it } from 'vitest'
import { applyLive, seedLive, getLive, __resetLiveStoreForTests } from '../lib/live-store'
import type { InboxMember } from '../lib/inbox-api'
import {
  __resetMemberPresenceForTests,
  ingestMemberPresence,
  setSelfPresenceContext,
  setSelfPresenceLive,
} from './useMembers'

const TABLE = 'member'
const SELF = '11111111-1111-1111-1111-111111111111'

function member(presence: InboxMember['presence'] = 'offline'): InboxMember {
  return {
    id: 1,
    uuid: SELF,
    name: 'Lorenzo',
    email: 'admin@bokito.ai',
    avatarUrl: null,
    role: 'owner',
    presence,
  }
}

describe('ingestMemberPresence', () => {
  beforeEach(() => {
    __resetLiveStoreForTests()
    __resetMemberPresenceForTests()
    seedLive<InboxMember>(TABLE, [member('offline')], (row) => row.uuid)
  })

  it('keeps the open session available when a stale offline event arrives', () => {
    setSelfPresenceContext(SELF)
    setSelfPresenceLive(true)
    ingestMemberPresence({
      event: 'presence',
      topics: ['presence'],
      data: { user_id: SELF, status: 'offline' },
    })
    expect(getLive<InboxMember>(TABLE, SELF)?.presence).toBe('available')
  })

  it('keeps unavailable while the socket is live', () => {
    setSelfPresenceContext(SELF)
    setSelfPresenceLive(true)
    ingestMemberPresence({
      event: 'presence',
      topics: ['presence'],
      data: { user_id: SELF, status: 'unavailable' },
    })
    expect(getLive<InboxMember>(TABLE, SELF)?.presence).toBe('unavailable')
  })

  it('applies away even while the socket is live', () => {
    setSelfPresenceContext(SELF)
    setSelfPresenceLive(true)
    ingestMemberPresence({
      event: 'presence',
      topics: ['presence'],
      data: { user_id: SELF, status: 'away' },
    })
    expect(getLive<InboxMember>(TABLE, SELF)?.presence).toBe('away')
  })

  it('applies offline for other people', () => {
    const other = '22222222-2222-2222-2222-222222222222'
    applyLive<InboxMember>(TABLE, other, { ...member('available'), uuid: other, id: 2 })
    setSelfPresenceContext(SELF)
    setSelfPresenceLive(true)
    ingestMemberPresence({
      event: 'presence',
      topics: ['presence'],
      data: { user_id: other, status: 'offline' },
    })
    expect(getLive<InboxMember>(TABLE, other)?.presence).toBe('offline')
  })
})
