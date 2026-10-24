import { describe, expect, it } from 'vitest'
import { clampTooltipCenter, splitTooltipShortcut } from './tooltip'

describe('splitTooltipShortcut', () => {
  it('lifts a trailing key into the muted detail', () => {
    expect(splitTooltipShortcut('Minimaliseren (Esc)')).toEqual({
      label: 'Minimaliseren',
      detail: 'Esc',
    })
    expect(splitTooltipShortcut('Hide sidebar (Ctrl+B)')).toEqual({
      label: 'Hide sidebar',
      detail: 'Ctrl+B',
    })
    expect(splitTooltipShortcut('Hold to talk (Ctrl+Shift+B)')).toEqual({
      label: 'Hold to talk',
      detail: 'Ctrl+Shift+B',
    })
  })

  it('leaves a sentence whole when the parentheses are not a trailing key', () => {
    const sentence = 'Alle agents. Houd vast om te praten (F12); noem eerst een naam om er een te kiezen'
    expect(splitTooltipShortcut(sentence)).toEqual({ label: sentence, detail: null })
    expect(splitTooltipShortcut('Open (the menu)')).toEqual({
      label: 'Open (the menu)',
      detail: null,
    })
  })
})

describe('clampTooltipCenter', () => {
  it('keeps a box that would hang off the right edge inside the viewport', () => {
    expect(clampTooltipCenter(1850, 280, 1920)).toBe(1920 - 8 - 140)
  })

  it('keeps a box that would hang off the left edge inside the viewport', () => {
    expect(clampTooltipCenter(20, 200, 1920)).toBe(8 + 100)
  })

  it('centers a box that is wider than the viewport', () => {
    expect(clampTooltipCenter(1800, 2000, 1920)).toBe(960)
  })
})
