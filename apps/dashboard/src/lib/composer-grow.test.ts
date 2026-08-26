import { describe, expect, it } from 'vitest'
import { clampComposerFloor, COMPOSER_GROW } from './composer-grow'

describe('composer grow presets', () => {
  it('keeps email taller than chat so replies have room to type', () => {
    expect(COMPOSER_GROW.email.min).toBeGreaterThan(COMPOSER_GROW.chat.min)
    expect(COMPOSER_GROW.email.max).toBeGreaterThan(COMPOSER_GROW.chat.max)
  })

  it('clamps a dragged height into the mode range', () => {
    expect(clampComposerFloor('chat', 10)).toBe(COMPOSER_GROW.chat.min)
    expect(clampComposerFloor('email', 900)).toBe(COMPOSER_GROW.email.max)
    expect(clampComposerFloor('note', 120)).toBe(120)
  })
})
