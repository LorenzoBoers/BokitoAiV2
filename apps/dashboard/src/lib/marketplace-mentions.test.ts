import { describe, expect, it } from 'vitest'
import { mergeShowcaseItems } from './marketplace-mentions'

describe('mergeShowcaseItems', () => {
  it('keeps attached cards and does not invent connectors from prose', () => {
    const attached = [
      {
        type: 'marketplace' as const,
        id: 'moneybird',
        title: 'Moneybird',
        subtitle: '',
      },
    ]
    const merged = mergeShowcaseItems(attached)
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('moneybird')
  })

  it('treats the same connector title as one card even with different ids', () => {
    const merged = mergeShowcaseItems(
      [
        {
          type: 'marketplace' as const,
          id: 'outlook',
          title: 'Microsoft 365',
          subtitle: '',
        },
      ],
      [
        {
          type: 'marketplace' as const,
          id: 'microsoft_365',
          title: 'Microsoft 365 / Outlook',
          subtitle: '',
        },
      ],
    )
    expect(merged).toHaveLength(1)
  })
})
