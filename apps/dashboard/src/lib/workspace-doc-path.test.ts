import { describe, expect, it } from 'vitest'
import { titleToDocPath } from './workspace-doc-path'

describe('titleToDocPath', () => {
  it('builds a docs path from a title', () => {
    expect(titleToDocPath('Refund policy')).toBe('docs/refund-policy.md')
  })

  it('strips accents and punctuation', () => {
    expect(titleToDocPath('  Retour & garantie!  ')).toBe('docs/retour-garantie.md')
  })

  it('returns empty when the title has no letters', () => {
    expect(titleToDocPath('!!!')).toBe('')
  })
})
