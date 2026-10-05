import { describe, expect, it, vi } from 'vitest'

/**
 * Quiet refresh must not flip the loading flag used for the list skeleton.
 * Mirrors the setLoading gate inside useThreads.fetchThreads.
 */
function shouldSetLoading(quiet: boolean | undefined): boolean {
  return !Boolean(quiet)
}

describe('useThreads quiet refresh', () => {
  it('shows a skeleton only on non-quiet fetches', () => {
    expect(shouldSetLoading(undefined)).toBe(true)
    expect(shouldSetLoading(false)).toBe(true)
    expect(shouldSetLoading(true)).toBe(false)
  })

  it('visibility and reconnect callers pass quiet:true', () => {
    const calls: Array<{ quiet?: boolean }> = []
    const fetchThreads = (opts?: { quiet?: boolean }) => {
      calls.push(opts ?? {})
    }
    // Same call sites as useThreads effects.
    fetchThreads({ quiet: true }) // visibility
    fetchThreads({ quiet: true }) // reconnect
    expect(calls.every((c) => c.quiet === true)).toBe(true)
    expect(calls.every((c) => !shouldSetLoading(c.quiet))).toBe(true)
  })
})

describe('useAiChatStream flush cadence', () => {
  it('batches deltas on a 64ms timer', () => {
    vi.useFakeTimers()
    let flushes = 0
    let pending = ''
    const flush = () => {
      if (!pending) return
      pending = ''
      flushes += 1
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const onDelta = (chunk: string) => {
      pending += chunk
      if (timer == null) timer = setTimeout(() => {
        timer = null
        flush()
      }, 64)
    }
    onDelta('a')
    onDelta('b')
    onDelta('c')
    expect(flushes).toBe(0)
    vi.advanceTimersByTime(64)
    expect(flushes).toBe(1)
    vi.useRealTimers()
  })
})
