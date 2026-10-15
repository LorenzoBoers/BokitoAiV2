import { describe, expect, it } from 'vitest'
import { notificationFromHref, parseNotificationFrom } from './notification-from'

describe('parseNotificationFrom', () => {
  it('returns null without a sender', () => {
    expect(parseNotificationFrom({})).toBeNull()
    expect(parseNotificationFrom({ from: { kind: 'ops' } })).toBeNull()
  })

  it('parses user, agent and contact marks', () => {
    expect(
      parseNotificationFrom({
        from: { kind: 'user', id: 'u1', name: 'Ada', email: 'ada@example.com', avatar_url: '/a.png' },
      }),
    ).toMatchObject({ kind: 'user', id: 'u1', name: 'Ada', email: 'ada@example.com' })

    expect(
      parseNotificationFrom({
        from: { kind: 'agent', id: 'a1', name: 'Orchestrator', avatar_kind: 'orb', avatar_color: '#7c5cff' },
      }),
    ).toMatchObject({ kind: 'agent', id: 'a1', name: 'Orchestrator', avatar_kind: 'orb' })

    expect(
      parseNotificationFrom({
        from: { kind: 'contact', id: 'c1', name: 'Erik', email: 'erik@acme.nl' },
      }),
    ).toMatchObject({ kind: 'contact', id: 'c1', name: 'Erik' })
  })
})

describe('notificationFromHref', () => {
  it('links agents and contacts when an id is present', () => {
    expect(notificationFromHref({ kind: 'agent', id: 'a1', name: 'Bot' })).toBe('/agents/a1')
    expect(notificationFromHref({ kind: 'contact', id: 'c1', name: 'Erik' })).toBe('/contacts/c1')
    expect(notificationFromHref({ kind: 'user', id: 'u1', name: 'Ada' })).toBe('/team')
    expect(notificationFromHref({ kind: 'contact', name: 'Anon' })).toBeNull()
  })
})
