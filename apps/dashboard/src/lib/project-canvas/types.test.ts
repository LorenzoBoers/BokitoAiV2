import { describe, expect, it } from 'vitest'
import { isEmptyCanvasTree, type CanvasNode } from './types'

describe('isEmptyCanvasTree', () => {
  it('treats an empty Stack as empty', () => {
    expect(isEmptyCanvasTree({ type: 'Stack', props: {}, children: [] })).toBe(true)
  })

  it('keeps a Stat tree', () => {
    const tree: CanvasNode = {
      type: 'Stack',
      children: [{ type: 'Stat', props: { title: 'Open', value: '3' } }],
    }
    expect(isEmptyCanvasTree(tree)).toBe(false)
  })
})
