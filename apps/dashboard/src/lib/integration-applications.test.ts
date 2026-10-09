import { describe, expect, it } from 'vitest'
import {
  filterOfferRows,
  flattenApplicationOffers,
  localizeApplication,
  localizeOfferDescription,
  resolveApplicationConnectTarget,
  type IntegrationApplication,
} from './integration-applications'

const t = (key: string, opts?: { defaultValue?: string }) => {
  const map: Record<string, string> = {
    'integrations.hosts.google.name': 'Google',
    'integrations.hosts.google.description': 'Gmail-mailboxen voor inbox en e-mail in Bokito.',
    'integrations.hosts.custom.name': 'Eigen tool',
    'integrations.offers.google-workspace.name': 'Google Workspace',
    'integrations.offers.google-workspace.description': 'Gmail-mailboxen voor inbox en e-mail in Bokito.',
    'integrations.offers.google-calendar.name': 'Google Calendar',
    'integrations.offers.google-calendar.description': 'Agenda-sync voor Google.',
    'integrations.kind.inbox': 'Communicatie',
    'integrations.kind.calendar': 'Agenda',
  }
  return map[key] ?? opts?.defaultValue ?? key
}

function makeApp(): IntegrationApplication {
  return {
    hostSlug: 'google',
    name: 'Google',
    description: 'Gmail mailboxes for inbox and email in Bokito.',
    brand: {
      name: 'Google',
      initials: 'G',
      color: '#4285F4',
      logoUrl: null,
      logoDarkUrl: null,
      hostSlug: 'google',
    },
    offers: [
      {
        integration: {
          id: 'google-workspace',
          name: 'Google Workspace',
          description: 'Gmail mailboxes',
          status: 'available',
        } as IntegrationApplication['offers'][0]['integration'],
        kind: 'inbox',
        connectionCount: 1,
      },
      {
        integration: {
          id: 'google-calendar',
          name: 'Google Calendar',
          description: 'Calendar sync',
          status: 'available',
        } as IntegrationApplication['offers'][0]['integration'],
        kind: 'calendar',
        connectionCount: 0,
      },
    ],
    connectionCount: 1,
    status: 'available',
    kinds: ['inbox', 'calendar'],
    module: null,
  }
}

describe('localizeApplication', () => {
  it('uses host copy when present and keeps the English fallback otherwise', () => {
    expect(
      localizeApplication(
        { hostSlug: 'google', name: 'Google', description: 'Gmail mailboxes for inbox and email in Bokito.' },
        t,
      ).description,
    ).toBe('Gmail-mailboxen voor inbox en e-mail in Bokito.')
    expect(
      localizeApplication({ hostSlug: 'custom', name: 'Custom tool', description: 'Any external tool.' }, t).name,
    ).toBe('Eigen tool')
    expect(
      localizeApplication({ hostSlug: 'unknown', name: 'Acme', description: 'Fallback copy.' }, t).description,
    ).toBe('Fallback copy.')
  })

  it('localizes offer descriptions from the offer id, not the host', () => {
    const offer = makeApp().offers[1]
    expect(localizeOfferDescription(offer, 'Calendar sync', t)).toBe('Agenda-sync voor Google.')
  })
})

describe('flattenApplicationOffers', () => {
  it('emits one row per offer instead of one card per host', () => {
    const rows = flattenApplicationOffers([makeApp()])
    expect(rows.map((row) => row.offer.integration.id)).toEqual(['google-workspace', 'google-calendar'])
  })

  it('filters by kind, keeps connected offers first, and coming soon last', () => {
    const inbox = filterOfferRows(flattenApplicationOffers([makeApp()]), 'inbox', '', t)
    expect(inbox).toHaveLength(1)
    expect(inbox[0].offer.kind).toBe('inbox')
    const all = filterOfferRows(flattenApplicationOffers([makeApp()]), 'all', 'calendar', t)
    expect(all.map((row) => row.offer.integration.id)).toEqual(['google-calendar'])
    expect(filterOfferRows(flattenApplicationOffers([makeApp()]), 'modules', '', t)).toEqual([])
    // Kind-label text must not widen search (badge "Communicatie" ≠ name/description).
    expect(filterOfferRows(flattenApplicationOffers([makeApp()]), 'all', 'Communicatie', t)).toEqual(
      [],
    )

    const mixed = makeApp()
    mixed.offers.push({
      integration: {
        id: 'google-drive',
        name: 'Aaa Drive',
        description: 'Planned',
        status: 'coming_soon',
      } as IntegrationApplication['offers'][0]['integration'],
      kind: 'app',
      connectionCount: 0,
    })
    const ordered = filterOfferRows(flattenApplicationOffers([mixed]), 'all', '', t).map(
      (row) => row.offer.integration.id,
    )
    expect(ordered).toEqual(['google-workspace', 'google-calendar', 'google-drive'])
  })
})

describe('resolveApplicationConnectTarget', () => {
  it('returns the first offer when the connect param is a host slug', () => {
    const app = {
      hostSlug: 'moneybird',
      name: 'Moneybird',
      description: 'Accounting',
      offers: [
        {
          integration: { id: 'moneybird', name: 'Moneybird', description: '', status: 'available' as const },
          provider: null,
          kind: 'mcp' as const,
          connectionCount: 0,
        },
      ],
    }
    const target = resolveApplicationConnectTarget([app as never], 'moneybird')
    expect(target?.app.hostSlug).toBe('moneybird')
    expect(target?.offer?.integration.id).toBe('moneybird')
  })
})
