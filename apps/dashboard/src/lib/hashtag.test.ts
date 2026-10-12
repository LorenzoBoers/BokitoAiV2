import { describe, expect, it } from 'vitest'
import { normalizeHashtag } from './hashtag'

describe('normalizeHashtag', () => {
  it('joins words with underscores', () => {
    expect(normalizeHashtag('  Mistral AI ')).toBe('mistral_ai')
    expect(normalizeHashtag('#mistral-ai')).toBe('mistral_ai')
    expect(normalizeHashtag('mistral__ai')).toBe('mistral_ai')
    expect(normalizeHashtag('Billing')).toBe('billing')
  })
})
