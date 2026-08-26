import { describe, expect, it } from 'vitest'
import { formatDecisionExcerpt } from './decision-excerpt'

describe('formatDecisionExcerpt', () => {
  it('keeps a short finished sentence', () => {
    expect(formatDecisionExcerpt('Bestelbevestiging van Fruugo voor order 242125383.')).toBe(
      'Bestelbevestiging van Fruugo voor order 242125383.',
    )
  })

  it('collapses whitespace and ends a long dump on a word with an ellipsis', () => {
    const raw =
      'Hallo Lorenzo,  Best verkocht Topmerken Help Mijn account Verkoop Zoeken Artikelen zijn bevestigd We willen u alleen laten weten dat de volgende item(s) van uw Fruugo bestelling 242125383 zijn bevestigd en onderweg.'
    const excerpt = formatDecisionExcerpt(raw, 80)
    expect(excerpt.endsWith('...')).toBe(true)
    expect(excerpt).not.toMatch(/beves$/)
    expect(excerpt.includes('  ')).toBe(false)
  })

  it('adds an ellipsis when a stored preview was already cut mid-word', () => {
    expect(formatDecisionExcerpt('van uw Fruugo bestelling 242125383 zijn beve')).toBe(
      'van uw Fruugo bestelling 242125383 zijn beve...',
    )
  })

  it('does not mark a short complete phrase as cut', () => {
    expect(formatDecisionExcerpt('Beslissing nodig')).toBe('Beslissing nodig')
  })
})
