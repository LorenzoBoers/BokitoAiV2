/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSmoothStreamText } from './useSmoothStreamText'

describe('useSmoothStreamText', () => {
  let rafCallbacks: FrameRequestCallback[]

  beforeEach(() => {
    rafCallbacks = []
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
  })

  function flushFrames(n = 5) {
    for (let i = 0; i < n; i++) {
      const cbs = [...rafCallbacks]
      rafCallbacks = []
      for (const cb of cbs) cb(performance.now())
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

  it('shows the full target immediately when inactive', () => {
    const { result } = renderHook(() => useSmoothStreamText('done', false))
    expect(result.current).toBe('done')
    expect(rafCallbacks.length).toBe(0)
  })
})
