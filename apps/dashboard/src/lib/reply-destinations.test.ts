import { describe, expect, it } from 'vitest'
import { buildReplyDestinations, customerReachLabel } from './reply-destinations'

describe('customerReachLabel', () => {
  it('uses the customer email on mail', () => {
    expect(
      customerReachLabel({
        channel: 'email',
        email: 'sanne@klant.nl',
        name: 'Sanne',
        fallback: 'Email',
      }),
    ).toBe('sanne@klant.nl')
  })

  it('uses the phone number on WhatsApp', () => {
    expect(
      customerReachLabel({
        channel: 'whatsapp',
        phone: '+31 6 12345678',
        name: 'Sanne',
        fallback: 'WhatsApp',
      }),
    ).toBe('+31 6 12345678')
  })

  it('skips a widget placeholder address', () => {
    expect(
      customerReachLabel({
        channel: 'widget',
        email: 'cust_abc123',
        name: 'Website visitor',
        fallback: 'Website chat',
      }),
    ).toBe('Website visitor')
  })
})

describe('buildReplyDestinations', () => {
  it('lists another email on the same conversation and a WhatsApp thread', () => {
    const rows = buildReplyDestinations({
      threadId: 'mail-1',
      channel: 'email',
      email: 'sanne@klant.nl',
      name: 'Sanne',
      contactAddress: 'sanne@klant.nl',
      contactChannel: 'email',
      contactPhone: '+31612345678',
      identities: [{ channel: 'email', address: 'sanne.werk@klant.nl' }],
      threads: [
        {
          id: 'wa-1',
          channel: 'whatsapp',
          contactPhone: '+31612345678',
          contactName: 'Sanne',
        },
      ],
      fallback: 'Email',
    })
    expect(rows.map((row) => row.label)).toEqual([
      'sanne@klant.nl',
      '+31612345678',
      'sanne.werk@klant.nl',
    ])
    expect(rows[1].threadId).toBe('wa-1')
    expect(rows[2].to).toBe('sanne.werk@klant.nl')
    expect(rows[2].threadId).toBeNull()
  })

  it('does not repeat the current address', () => {
    const rows = buildReplyDestinations({
      threadId: 'mail-1',
      channel: 'email',
      email: 'sanne@klant.nl',
      identities: [{ channel: 'email', address: 'sanne@klant.nl' }],
      fallback: 'Email',
    })
    expect(rows).toHaveLength(1)
  })
})
