import { describe, expect, it } from 'vitest'
import {
  isFreeEmailDomain,
  looksLikePersonalName,
  preferCompanyFavicon,
} from './company-avatar'

describe('company avatar choice', () => {
  it('treats consumer mail as free', () => {
    expect(isFreeEmailDomain('gmail.com')).toBe(true)
    expect(isFreeEmailDomain('moneybird.com')).toBe(false)
  })

  it('detects personal names', () => {
    expect(looksLikePersonalName('Harold van Bourgondiën')).toBe(true)
    expect(looksLikePersonalName('Google')).toBe(false)
    expect(looksLikePersonalName('Moneybird')).toBe(false)
  })

  it('prefers favicons for org senders on business domains', () => {
    expect(preferCompanyFavicon('Google', 'noreply@google.com')).toBe(true)
    expect(preferCompanyFavicon('Moneybird', 'no-reply@moneybird.nl')).toBe(true)
    expect(preferCompanyFavicon('Resend', 'account@resend.com')).toBe(true)
  })

  it('keeps person avatars for people and free mail', () => {
    expect(preferCompanyFavicon('Harold van Bourgondiën', 'harold@bourgondienadvies.nl')).toBe(
      false,
    )
    expect(preferCompanyFavicon('Ada Lovelace', 'ada@gmail.com')).toBe(false)
    expect(preferCompanyFavicon('Visitor', 'visitor@web')).toBe(false)
  })
})
