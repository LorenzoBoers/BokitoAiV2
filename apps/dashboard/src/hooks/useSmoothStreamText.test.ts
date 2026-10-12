/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SMOOTH_STREAM,
  SMOOTH_STREAM_CPS,
  revealLimit,
  smoothStreamRate,
  useSmoothStreamText,
} from './useSmoothStreamText'

describe('smoothStreamRate', () => {
  it('stays at the cruise while the turn is live, regardless of backlog', () => {
    expect(smoothStreamRate(5, true)).toBe(SMOOTH_STREAM_CPS.cruiseCps)
    expect(smoothStreamRate(400, true)).toBe(SMOOTH_STREAM_CPS.cruiseCps)
    expect(smoothStreamRate(4000, true)).toBe(SMOOTH_STREAM_CPS.cruiseCps)
  })

  it('drains the leftover on a horizon after the turn ended', () => {
    expect(smoothStreamRate(40, false)).toBe(SMOOTH_STREAM_CPS.finishMinCps)
    const mid = (800 * 1000) / SMOOTH_STREAM.finishHorizonMs
    expect(smoothStreamRate(800, false)).toBeCloseTo(
      Math.min(SMOOTH_STREAM_CPS.finishMaxCps, Math.max(SMOOTH_STREAM_CPS.finishMinCps, mid)),
    )
  })
})

describe('revealLimit', () => {
  it('starts immediately on a short live buffer and stays a lead behind', () => {
    expect(revealLimit(0, true)).toBe(0)
    expect(revealLimit(2, true)).toBe(1)
    expect(revealLimit(3, true)).toBe(1)
    expect(revealLimit(10, true)).toBeGreaterThan(0)
    expect(revealLimit(10, true)).toBeLessThan(10)
    expect(revealLimit(100, true)).toBe(100 - SMOOTH_STREAM.leadChars)
    expect(revealLimit(100, false)).toBe(100)
  })
})

describe('useSmoothStreamText', () => {
  let rafCallbacks: FrameRequestCallback[]
  let clock: number

  beforeEach(() => {
    rafCallbacks = []
    clock = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
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

  function flushFrames(n = 5, frameMs = 16) {
    for (let i = 0; i < n; i++) {
      clock += frameMs
      const cbs = [...rafCallbacks]
      rafCallbacks = []
      for (const cb of cbs) cb(clock)
    }
  }

  it('reveals at a wall-clock cruise, not per incoming chunk', () => {
    const target = 'x'.repeat(2000)
    const { result, rerender } = renderHook(
      ({ target, active }: { target: string; active: boolean }) =>
        useSmoothStreamText(target, active),
      { initialProps: { target: '', active: true } },
    )
    const warmup = Math.ceil(SMOOTH_STREAM.startDelayMs / 16) + 1
    act(() => rerender({ target, active: true }))
    act(() => flushFrames(warmup, 16))
    const afterWarmup = result.current.length
    act(() => flushFrames(2, 16))
    const afterTwoShort = result.current.length - afterWarmup
    act(() => rerender({ target: '', active: true }))
    act(() => rerender({ target, active: true }))
    act(() => flushFrames(warmup, 16))
    const afterWarmup2 = result.current.length
    act(() => flushFrames(1, 32))
    const afterOneLong = result.current.length - afterWarmup2
    expect(afterTwoShort).toBeGreaterThan(0)
    expect(Math.abs(afterTwoShort - afterOneLong)).toBeLessThanOrEqual(2)
  })

  it('never exceeds the cruise in one live frame, even after a huge chunk', () => {
    const target = 'a'.repeat(2000)
    const { result, rerender } = renderHook(
      ({ target, active }: { target: string; active: boolean }) =>
        useSmoothStreamText(target, active),
      { initialProps: { target: '', active: true } },
    )
    act(() => rerender({ target, active: true }))
    act(() => flushFrames(8, 16))
    const before = result.current.length
    act(() => flushFrames(1, 16))
    const perFrameCap = Math.ceil((SMOOTH_STREAM_CPS.cruiseCps * 16) / 1000) + 1
    expect(result.current.length - before).toBeLessThanOrEqual(perFrameCap)
  })

  it('starts as soon as the first characters arrive, not after a full sentence', () => {
    const { result, rerender } = renderHook(
      ({ target, active }: { target: string; active: boolean }) =>
        useSmoothStreamText(target, active),
      { initialProps: { target: '', active: true } },
    )
    act(() => rerender({ target: 'Hi', active: true }))
    act(() => flushFrames(8, 16))
    expect(result.current.length).toBeGreaterThan(0)
    expect(result.current.length).toBeLessThanOrEqual('Hi'.length)
  })

  it('pauses when it catches the live lead, then continues when the buffer grows', () => {
    const { result, rerender } = renderHook(
      ({ target, active }: { target: string; active: boolean }) =>
        useSmoothStreamText(target, active),
      { initialProps: { target: '', active: true } },
    )
    const first = 'abcdefghij'
    act(() => rerender({ target: first, active: true }))
    act(() => flushFrames(80, 16))
    const paused = result.current.length
    expect(paused).toBe(revealLimit(first.length, true))
    expect(paused).toBeLessThan(first.length)

    const next = `${first} more text behind the stream`
    act(() => rerender({ target: next, active: true }))
    act(() => flushFrames(4, 16))
    expect(result.current.length).toBeGreaterThan(paused)
    expect(result.current.length).toBeLessThanOrEqual(revealLimit(next.length, true))
  })

  it('holds the lead while live so a network pause does not empty the view', () => {
    const target = 'abcdefghijklmnopqrstuvwxyz0123456789MORE'
    const { result, rerender } = renderHook(
      ({ target, active }: { target: string; active: boolean }) =>
        useSmoothStreamText(target, active),
      { initialProps: { target: '', active: true } },
    )
    act(() => rerender({ target, active: true }))
    act(() => flushFrames(200, 16))
    expect(result.current.length).toBe(revealLimit(target.length, true))
    expect(result.current.length).toBeLessThan(target.length)
  })

  it('finishes the queued tail when the stream ends instead of snapping', () => {
    const target = 'the final sentence lands without a jump and a bit more text'
    const { result, rerender } = renderHook(
      ({ target, active }: { target: string; active: boolean }) =>
        useSmoothStreamText(target, active),
      { initialProps: { target: '', active: true } },
    )
    act(() => rerender({ target, active: true }))
    act(() => flushFrames(20, 16))
    expect(result.current.length).toBeGreaterThan(0)
    expect(result.current.length).toBeLessThan(target.length)

    act(() => rerender({ target, active: false }))
    expect(result.current.length).toBeLessThan(target.length)
    act(() => flushFrames(80, 16))
    expect(result.current).toBe(target)
  })

  it('plays an already-finished target instead of snapping it in', () => {
    const target = 'done already but still revealed at cruise'
    const { result } = renderHook(() => useSmoothStreamText(target, false))
    expect(result.current).toBe('')
    act(() => flushFrames(8, 16))
    expect(result.current.length).toBeGreaterThan(0)
    expect(result.current.length).toBeLessThan(target.length)
    act(() => flushFrames(80, 16))
    expect(result.current).toBe(target)
  })

  it('keeps cruising when the turn ends before the first glyph', () => {
    const target = 'short reply that finished in one flush'
    const { result, rerender } = renderHook(
      ({ target, active }: { target: string; active: boolean }) =>
        useSmoothStreamText(target, active),
      { initialProps: { target: '', active: true } },
    )
    act(() => rerender({ target, active: false }))
    expect(result.current).toBe('')
    act(() => flushFrames(8, 16))
    expect(result.current.length).toBeGreaterThan(0)
    expect(result.current.length).toBeLessThan(target.length)
    act(() => flushFrames(80, 16))
    expect(result.current).toBe(target)
  })
})
