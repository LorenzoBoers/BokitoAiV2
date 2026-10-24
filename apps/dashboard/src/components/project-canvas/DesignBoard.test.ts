import { describe, expect, it } from 'vitest'
import { designFrames } from './DesignBoard'

describe('designFrames', () => {
  it('reads frames and drops a broken document', () => {
    const frames = designFrames(
      JSON.stringify({ frames: [{ id: 'a', x: 12, y: 8, w: 200, h: 140, title: 'Home', text: 'Hi' }] }),
    )
    expect(frames).toEqual([{ id: 'a', x: 12, y: 8, w: 200, h: 140, title: 'Home', text: 'Hi' }])
    expect(designFrames('not json')).toEqual([])
    expect(designFrames('{"frames":[]}')).toEqual([])
  })
})
