import { describe, expect, it } from 'vitest'
import {
  extractDomain,
  getDomainFaviconUrl,
  getHostFaviconUrl,
  normalizeFaviconHost,
} from './domain-favicon'

describe('domain favicon helpers', () => {
  it('extracts the host from an email address', () => {
    expect(extractDomain('noreply@github.com')).toBe('github.com')
    expect(extractDomain('bad')).toBeNull()
  })

  it('normalizes website hosts', () => {
    expect(normalizeFaviconHost('https://www.paypal.com/nl')).toBe('www.paypal.com')
    expect(normalizeFaviconHost('odido.nl.')).toBe('odido.nl')
    expect(normalizeFaviconHost('not an address')).toBeNull()
  })

  it('builds favicon URLs from email and host', () => {
    expect(getDomainFaviconUrl('billing@paypal.com', 64)).toBe(
      'https://www.google.com/s2/favicons?sz=64&domain=paypal.com',
    )
    expect(getHostFaviconUrl('https://letterboxd.com', 32)).toBe(
      'https://www.google.com/s2/favicons?sz=32&domain=letterboxd.com',
    )
  })
})
