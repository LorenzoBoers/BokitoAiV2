/**
 * Frontend playback that follows a backend text buffer.
 *
 * Incoming chunks only fill the buffer. The view grows at a cruise (slightly
 * slower than a typical model), breathes with deterministic jitter, and pauses
 * at a short lead while live. When the stream ends, the leftover drains on a
 * short horizon — never a dump.
 *
 * Token ≈ 4 characters (EN/NL mix). Framework-agnostic: dashboard wraps this
 * in a React hook; the chat widget drives it from rAF.
 */

export const SMOOTH_STREAM = {
  charsPerToken: 4,
  /** Mean live playback. Below a typical model so the view stays behind. */
  cruiseTps: 30,
  /** Floor for the post-stream drain of a short tail. */
  finishMinTps: 28,
  /** Ceiling when a large leftover remains after the model stops. */
  finishMaxTps: 52,
  /** Aim to empty a large leftover within this horizon once the turn ended. */
  finishHorizonMs: 1600,
  /** Stay at most this far behind a large live buffer. */
  leadChars: 16,
  /** Always keep at least this many live chars unpublished (the brake). */
  minBrakeChars: 2,
  /** Live lead is this fraction of the buffer, until `leadChars`. */
  leadRatio: 0.16,
  /** Brief wait so the first glyph is not a single-letter flash. */
  startDelayMs: 28,
  /** Frame gap cap: a background tab must not dump the buffer. */
  maxFrameMs: 50,
  /**
   * Peak relative swing around the mean cruise (±). Two sines keep it
   * irregular without RNG (tests stay stable).
   */
  jitterAmp: 0.32,
} as const

function tpsToCps(tps: number): number {
  return tps * SMOOTH_STREAM.charsPerToken
}

export const SMOOTH_STREAM_CPS = {
  cruiseCps: tpsToCps(SMOOTH_STREAM.cruiseTps),
  finishMinCps: tpsToCps(SMOOTH_STREAM.finishMinTps),
  finishMaxCps: tpsToCps(SMOOTH_STREAM.finishMaxTps),
  /** Live per-frame ceiling including jitter (tests). */
  cruiseMaxCps: tpsToCps(SMOOTH_STREAM.cruiseTps) * (1 + SMOOTH_STREAM.jitterAmp),
  /** Alias used by older tests that called the live ceiling `maxCps`. */
  maxCps: tpsToCps(SMOOTH_STREAM.cruiseTps) * (1 + SMOOTH_STREAM.jitterAmp),
  minCps: tpsToCps(SMOOTH_STREAM.cruiseTps) * (1 - SMOOTH_STREAM.jitterAmp),
  finishCps: tpsToCps(SMOOTH_STREAM.finishMinTps),
} as const

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/**
 * How far the view may go. Live: stay a short lead behind the buffer so a
 * catch-up pauses instead of locking to network cadence. Finished: the
 * whole buffer is playable.
 */
export function revealLimit(bufferLength: number, holdLead: boolean): number {
  if (!holdLead || bufferLength <= 0) return bufferLength
  const tail = Math.min(
    SMOOTH_STREAM.leadChars,
    Math.max(SMOOTH_STREAM.minBrakeChars, Math.floor(bufferLength * SMOOTH_STREAM.leadRatio)),
  )
  return bufferLength > 0 ? Math.max(1, bufferLength - tail) : 0
}

/**
 * Relative speed multiplier for this frame. Overlapping sines breathe the
 * rate so bursts and dips feel typed, not metronomic.
 */
export function streamRateJitter(nowMs: number): number {
  const amp = SMOOTH_STREAM.jitterAmp
  if (amp <= 0) return 1
  const wave =
    1 +
    amp * Math.sin(nowMs * 0.0053) +
    amp * 0.55 * Math.sin(nowMs * 0.0121 + 1.37)
  return clamp(wave, 1 - amp, 1 + amp)
}

/**
 * Character rate for this frame. Live: mean cruise (caller applies jitter).
 * Ended: drain the leftover on a short horizon, still bounded so it never dumps.
 */
export function smoothStreamRate(backlog: number, active: boolean): number {
  const p = SMOOTH_STREAM
  if (active) return tpsToCps(p.cruiseTps)
  const finishMin = tpsToCps(p.finishMinTps)
  const finishMax = tpsToCps(p.finishMaxTps)
  return clamp((Math.max(backlog, 1) * 1000) / p.finishHorizonMs, finishMin, finishMax)
}

export type RevealCapFn = (
  source: string,
  from: number,
  want: number,
  hardCap: number,
  holdIncomplete: boolean,
) => number

/** Default: reveal exactly `want` chars (no chip holding). */
export function plainRevealCap(
  source: string,
  from: number,
  want: number,
  hardCap: number,
  _holdIncomplete: boolean,
): number {
  return Math.min(Math.max(want, from), Math.min(hardCap, source.length))
}

export type SmoothStreamAdvanceInput = {
  goal: string
  prev: string
  active: boolean
  holdLead: boolean
  nowMs: number
  lastMs: number
  startedAtMs: number | null
  carry: number
  reduceMotion?: boolean
  /** Optional atomic chip reveal (dashboard ChatText). */
  capLength?: RevealCapFn
}

export type SmoothStreamAdvanceResult = {
  visible: string
  startedAtMs: number | null
  carry: number
  lastMs: number
  /** True when prev was reset because goal no longer extends it. */
  reset: boolean
}

/**
 * One frame of smooth reveal. Pure: callers own rAF and React/DOM state.
 */
export function advanceSmoothStream(input: SmoothStreamAdvanceInput): SmoothStreamAdvanceResult {
  const {
    goal,
    prev,
    active,
    holdLead,
    nowMs,
    lastMs,
    carry: carryIn,
    reduceMotion = false,
    capLength = plainRevealCap,
  } = input
  let startedAtMs = input.startedAtMs
  let carry = carryIn
  const last = nowMs

  if (reduceMotion) {
    return { visible: goal, startedAtMs, carry: 0, lastMs: last, reset: false }
  }

  if (!goal.startsWith(prev) && prev.length > 0) {
    return {
      visible: '',
      startedAtMs: nowMs,
      carry: 0,
      lastMs: last,
      reset: true,
    }
  }

  if (startedAtMs == null && goal.length > 0) {
    startedAtMs = nowMs
  }

  const dt = Math.min(Math.max(nowMs - lastMs, 0), SMOOTH_STREAM.maxFrameMs)
  const cap = revealLimit(goal.length, holdLead)
  const backlog = cap - prev.length
  if (backlog <= 0) {
    return { visible: prev, startedAtMs, carry, lastMs: last, reset: false }
  }
  if (startedAtMs != null && nowMs - startedAtMs < SMOOTH_STREAM.startDelayMs) {
    return { visible: prev, startedAtMs, carry, lastMs: last, reset: false }
  }

  const baseRate = smoothStreamRate(backlog, active) * streamRateJitter(nowMs)
  const trail = prev[prev.length - 1]
  const pause =
    trail === '.' || trail === '!' || trail === '?' || trail === '\n'
      ? 0.42
      : trail === ',' || trail === ';' || trail === ':'
        ? 0.72
        : 1
  const step = (baseRate * pause * dt) / 1000 + carry
  const chars = Math.floor(step)
  carry = step - chars
  if (chars <= 0) {
    return { visible: prev, startedAtMs, carry, lastMs: last, reset: false }
  }

  const hardCap = prev.length + backlog
  const cruiseEnd = prev.length + Math.min(chars, backlog)
  const capped = capLength(goal, prev.length, cruiseEnd, hardCap, active)
  if (capped <= prev.length) {
    return { visible: prev, startedAtMs, carry, lastMs: last, reset: false }
  }
  return {
    visible: goal.slice(0, capped),
    startedAtMs,
    carry,
    lastMs: last,
    reset: false,
  }
}

/** Mutable controller for vanilla DOM (chat widget). */
export class SmoothStreamController {
  target = ''
  visible = ''
  active = true
  holdLead = true
  startedAtMs: number | null = null
  carry = 0
  lastMs = 0
  reduceMotion = false
  capLength: RevealCapFn = plainRevealCap

  setTarget(next: string) {
    this.target = next
  }

  setActive(active: boolean, holdLead = active) {
    this.active = active
    this.holdLead = holdLead
  }

  reset() {
    this.target = ''
    this.visible = ''
    this.startedAtMs = null
    this.carry = 0
    this.lastMs = 0
  }

  tick(nowMs: number): string {
    if (!this.lastMs) this.lastMs = nowMs
    const result = advanceSmoothStream({
      goal: this.target,
      prev: this.visible,
      active: this.active,
      holdLead: this.holdLead,
      nowMs,
      lastMs: this.lastMs,
      startedAtMs: this.startedAtMs,
      carry: this.carry,
      reduceMotion: this.reduceMotion,
      capLength: this.capLength,
    })
    this.visible = result.visible
    this.startedAtMs = result.startedAtMs
    this.carry = result.carry
    this.lastMs = result.lastMs
    return this.visible
  }

  get caughtUp(): boolean {
    return this.target.length === 0 || this.visible.length >= this.target.length
  }
}
