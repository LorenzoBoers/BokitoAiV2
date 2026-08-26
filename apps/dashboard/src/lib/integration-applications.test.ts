import { describe, expect, it } from 'vitest'
import { localizeApplication, localizeOfferDescription } from './integration-applications'

const t = (key: string, opts?: { defaultValue?: string }) => {
  const map: Record<string, string> = {
    'integrations.hosts.google.name': 'Google',
    'integrations.hosts.google.description': 'Gmail-mailboxen voor inbox en e-mail in Bokito.',
    'integrations.hosts.custom.name': 'Eigen tool',
  }
  return map[key] ?? opts?.defaultValue ?? key
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

  it('localizes offer descriptions from the host', () => {
    expect(localizeOfferDescription('google', 'Gmail mailboxes for inbox and email in Bokito.', t)).toBe(
      'Gmail-mailboxen voor inbox en e-mail in Bokito.',
    )
  })
})
