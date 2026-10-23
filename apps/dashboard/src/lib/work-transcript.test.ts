import { describe, expect, it } from 'vitest'
import { isWorkTranscript } from './work-transcript'

describe('isWorkTranscript', () => {
  it('keeps the operator turn in an agent chat as a bubble', () => {
    expect(
      isWorkTranscript({ kind: 'user_message', direction: 'outbound', payload: {} }, 'assistant'),
    ).toBe(false)
  })

  it('renders the agent answer in an agent chat as a document', () => {
    expect(
      isWorkTranscript(
        { kind: 'agent_message', direction: 'outbound', payload: { agent_id: 'a' } },
        'assistant',
      ),
    ).toBe(true)
  })

  it('keeps a customer chat reply as a bubble', () => {
    expect(
      isWorkTranscript(
        { kind: 'agent_message', direction: 'outbound', payload: { agent_id: 'a' } },
        'whatsapp',
      ),
    ).toBe(false)
  })

  it('renders a session agent turn on a customer thread as a document', () => {
    expect(
      isWorkTranscript(
        { kind: 'agent_message', direction: 'outbound', payload: { agent_session_id: 's1', agent_id: 'a' } },
        'email',
      ),
    ).toBe(true)
  })

  it('keeps the operator question in a session as a bubble', () => {
    expect(
      isWorkTranscript(
        { kind: 'user_message', direction: 'outbound', payload: { agent_session_id: 's1' } },
        'email',
      ),
    ).toBe(false)
  })

  it('keeps an internal note in its note chrome', () => {
    expect(
      isWorkTranscript({ kind: 'internal_note', direction: 'internal', payload: {} }, 'whatsapp'),
    ).toBe(false)
  })

  it('keeps team chats as bubbles, including an agent in the room', () => {
    expect(
      isWorkTranscript({ kind: 'user_message', direction: 'outbound', payload: {} }, 'internal'),
    ).toBe(false)
    expect(
      isWorkTranscript(
        { kind: 'agent_message', direction: 'outbound', payload: { agent_id: 'a' } },
        'internal',
      ),
    ).toBe(false)
    expect(
      isWorkTranscript({ kind: 'user_message', direction: 'internal', payload: {} }, 'widget'),
    ).toBe(false)
  })
})
