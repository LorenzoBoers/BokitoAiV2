import { describe, expect, it } from 'vitest'
import { collapseRecentUserEchoes } from './session-timeline'

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
