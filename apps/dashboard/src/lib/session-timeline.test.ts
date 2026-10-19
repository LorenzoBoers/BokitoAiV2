import { describe, expect, it } from 'vitest'
import { collapseRecentUserEchoes, sessionChatToInboxMessage } from './session-timeline'

describe('collapseRecentUserEchoes', () => {
  it('drops a second operator bubble with the same text a moment later', () => {
    const rows = collapseRecentUserEchoes([
      {
        bodyText: 'Nog een paar',
        authorUserId: 7,
        createdAt: '2026-10-12T21:40:00.000Z',
      },
      {
        bodyText: 'Nog een paar',
        authorUserId: 7,
        createdAt: '2026-10-12T21:40:02.000Z',
      },
    ])
    expect(rows).toHaveLength(1)
  })

  it('keeps an agent reply with the same text', () => {
    const rows = collapseRecentUserEchoes([
      {
        bodyText: 'Hallo',
        authorUserId: 7,
        createdAt: '2026-10-12T21:40:00.000Z',
      },
      {
        bodyText: 'Hallo',
        authorUserId: null,
        createdAt: '2026-10-12T21:40:01.000Z',
      },
    ])
    expect(rows).toHaveLength(2)
  })
})

describe('sessionChatToInboxMessage', () => {
  it('keeps the history document the chat API already sent', () => {
    const row = sessionChatToInboxMessage(
      {
        id: 'm1',
        role: 'assistant',
        content: 'Here is the picture.',
        created_at: '2026-10-18T12:00:00',
        history: {
          rows: [{ label_key: 'activity.generatedImage', count: 1 }],
          frames: [{ status: 'ready', src: 'https://cdn.example/a.png' }],
        },
      },
      { id: 's1', agentId: null },
      null,
    )
    expect(row.history?.rows).toHaveLength(1)
    expect(row.history?.frames[0]?.src).toBe('https://cdn.example/a.png')
  })
})
