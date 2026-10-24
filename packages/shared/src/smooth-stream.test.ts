import { describe, expect, it } from 'vitest'
import {
  SMOOTH_STREAM,
  SMOOTH_STREAM_CPS,
  SmoothStreamController,
  advanceSmoothStream,
  revealLimit,
  smoothStreamRate,
  streamRateJitter,
} from './smooth-stream.js'

describe('smoothStreamRate', () => {
  it('stays inside the live band and speeds up with the backlog', () => {
    expect(smoothStreamRate(1, true)).toBe(SMOOTH_STREAM_CPS.liveMinCps)
    expect(smoothStreamRate(4000, true)).toBe(SMOOTH_STREAM_CPS.liveMaxCps)
    const mid = smoothStreamRate(20, true)
    expect(mid).toBeGreaterThan(SMOOTH_STREAM_CPS.liveMinCps)
    expect(mid).toBeLessThan(SMOOTH_STREAM_CPS.liveMaxCps)
  })

  it('drains leftover after the turn ends, still bounded', () => {
    const small = smoothStreamRate(4, false)
    expect(small).toBe(SMOOTH_STREAM_CPS.finishMinCps)
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
    expect(revealLimit(10, true)).toBe(10)
    expect(revealLimit(100, true)).toBe(100)
    expect(revealLimit(100, false)).toBe(100)
  })
})

describe('advanceSmoothStream', () => {
  it('reveals gradually then catches up when the lead is released', () => {
    const goal = 'a'.repeat(80)
    let visible = ''
    let startedAtMs: number | null = null
    let carry = 0
    let lastMs = 1000
    let nowMs = 1000

    const step = (active: boolean, holdLead: boolean, dt: number) => {
      nowMs += dt
      const result = advanceSmoothStream({
        goal,
        prev: visible,
        active,
        holdLead,
        nowMs,
        lastMs,
        startedAtMs,
        carry,
      })
      visible = result.visible
      startedAtMs = result.startedAtMs
      carry = result.carry
      lastMs = result.lastMs
    }

    step(true, true, 16) // start clock
    step(true, true, SMOOTH_STREAM.startDelayMs + 16)
    expect(visible.length).toBeGreaterThan(0)
    expect(visible.length).toBeLessThan(goal.length)

    for (let i = 0; i < 120; i++) step(false, false, 16)
    expect(visible).toBe(goal)
  })

  it('falls back to the shared prefix when the goal no longer extends the visible text', () => {
    const result = advanceSmoothStream({
      goal: 'Ik begin met het dashboard.',
      prev: 'Ik begin met het bouwen van',
      active: true,
      holdLead: true,
      nowMs: 2000,
      lastMs: 1984,
      startedAtMs: 1000,
      carry: 0.5,
    })
    expect(result.visible).toBe('Ik begin met het ')
    expect(result.reset).toBe(true)
  })

  it('snaps when the server shrinks a long dump to a short sentence', () => {
    const result = advanceSmoothStream({
      goal: 'Het canvas staat naast dit bericht.',
      prev: 'Het canvas staat naast dit bericht.\n\n```json\n{"blocks":[]}\n```',
      active: true,
      holdLead: false,
      nowMs: 2000,
      lastMs: 1984,
      startedAtMs: 1000,
      carry: 0,
    })
    expect(result.visible).toBe('Het canvas staat naast dit bericht.')
    expect(result.reset).toBe(true)
  })

  it('clears only when nothing is shared', () => {
    const result = advanceSmoothStream({
      goal: 'new text',
      prev: 'old',
      active: true,
      holdLead: true,
      nowMs: 2000,
      lastMs: 1984,
      startedAtMs: 1000,
      carry: 0,
    })
    expect(result.visible).toBe('')
  })
})

describe('SmoothStreamController', () => {
  it('accumulates target and ticks toward it', () => {
    const ctrl = new SmoothStreamController()
    ctrl.setTarget('Hello world from Bokito')
    ctrl.setActive(true, true)
    let now = 1000
    ctrl.tick(now)
    now += SMOOTH_STREAM.startDelayMs + 16
    const mid = ctrl.tick(now)
    expect(mid.length).toBeGreaterThan(0)
    expect(mid.length).toBeLessThan(ctrl.target.length)
    ctrl.setActive(false, false)
    for (let i = 0; i < 60; i++) {
      now += 16
      ctrl.tick(now)
    }
    expect(ctrl.visible).toBe(ctrl.target)
    expect(ctrl.caughtUp).toBe(true)
  })
})
