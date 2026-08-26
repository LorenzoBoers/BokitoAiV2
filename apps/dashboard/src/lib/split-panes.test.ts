import { describe, expect, it } from 'vitest'
import { applyDrag, clamp, fitWidths, resolveWidths, type SplitPaneSpec } from './split-panes'

const SPECS: SplitPaneSpec[] = [
  { id: 'list', defaultWidth: 288, minWidth: 220, maxWidth: 520 },
  { id: 'main', defaultWidth: 0, minWidth: 0, maxWidth: 0, flex: true },
  { id: 'context', defaultWidth: 288, minWidth: 240, maxWidth: 420 },
]

describe('split pane math', () => {
  it('clamps stored widths to each pane range', () => {
    expect(resolveWidths(SPECS, { list: 80, context: 900 })).toEqual({ list: 220, context: 420 })
    expect(resolveWidths(SPECS, {})).toEqual({ list: 288, context: 288 })
  })

  it('shrinks fixed panes so the flex pane keeps its minimum', () => {
    const fitted = fitWidths(SPECS, { list: 520, context: 420 }, 900, 320)
    expect(fitted.list + fitted.context).toBeLessThanOrEqual(580)
    expect(fitted.list).toBeGreaterThanOrEqual(220)
    expect(fitted.context).toBeGreaterThanOrEqual(240)
  })

  it('does not grow panes when there is spare room', () => {
    const current = { list: 288, context: 288 }
    expect(fitWidths(SPECS, current, 1400, 320)).toEqual(current)
  })

  it('applies a drag then refits against the container', () => {
    const next = applyDrag(SPECS, { list: 288, context: 288 }, 'list', 400, 1200, 320)
    expect(next.list).toBe(400)
    expect(next.context).toBe(288)
  })

  it('clamps a value into a range', () => {
    expect(clamp(10, 20, 40)).toBe(20)
    expect(clamp(50, 20, 40)).toBe(40)
  })
})
