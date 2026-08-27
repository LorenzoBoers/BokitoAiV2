import { describe, expect, it } from 'vitest'
import { helpCenterPath, parseHelpSearch } from './help-search-url'

describe('help search URL', () => {
  it('trims the query', () => {
    expect(parseHelpSearch('  refund  ')).toBe('refund')
    expect(parseHelpSearch(null)).toBe('')
  })

  it('keeps a shareable search link', () => {
    expect(helpCenterPath('acme')).toBe('/help/acme')
    expect(helpCenterPath('acme', 'return policy')).toBe('/help/acme?q=return%20policy')
  })
})
