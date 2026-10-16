import { describe, expect, it } from 'vitest'
import { floorKey, participantsToAvatarStack } from './participant-stack'
import type { ThreadParticipant } from './inbox-api'

function person(over: Partial<ThreadParticipant> = {}): ThreadParticipant {
  return {
    id: 'p1',
    kind: 'user',
    ref_id: 'user-1',
    role: 'member',
    name: 'Ada',
    email: 'ada@example.com',
    ...over,
  }
}

describe('participantsToAvatarStack', () => {
  it('stacks people and agents in roster order with the live orb', () => {
    const stack = participantsToAvatarStack(
      [
        person(),
        person({
          id: 'p2',
          kind: 'agent',
          ref_id: 'agent-1',
          name: 'Bokito',
          avatar_kind: 'orb',
          avatar_shape: 'circle',
          avatar_color: '#888888',
        }),
      ],
      {
        agents: [
          {
            id: 'agent-1',
            name: 'Bokito',
            avatar_kind: 'orb',
            avatar_shape: 'triangle',
            avatar_color: '#ff4d4d',
          },
        ],
      },
    )
    expect(stack.map((member) => member.key)).toEqual(['user:user-1', 'agent:agent-1'])
    expect(stack[1]).toMatchObject({
      kind: 'agent',
      agent: { avatar_shape: 'triangle', avatar_color: '#ff4d4d' },
    })
  })

  it('expands a team into member faces and skips people already on the thread', () => {
    const stack = participantsToAvatarStack(
      [
        person({ role: 'owner' }),
        person({ id: 'p-team', kind: 'team', ref_id: 'team-1', name: 'Support', role: 'member' }),
      ],
      {
        people: [{ uuid: 'user-1', name: 'Ada', email: 'ada@example.com' }],
        agents: [{ id: 'agent-9', name: 'Helper', avatar_kind: 'orb', avatar_shape: 'triangle' }],
        teams: [
          {
            id: 'team-1',
            name: 'Support',
            members: [
              { kind: 'user', id: 'user-1' },
              { kind: 'agent', id: 'agent-9' },
            ],
          },
        ],
      },
    )
    expect(stack.map((member) => member.key)).toEqual(['user:user-1', 'agent:agent-9'])
    expect(stack[0]?.title).toBe('Ada · owner')
  })

  it('keeps an empty team as one mark in the pile', () => {
    const stack = participantsToAvatarStack([
      person({ id: 't', kind: 'team', ref_id: 'team-x', name: 'Night', role: 'member' }),
      person({ id: 'c', kind: 'contact', ref_id: 'contact-1', name: 'Sam', email: 'sam@x.com' }),
    ])
    expect(stack.map((member) => member.kind)).toEqual(['team', 'user'])
    expect(stack[1]?.key).toBe('contact:contact-1')
  })

  it('marks the floor holder', () => {
    expect(floorKey({ kind: 'Agent', ref_id: 'agent-1' })).toBe('agent:agent-1')
    const stack = participantsToAvatarStack(
      [person({ id: 'a', kind: 'agent', ref_id: 'agent-1', name: 'Bokito', role: 'member' })],
      { activeTurn: { kind: 'agent', ref_id: 'agent-1', name: 'Bokito' } },
    )
    expect(stack[0]?.title).toBe('Bokito · floor')
  })
})
