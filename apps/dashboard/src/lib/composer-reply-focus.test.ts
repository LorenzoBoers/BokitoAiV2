import { describe, expect, it } from 'vitest'
import { composerLanding, mentionedNames, mentionedTargets, teamLabelNames } from './composer-reply-focus'

describe('composer-reply-focus', () => {
  it('lands on the last received sender and never on a note', () => {
    const messages = [
      { direction: 'inbound', kind: 'message' },
      { kind: 'agent_message', payload: { agent_id: 'agent-1' } },
      { kind: 'internal_note', authorUserId: 7 },
      { direction: 'outbound', authorUserId: 7 },
    ]
    expect(composerLanding(messages, { selfUserId: 7, allowReply: true })).toBe('ask')
    expect(composerLanding([{ direction: 'inbound', kind: 'chat' }], { selfUserId: 7, allowReply: true })).toBe(
      'reply',
    )
    expect(
      composerLanding([{ authorUserId: 3, direction: 'outbound', kind: 'message' }], {
        selfUserId: 7,
        allowReply: true,
      }),
    ).toBe('ask')
  })

  it('names the chips in the text once each', () => {
    const raw =
      'Hi @[Alpha](agent:11111111-1111-1111-1111-111111111111) @[Sam](user:42) and @[Alpha](agent:11111111-1111-1111-1111-111111111111)'
    expect(mentionedNames(raw)).toEqual(['Alpha', 'Sam'])
    expect(mentionedTargets(raw)).toEqual([
      { type: 'agent', id: '11111111-1111-1111-1111-111111111111', name: 'Alpha' },
      { type: 'user', id: '42', name: 'Sam' },
    ])
    expect(mentionedNames('no chips')).toEqual([])
  })

  it('shortens long label lists', () => {
    expect(teamLabelNames(['A'])).toBe('A')
    expect(teamLabelNames(['A', 'B'])).toBe('A, B')
    expect(teamLabelNames(['A', 'B', 'C', 'D'])).toBe('A, B +2')
  })
})
