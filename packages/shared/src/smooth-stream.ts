/**
 * Frontend playback that follows a backend text buffer.
 *
 * Incoming chunks only fill the buffer. Each frame reveals graphemes between
 * a floor (never a frozen frame while text is already waiting) and a cap
 * (a chunk never lands in one paint). The rate rises with the backlog up to
 * that cap. When the stream ends, the leftover drains inside the same cap.
 *
 * Token ≈ 4 characters (EN/NL mix). Framework-agnostic: dashboard wraps this
 * in a React hook; the chat widget drives it from rAF.
 */

export const SMOOTH_STREAM = {
  charsPerToken: 4,
  /** Glow reference only (1 = a steady type). Playback uses the horizon band. */
  cruiseTps: 30,
  /** Live rate aims to clear the waiting buffer in about this long, then clamps. */
  liveHorizonMs: 220,
  /** Floor while text is waiting. A frame still shows at least one grapheme. */
  liveMinCps: 48,
  /** Ceiling. The per-frame grapheme cap is what stops a chunk from landing at once. */
  liveMaxCps: 420,
  /** Base graphemes in a 16ms frame. Grows with backlog so a long buffer does not stall. */
  maxCharsPerFrame: 6,
  /** Extra graphemes allowed per ~80 waiting chars, up to ``maxCharsPerFrameBurst``. */
  backlogCharsPerExtra: 80,
  maxCharsPerFrameBurst: 18,
  /** Floor for the post-stream drain of a short tail. */
  finishMinCps: 64,
  /** Ceiling once the model has stopped. Still inside the per-frame cap. */
  finishMaxCps: 420,
  /** Aim to empty a leftover within this horizon once the turn ended. */
  finishHorizonMs: 560,
  /** No hidden lead: unpublished text in the buffer keeps moving. */
  leadChars: 0,
  minBrakeChars: 0,
  leadRatio: 0,
  /** Brief wait so the first glyph is not a single-letter flash. */
  startDelayMs: 12,
  /** Frame gap cap: a background tab must not dump the buffer. */
  maxFrameMs: 40,
  /** Kept at 0. Playback is a min/max band, not a breathing cruise. */
  jitterAmp: 0,
} as const

function tpsToCps(tps: number): number {
  return tps * SMOOTH_STREAM.charsPerToken
}

export const SMOOTH_STREAM_CPS = {
  /** Glow reference: reveal rate ÷ this is 1 at a steady type. */
  cruiseCps: tpsToCps(SMOOTH_STREAM.cruiseTps),
  liveMinCps: SMOOTH_STREAM.liveMinCps,
  liveMaxCps: SMOOTH_STREAM.liveMaxCps,
  finishMinCps: SMOOTH_STREAM.finishMinCps,
  finishMaxCps: SMOOTH_STREAM.finishMaxCps,
  /** Alias used by older tests that called the live ceiling `maxCps`. */
  cruiseMaxCps: SMOOTH_STREAM.liveMaxCps,
  maxCps: SMOOTH_STREAM.liveMaxCps,
  minCps: SMOOTH_STREAM.liveMinCps,
  finishCps: SMOOTH_STREAM.finishMinCps,
} as const

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/**
 * How far the view may go. The whole buffer is playable: a hidden lead made
 * the caret freeze while text was already waiting. `holdLead` still reserves
 * a tail when `leadChars` is set above 0.
 */
export function revealLimit(bufferLength: number, holdLead: boolean): number {
  if (!holdLead || bufferLength <= 0) return bufferLength
  const tail = Math.min(
    SMOOTH_STREAM.leadChars,
    Math.max(SMOOTH_STREAM.minBrakeChars, Math.floor(bufferLength * SMOOTH_STREAM.leadRatio)),
  )
  if (tail <= 0) return bufferLength
  return Math.max(1, bufferLength - tail)
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
 * Character rate for this frame. Live and finished both follow
 * backlog / horizon, clamped so a short gap does not freeze and a large
 * chunk does not set an unbounded rate. The per-frame grapheme cap is the
 * hard stop.
 */
export function smoothStreamRate(backlog: number, active: boolean): number {
  const waiting = Math.max(backlog, 1)
  if (active) {
    return clamp((waiting * 1000) / SMOOTH_STREAM.liveHorizonMs, SMOOTH_STREAM.liveMinCps, SMOOTH_STREAM.liveMaxCps)
  }
  return clamp(
    (waiting * 1000) / SMOOTH_STREAM.finishHorizonMs,
    SMOOTH_STREAM.finishMinCps,
    SMOOTH_STREAM.finishMaxCps,
  )
}

/** Advance `count` graphemes without splitting a character. */
function revealEnd(source: string, from: number, count: number, hard: number): number {
  const limit = Math.min(Math.max(hard, from), source.length)
  if (from >= limit || count <= 0) return from
  const windowEnd = Math.min(limit, from + count * 8 + 8)
  const slice = source.slice(from, windowEnd)
  const SegmenterCtor = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (!SegmenterCtor) {
    let end = Math.min(from + count, limit)
    const prev = source.charCodeAt(end - 1)
    if (end < limit && prev >= 0xd800 && prev <= 0xdbff) end += 1
    return end
  }
  const segmenter = new SegmenterCtor(undefined, { granularity: 'grapheme' })
  let taken = 0
  let end = from
  for (const part of segmenter.segment(slice)) {
    const next = from + part.index + part.segment.length
    if (next > limit) break
    end = next
    taken += 1
    if (taken >= count) break
  }
  return end > from ? end : Math.min(from + 1, limit)
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
    // A server rewrite keeps what both texts share; only the changed tail
    // is typed again. A shrink (stripping a canvas dump) lands at once —
    // retyping from the shared prefix read as the bubble starting over.
    let shared = 0
    const max = Math.min(goal.length, prev.length)
    while (shared < max && goal.charCodeAt(shared) === prev.charCodeAt(shared)) shared += 1
    const shrunk = goal.length < prev.length && goal.length <= shared + 24
    return {
      visible: shrunk ? goal : goal.slice(0, shared),
      startedAtMs: input.startedAtMs ?? nowMs,
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

  const baseRate = smoothStreamRate(backlog, active)
  const step = (baseRate * dt) / 1000 + carry
  let chars = Math.floor(step)
  carry = step - chars
  // Floor: one grapheme whenever text is already waiting, so the caret
  // cannot sit still between chunks. Cap: a long frame cannot empty the buffer.
  if (chars < 1) {
    if (backlog > 0 && dt > 0) {
      chars = 1
      carry = 0
    } else {
      return { visible: prev, startedAtMs, carry, lastMs: last, reset: false }
    }
  }
  const extras = Math.floor(backlog / SMOOTH_STREAM.backlogCharsPerExtra)
  const perFrame = Math.min(
    SMOOTH_STREAM.maxCharsPerFrameBurst,
    SMOOTH_STREAM.maxCharsPerFrame + extras,
  )
  const frameCap = Math.max(1, Math.round((perFrame * dt) / 16))
  if (chars > frameCap) {
    chars = frameCap
    carry = 0
  }
  chars = Math.min(chars, backlog)

  const hardCap = prev.length + backlog
  const cruiseEnd = revealEnd(goal, prev.length, chars, hardCap)
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
