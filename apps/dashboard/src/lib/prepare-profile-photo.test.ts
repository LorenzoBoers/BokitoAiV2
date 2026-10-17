import { describe, expect, it } from 'vitest'
import { avatarCropFrame } from './prepare-profile-photo'

describe('avatarCropFrame', () => {
  it('centers a wide photo at zoom 1', () => {
    const frame = avatarCropFrame({ srcW: 400, srcH: 200, zoom: 1, offsetX: 0, offsetY: 0 })
    expect(frame.side).toBeCloseTo(200)
    expect(frame.sy).toBeCloseTo(0)
    expect(frame.sx).toBeCloseTo(100)
  })

  it('slides a wide photo to the left edge when dragged right', () => {
    const frame = avatarCropFrame({ srcW: 400, srcH: 200, zoom: 1, offsetX: 10_000, offsetY: 0 })
    expect(frame.sx).toBeCloseTo(0)
    expect(frame.side).toBeCloseTo(200)
  })

  it('zooms into a smaller square', () => {
    const frame = avatarCropFrame({ srcW: 400, srcH: 200, zoom: 2, offsetX: 0, offsetY: 0 })
    expect(frame.side).toBeCloseTo(100)
  })
})
