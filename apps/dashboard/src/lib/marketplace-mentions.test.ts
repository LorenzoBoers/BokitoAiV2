import { describe, expect, it } from 'vitest'
import {
  inferMarketplaceItems,
  mergeShowcaseItems,
  splitMarketplaceMentions,
} from './marketplace-mentions'

const LIST = [
  'Hier zijn 10 koppelingen die we kunnen activeren:',
  '- Moneybird',
  '- KING Accountancy',
  '- Exact Online',
  '- Twinfield',
  '- SnelStart',
  '- Yuki',
  '- GoCardless Bank Account Data',
  '- Tink',
  '- Yapily',
  '- Knab',
].join('\n')

describe('inferMarketplaceItems', () => {
  it('finds connector names in a bullet list, in appearance order', () => {
    const items = inferMarketplaceItems(LIST)
    const slugs = items.map((item) => item.id)
    expect(slugs).toEqual(
      expect.arrayContaining([
        'moneybird',
        'king_accountancy',
        'exact',
        'twinfield',
        'snelstart',
        'yuki',
        'gocardless',
        'tink',
        'yapily',
        'knab',
      ]),
    )
    expect(slugs.indexOf('moneybird')).toBeLessThan(slugs.indexOf('knab'))
    expect(items.every((item) => item.type === 'marketplace' && item.path)).toBe(true)
  })

  it('does not treat common words as connectors', () => {
    expect(inferMarketplaceItems('That is the exact amount.')).toEqual([])
    expect(inferMarketplaceItems('Just chatting.')).toEqual([])
  })
})

describe('splitMarketplaceMentions', () => {
  it('chips a catalog name and leaves the rest as text', () => {
    const nodes = splitMarketplaceMentions('Koppel Moneybird vandaag.')
    expect(nodes).toEqual([
      { type: 'text', text: 'Koppel ' },
      { type: 'link', label: 'Moneybird', href: '/connections?connect=moneybird' },
      { type: 'text', text: ' vandaag.' },
    ])
  })
})

describe('mergeShowcaseItems', () => {
  it('keeps attached cards and fills missing connectors from the text', () => {
    const attached = [
      {
        type: 'marketplace' as const,
        id: 'moneybird',
        title: 'Moneybird',
        subtitle: '',
      },
    ]
    const merged = mergeShowcaseItems(attached, inferMarketplaceItems(LIST))
    expect(merged[0].id).toBe('moneybird')
    expect(merged.some((item) => item.id === 'twinfield')).toBe(true)
    expect(merged.filter((item) => item.id === 'moneybird')).toHaveLength(1)
  })

  it('treats the same connector title as one card even with different ids', () => {
    const merged = mergeShowcaseItems(
      [
        {
          type: 'integration',
          id: 'uuid-1',
          title: 'Google Calendar',
          subtitle: 'Marketplace · Sync events into Agenda.',
          provider: 'google_calendar',
        },
      ],
      [
        {
          type: 'marketplace',
          id: 'google_calendar',
          title: 'Google Calendar',
          subtitle: '',
          provider: 'google_calendar',
        },
      ],
    )
    expect(merged).toHaveLength(1)
  })
})
