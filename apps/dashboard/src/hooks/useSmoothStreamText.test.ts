/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SMOOTH_STREAM, smoothStreamRate, useSmoothStreamText } from './useSmoothStreamText'

describe('smoothStreamRate', () => {
  it('eases out at the floor and caps bursts at the ceiling', () => {
    expect(smoothStreamRate(5, true)).toBe(SMOOTH_STREAM.minCps)
    expect(smoothStreamRate(400, true)).toBe(SMOOTH_STREAM.maxCps)
    // Mid backlog: proportional to the drain horizon.
    expect(smoothStreamRate(90, true)).toBeCloseTo((90 * 1000) / SMOOTH_STREAM.drainMs)
  })

  it('lifts the ceiling for very large backlogs so the view catches up', () => {
    const rate = smoothStreamRate(3000, true)
    expect(rate).toBeGreaterThan(SMOOTH_STREAM.maxCps)
    expect(rate).toBeCloseTo((3000 * 1000) / SMOOTH_STREAM.burstDrainMs)
  })

  it('finishes fast once the stream ended', () => {
    expect(smoothStreamRate(40, false)).toBe(SMOOTH_STREAM.finishCps)
  })
})

describe('useSmoothStreamText', () => {
  let rafCallbacks: FrameRequestCallback[]
  let clock: number

  beforeEach(() => {
    rafCallbacks = []
    clock = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    vi.stubGlobal(
      'requestAnimationFrame',
      (cb: FrameRequestCallback) => {
        rafCallbacks.push(cb)
        return rafCallbacks.length
      },
    )
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks[id - 1] = () => {}
    })
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Advance `n` frames of `frameMs` wall-clock each. */
  function flushFrames(n = 5, frameMs = 16) {
    for (let i = 0; i < n; i++) {
      clock += frameMs
      const cbs = [...rafCallbacks]
      rafCallbacks = []
      for (const cb of cbs) cb(clock)
    }
  }

  it('stops scheduling RAF once caught up with the target', () => {
    const { result, rerender } = renderHook(
      ({ target, active }: { target: string; active: boolean }) =>
        useSmoothStreamText(target, active),
      { initialProps: { target: '', active: true } },
    )

    act(() => {
      rerender({ target: 'hello world stream', active: true })
    })
    expect(rafCallbacks.length).toBeGreaterThan(0)
    act(() => flushFrames(80))
    expect(result.current).toBe('hello world stream')
    expect(rafCallbacks.length).toBe(0)

    act(() => {
      rerender({ target: 'hello world stream continues', active: true })
    })
    expect(rafCallbacks.length).toBeGreaterThan(0)
    act(() => flushFrames(80))
    expect(result.current).toBe('hello world stream continues')
    expect(rafCallbacks.length).toBe(0)
  })

  it('reveals at a wall-clock rate, not per frame', () => {
    const target = 'x'.repeat(2000)
    const { result, rerender } = renderHook(
      ({ target, active }: { target: string; active: boolean }) =>
        useSmoothStreamText(target, active),
      { initialProps: { target: '', active: true } },
    )
    act(() => rerender({ target, active: true }))
    // Two 16ms frames reveal about the same as one 32ms frame.
    act(() => flushFrames(2, 16))
    const afterTwoShort = result.current.length
    act(() => rerender({ target: '', active: true }))
    act(() => rerender({ target, active: true }))
    act(() => flushFrames(1, 32))
    const afterOneLong = result.current.length
    expect(Math.abs(afterTwoShort - afterOneLong)).toBeLessThanOrEqual(2)
    expect(afterTwoShort).toBeGreaterThan(0)
  })

  it('never exceeds the ceiling under a normal burst', () => {
    const target = 'a'.repeat(SMOOTH_STREAM.burstBacklog)
    const { result, rerender } = renderHook(
      ({ target, active }: { target: string; active: boolean }) =>
        useSmoothStreamText(target, active),
      { initialProps: { target: '', active: true } },
    )
    act(() => rerender({ target, active: true }))
    act(() => flushFrames(1, 16))
    const perFrameCap = Math.ceil((SMOOTH_STREAM.maxCps * 16) / 1000) + 1
    expect(result.current.length).toBeLessThanOrEqual(perFrameCap)
  })

  it('finishes the queued tail when the stream ends instead of snapping', () => {
    const target = 'the final sentence lands without a jump'
    const { result, rerender } = renderHook(
      ({ target, active }: { target: string; active: boolean }) =>
        useSmoothStreamText(target, active),
      { initialProps: { target: '', active: true } },
    )
    act(() => rerender({ target, active: true }))
    act(() => flushFrames(1, 16))
    expect(result.current.length).toBeLessThan(target.length)

    act(() => rerender({ target, active: false }))
    // Not snapped yet: the tail still drains.
    expect(result.current.length).toBeLessThan(target.length)
    act(() => flushFrames(10, 16))
    expect(result.current).toBe(target)
    expect(rafCallbacks.length).toBe(0)
  })

  it('shows the full target immediately when inactive', () => {
    const { result } = renderHook(() => useSmoothStreamText('done', false))
    expect(result.current).toBe('done')
    expect(rafCallbacks.length).toBe(0)
  })
})
