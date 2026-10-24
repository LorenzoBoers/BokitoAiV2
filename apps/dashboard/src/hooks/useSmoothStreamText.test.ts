/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SMOOTH_STREAM,
  SMOOTH_STREAM_CPS,
  revealLimit,
  smoothStreamRate,
  streamRateJitter,
  useSmoothStreamText,
} from './useSmoothStreamText'

describe('smoothStreamRate', () => {
  it('stays inside the live band and speeds up with the backlog', () => {
    expect(smoothStreamRate(1, true)).toBe(SMOOTH_STREAM_CPS.liveMinCps)
    expect(smoothStreamRate(4000, true)).toBe(SMOOTH_STREAM_CPS.liveMaxCps)
    const mid = smoothStreamRate(20, true)
    expect(mid).toBeGreaterThan(SMOOTH_STREAM_CPS.liveMinCps)
    expect(mid).toBeLessThan(SMOOTH_STREAM_CPS.liveMaxCps)
  })

  it('drains the leftover on a horizon after the turn ended', () => {
    expect(smoothStreamRate(4, false)).toBe(SMOOTH_STREAM_CPS.finishMinCps)
    const mid = (80 * 1000) / SMOOTH_STREAM.finishHorizonMs
    expect(smoothStreamRate(80, false)).toBeCloseTo(
      Math.min(SMOOTH_STREAM_CPS.finishMaxCps, Math.max(SMOOTH_STREAM_CPS.finishMinCps, mid)),
    )
    expect(smoothStreamRate(8000, false)).toBe(SMOOTH_STREAM_CPS.finishMaxCps)
  })
})

describe('streamRateJitter', () => {
  it('stays within the configured amplitude', () => {
    for (let t = 0; t < 5000; t += 37) {
      const j = streamRateJitter(t)
      expect(j).toBeGreaterThanOrEqual(1 - SMOOTH_STREAM.jitterAmp)
      expect(j).toBeLessThanOrEqual(1 + SMOOTH_STREAM.jitterAmp)
    }
  })
})

describe('revealLimit', () => {
  it('plays the whole buffer so waiting text cannot sit hidden', () => {
    expect(revealLimit(0, true)).toBe(0)
    expect(revealLimit(2, true)).toBe(2)
    expect(revealLimit(10, true)).toBe(10)
    expect(revealLimit(100, true)).toBe(100)
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
    // Jitter breathes the rate; wall-clock still dominates over chunk size.
    expect(Math.abs(afterTwoShort - afterOneLong)).toBeLessThanOrEqual(6)
  })

  it('never exceeds the jittered cruise in one live frame, even after a huge chunk', () => {
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
    expect(result.current.length - before).toBeGreaterThan(0)
    expect(result.current.length - before).toBeLessThanOrEqual(SMOOTH_STREAM.maxCharsPerFrameBurst)
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

  it('keeps moving while text is waiting and does not dump a new chunk', () => {
    const { result, rerender } = renderHook(
      ({ target, active }: { target: string; active: boolean }) =>
        useSmoothStreamText(target, active),
      { initialProps: { target: '', active: true } },
    )
    const first = 'a'.repeat(400)
    act(() => rerender({ target: first, active: true }))
    act(() => flushFrames(6, 16))
    const mid = result.current.length
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(first.length)

    const next = first + 'b'.repeat(400)
    act(() => rerender({ target: next, active: true }))
    act(() => flushFrames(1, 16))
    const gained = result.current.length - mid
    expect(gained).toBeGreaterThan(0)
    expect(gained).toBeLessThanOrEqual(SMOOTH_STREAM.maxCharsPerFrameBurst)
    expect(result.current.length).toBeLessThan(next.length)
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

  it('holds incomplete chip markup then pops the chip in one update', () => {
    const prefix = 'Ask '
    const chip = '@[Support](agent:abc)'
    const suffix = ' for help'
    const { result, rerender } = renderHook(
      ({ target, active }: { target: string; active: boolean }) =>
        useSmoothStreamText(target, active, false),
      { initialProps: { target: '', active: true } },
    )

    act(() => rerender({ target: `${prefix}@[Sup`, active: true }))
    act(() => flushFrames(40, 16))
    expect(result.current).toBe(prefix)
    expect(result.current.includes('@[')).toBe(false)

    const snapshots: string[] = []
    act(() => rerender({ target: `${prefix}${chip}${suffix}`, active: true }))
    for (let i = 0; i < 60; i++) {
      act(() => flushFrames(1, 16))
      snapshots.push(result.current)
      if (result.current.includes(chip) || result.current.length >= prefix.length + chip.length) break
    }

    const withChip = snapshots.find((s) => s.includes(chip))
    expect(withChip).toBeTruthy()
    expect(withChip!.startsWith(`${prefix}${chip}`)).toBe(true)
    // No frame should have shown a partial @[…](…) token.
    for (const snap of snapshots) {
      if (snap.length <= prefix.length) continue
      if (snap.length < prefix.length + chip.length) {
        expect(snap.includes('@[')).toBe(false)
      }
    }
  })
})
