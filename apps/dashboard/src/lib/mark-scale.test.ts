import { describe, expect, it } from 'vitest'
import { MARK_SCALE, markDotSize, snapMarkSize } from './mark-scale'

describe('mark-scale', () => {
  it('keeps ladder values', () => {
    for (const step of MARK_SCALE) expect(snapMarkSize(step)).toBe(step)
  })

  it('snaps off-ladder pixels to the nearest step, ties up', () => {
    expect(snapMarkSize(12)).toBe(16)
    expect(snapMarkSize(14)).toBe(16)
    expect(snapMarkSize(18)).toBe(20)
    expect(snapMarkSize(26)).toBe(24)
    expect(snapMarkSize(28)).toBe(32)
    expect(snapMarkSize(44)).toBe(48)
    expect(snapMarkSize(72)).toBe(80)
    expect(snapMarkSize(120)).toBe(128)
    expect(snapMarkSize(200)).toBe(128)
  })

  it('uses integer presence dots', () => {
    expect(markDotSize(16)).toBe(6)
    expect(markDotSize(32)).toBe(8)
    expect(markDotSize(48)).toBe(10)
    expect(markDotSize(96)).toBe(12)
  })
})
