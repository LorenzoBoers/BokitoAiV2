import { describe, expect, it } from 'vitest'
import {
  contactMatchesIdentity,
  enrichContactsFromThreads,
  latestThreadActivityAt,
  threadMatchesContact,
} from './contacts-api'
import type { ContactRow } from './contacts-api'
import type { InboxThread } from './inbox-api'

function contact(partial: Partial<ContactRow> & Pick<ContactRow, 'id' | 'address' | 'displayName'>): ContactRow {
  return {
    channel: 'email',
    status: 'approved',
    company: '',
    companyId: null,
    title: '',
    phone: '',
    notes: '',
    lastSeenAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    threadCount: 0,
    ...partial,
  }
}

function thread(
  partial: Partial<Pick<InboxThread, 'id' | 'contactId' | 'contactEmail' | 'contactName' | 'lastMessageAt'>>,
): Pick<InboxThread, 'id' | 'contactId' | 'contactEmail' | 'contactName' | 'lastMessageAt'> {
  return {
    id: 't1',
    contactId: null,
    contactEmail: '',
    contactName: '',
    lastMessageAt: '2026-08-20T10:00:00Z',
    ...partial,
  }
}

describe('threadMatchesContact', () => {
  const contact = {
    id: 'd69c9fef-9213-41fe-b862-b77b8fc9a2b4',
    address: 'sanne@example.com',
    displayName: 'Sanne de Vries',
  }

  it('matches a compact UUID contact id', () => {
    expect(
      threadMatchesContact(
        {
          contactId: 'd69c9fef921341feb862b77b8fc9a2b4',
          contactEmail: '',
          contactName: '',
        },
        contact,
      ),
    ).toBe(true)
  })

  it('matches email or display name when the id is missing', () => {
    expect(
      threadMatchesContact(
        { contactId: null, contactEmail: 'sanne@example.com', contactName: '' },
        contact,
      ),
    ).toBe(true)
    expect(
      threadMatchesContact(
        { contactId: null, contactEmail: '', contactName: 'Sanne de Vries' },
        contact,
      ),
    ).toBe(true)
    expect(
      threadMatchesContact(
        { contactId: null, contactEmail: 'other@example.com', contactName: 'Someone else' },
        contact,
      ),
    ).toBe(false)
  })
})

describe('contactMatchesIdentity', () => {
  const contact = {
    id: 'd69c9fef-9213-41fe-b862-b77b8fc9a2b4',
    address: 'sanne@example.com',
    displayName: 'Sanne de Vries',
  }

  it('matches a thread that only has an email', () => {
    expect(contactMatchesIdentity(contact, { email: 'sanne@example.com', name: '' })).toBe(true)
    expect(contactMatchesIdentity(contact, { email: 'other@example.com', name: 'Sanne de Vries' })).toBe(true)
    expect(contactMatchesIdentity(contact, { email: 'other@example.com', name: 'Else' })).toBe(false)
  })
})

describe('latestThreadActivityAt', () => {
  it('returns the newest lastMessageAt', () => {
    expect(
      latestThreadActivityAt([
        { lastMessageAt: '2026-08-20T10:00:00Z' },
        { lastMessageAt: null },
        { lastMessageAt: '2026-08-24T09:00:00Z' },
      ]),
    ).toBe('2026-08-24T09:00:00Z')
  })
})

describe('enrichContactsFromThreads', () => {
  it('fills last-seen and thread count from a matching email', () => {
    const rows = enrichContactsFromThreads(
      [contact({ id: 'c1', address: 'sanne@klant.nl', displayName: 'Sanne de Vries' })],
      [
        thread({
          id: 't-sanne',
          contactEmail: 'sanne@klant.nl',
          contactName: 'Sanne de Vries',
          lastMessageAt: '2026-06-08T12:00:00Z',
        }) as InboxThread,
      ],
    )
    expect(rows[0]?.threadCount).toBe(1)
    expect(rows[0]?.lastSeenAt).toBe('2026-06-08T12:00:00Z')
  })

  it('does not give every website visitor the same widget threads', () => {
    const rows = enrichContactsFromThreads(
      [
        contact({ id: 'v1', address: 'visitor@web', displayName: 'Websitebezoeker', channel: 'widget' }),
        contact({ id: 'v2', address: 'visitor@widget', displayName: 'Websitebezoeker', channel: 'widget' }),
      ],
      [
        thread({
          id: 't-widget',
          contactName: 'Websitebezoeker',
          contactEmail: '',
        }) as InboxThread,
      ],
    )
    expect(rows[0]?.threadCount).toBe(0)
    expect(rows[1]?.threadCount).toBe(0)
  })
})
