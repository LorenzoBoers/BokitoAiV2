/**
 * Spring rig + director for the bot orb face.
 *
 * Every channel is a damped spring (target, position, velocity), so moves
 * overshoot and settle like a cartoon instead of easing linearly. Scripts set
 * targets or kick velocities; the avatar steps the rig on rAF and paints the
 * frame. Expressions that change the eye shape (pill to happy arc) switch
 * behind a fast blink so the swap never shows.
 */

import type { BotOrbMotion, BotOrbOneShot } from './bot-orb-motion'

export type BotOrbFace =
  | 'neutral'
  | 'happy'
  | 'surprised'
  | 'sad'
  | 'sleepy'
  | 'squinted'
  | 'calm'
  | 'inspecting'
  | 'confused'
  | 'focused'

const CHANNELS = [
  'gx',
  'gy',
  'bx',
  'by',
  'br',
  'sx',
  'sy',
  'lid',
  'esx',
  'esy',
  'tl',
  'tr',
  'dyl',
  'dyr',
  'kl',
  'kr',
  'alpha',
] as const
export type RigChannel = (typeof CHANNELS)[number]
type Targets = Partial<Record<RigChannel, number>>

type Spring = { x: number; v: number; t: number; w: number; z: number }

const REST: Record<RigChannel, number> = {
  gx: 0,
  gy: 0,
  bx: 0,
  by: 0,
  br: 0,
  sx: 1,
  sy: 1,
  lid: 1,
  esx: 1,
  esy: 1,
  tl: 0,
  tr: 0,
  dyl: 0,
  dyr: 0,
  kl: 1,
  kr: 1,
  alpha: 1,
}

/** Angular frequency (rad/s) and damping ratio per channel. */
const TUNE: Record<RigChannel, [number, number]> = {
  gx: [30, 0.8],
  gy: [30, 0.8],
  bx: [12, 0.5],
  by: [13, 0.45],
  br: [11, 0.45],
  sx: [17, 0.32],
  sy: [17, 0.32],
  lid: [55, 0.85],
  esx: [22, 0.55],
  esy: [22, 0.55],
  tl: [18, 0.7],
  tr: [18, 0.7],
  dyl: [20, 0.7],
  dyr: [20, 0.7],
  kl: [20, 0.6],
  kr: [20, 0.6],
  alpha: [14, 1],
}

type FacePose = { esx: number; esy: number; tl: number; tr: number; dyl: number; dyr: number; kl: number; kr: number; arc: boolean }

const FACES: Record<BotOrbFace, FacePose> = {
  neutral: { esx: 1, esy: 1, tl: 0, tr: 0, dyl: 0, dyr: 0, kl: 1, kr: 1, arc: false },
  happy: { esx: 1, esy: 1, tl: 0, tr: 0, dyl: 0, dyr: 0, kl: 1, kr: 1, arc: true },
  surprised: { esx: 1.12, esy: 1.22, tl: 0, tr: 0, dyl: -0.8, dyr: -0.8, kl: 1, kr: 1, arc: false },
  sad: { esx: 1, esy: 0.8, tl: 14, tr: -14, dyl: 1.2, dyr: 1.2, kl: 1, kr: 1, arc: false },
  sleepy: { esx: 1.1, esy: 0.14, tl: 0, tr: 0, dyl: 2.2, dyr: 2.2, kl: 1, kr: 1, arc: false },
  squinted: { esx: 1.1, esy: 0.3, tl: 0, tr: 0, dyl: 0.6, dyr: 0.6, kl: 1, kr: 1, arc: false },
  calm: { esx: 1.06, esy: 0.74, tl: 0, tr: 0, dyl: 0.6, dyr: 0.6, kl: 1, kr: 1, arc: false },
  inspecting: { esx: 1, esy: 1, tl: 0, tr: 0, dyl: -0.4, dyr: 0.3, kl: 1.14, kr: 0.8, arc: false },
  confused: { esx: 1, esy: 1, tl: 0, tr: 10, dyl: -1.2, dyr: 1, kl: 1.08, kr: 0.72, arc: false },
  focused: { esx: 1.04, esy: 0.7, tl: 0, tr: 0, dyl: 0.4, dyr: 0.4, kl: 1, kr: 1, arc: false },
}

export type RigFrame = Record<RigChannel, number> & { arc: boolean; speed: number }

export class BotOrbRig {
  private ch = {} as Record<RigChannel, Spring>
  private timers = new Set<number>()
  arc = false
  face: BotOrbFace = 'neutral'
  onWake: (() => void) | null = null

  constructor() {
    for (const key of CHANNELS) {
      const [w, z] = TUNE[key]
      this.ch[key] = { x: REST[key], v: 0, t: REST[key], w, z }
    }
  }

  private wake() {
    this.onWake?.()
  }

  after(ms: number, fn: () => void) {
    this.later(ms, fn)
  }

  private later(ms: number, fn: () => void) {
    const id = window.setTimeout(() => {
      this.timers.delete(id)
      fn()
    }, ms)
    this.timers.add(id)
  }

  dispose() {
    for (const id of this.timers) window.clearTimeout(id)
    this.timers.clear()
    this.onWake = null
  }

  set(targets: Targets) {
    for (const [key, value] of Object.entries(targets) as [RigChannel, number][]) {
      this.ch[key].t = value
    }
    this.wake()
  }

  kick(velocities: Targets) {
    for (const [key, value] of Object.entries(velocities) as [RigChannel, number][]) {
      this.ch[key].v += value
    }
    this.wake()
  }

  /** Jump without motion (state resets, reduced motion). */
  snap(values: Targets) {
    for (const [key, value] of Object.entries(values) as [RigChannel, number][]) {
      const s = this.ch[key]
      s.x = value
      s.t = value
      s.v = 0
    }
    this.wake()
  }

  tune(channels: RigChannel[], w: number, z: number) {
    for (const key of channels) {
      this.ch[key].w = w
      this.ch[key].z = z
    }
  }

  resetTunes() {
    for (const key of CHANNELS) {
      const [w, z] = TUNE[key]
      this.ch[key].w = w
      this.ch[key].z = z
    }
  }

  /** Body and gaze home; keeps the face. */
  home() {
    this.set({ gx: 0, gy: 0, bx: 0, by: 0, br: 0, sx: 1, sy: 1, alpha: 1 })
  }

  blink(holdMs = 70) {
    this.ch.lid.t = 0.06
    this.wake()
    this.later(holdMs, () => {
      this.ch.lid.t = 1
      this.wake()
    })
  }

  /**
   * Move to a face. Shape changes (pill to arc) and `cut` close the lids
   * first, swap while closed, then reopen with a pop.
   */
  setFace(face: BotOrbFace, opts: { cut?: boolean; instant?: boolean } = {}) {
    const pose = FACES[face]
    this.face = face
    const { arc, ...rest } = pose
    if (opts.instant) {
      this.arc = arc
      this.snap(rest)
      return
    }
    if (arc !== this.arc || opts.cut) {
      this.ch.lid.t = 0.04
      this.wake()
      this.later(85, () => {
        this.arc = arc
        this.snap(rest)
        this.ch.lid.t = 1
        this.ch.lid.v += 9
        this.wake()
      })
      return
    }
    this.set(rest)
  }

  /** Per-eye size: the looking side squints while thinking. */
  setEyes(left: number, right: number) {
    this.set({ kl: left, kr: right })
  }

  /** Advance the springs. Returns true when everything is at rest. */
  step(dt: number): boolean {
    const sub = Math.max(1, Math.ceil(dt / (1 / 240)))
    const h = dt / sub
    let settled = true
    for (const key of CHANNELS) {
      const s = this.ch[key]
      for (let i = 0; i < sub; i++) {
        s.v += (-2 * s.z * s.w * s.v - s.w * s.w * (s.x - s.t)) * h
        s.x += s.v * h
      }
      if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) {
        s.x = s.t
        s.v = 0
      }
      if (Math.abs(s.x - s.t) > 1e-3 || Math.abs(s.v) > 1e-3) settled = false
      else {
        s.x = s.t
        s.v = 0
      }
    }
    return settled
  }

  frame(): RigFrame {
    const out = { arc: this.arc, speed: Math.hypot(this.ch.bx.v, this.ch.by.v) } as RigFrame
    for (const key of CHANNELS) out[key] = this.ch[key].x
    return out
  }
}

// -- director -------------------------------------------------------------

export type Gaze = { x: number; y: number }

export const GAZE_MAX_X = 9.2
export const GAZE_MAX_Y = 6.4

const LOOK_GAZE: Record<string, Gaze> = {
  left: { x: -5.4, y: 0 },
  right: { x: 5.4, y: 0 },
  up: { x: 0, y: -4.6 },
  down: { x: 0, y: 3.8 },
  upLeft: { x: -5.2, y: -3.2 },
  upRight: { x: 5.2, y: -3.2 },
  downLeft: { x: -5.2, y: 3.2 },
  downRight: { x: 5.2, y: 3.2 },
}

const LOOK_SEQS: string[][] = [
  ['left', 'upLeft'],
  ['right', 'upRight'],
  ['left', 'downLeft'],
  ['right', 'downRight'],
  ['left'],
  ['right'],
  ['down'],
  ['up'],
  ['left', 'right'],
]

export type DirectorCtx = {
  signal: AbortSignal
  size: number
  /** Pointer is near: the idle loop leaves the eyes to the cursor. */
  tracking: () => boolean
}

export function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    const id = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      window.clearTimeout(id)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

const rand = (min: number, max: number) => min + Math.random() * (max - min)
const pick = <T,>(rows: T[]): T => rows[Math.floor(Math.random() * rows.length)]!
const sign = () => (Math.random() < 0.5 ? -1 : 1)

/** Head follows the eyes a little: lean, tilt and lift from one gaze. */
function look(rig: BotOrbRig, g: Gaze, body = 1) {
  rig.set({ gx: g.x, gy: g.y, bx: g.x * 0.18 * body, by: g.y * 0.12 * body, br: g.x * 0.55 * body })
}

async function idleLoop(rig: BotOrbRig, ctx: DirectorCtx) {
  const { signal } = ctx
  rig.setFace('neutral')
  rig.home()
  let lastSeq = -1
  while (!signal.aborted) {
    await sleep(rand(1400, 4200), signal)
    const roll = Math.random()
    if (ctx.tracking() || ctx.size < 28 || roll < 0.34) {
      rig.blink()
      if (Math.random() < 0.25) {
        await sleep(170, signal)
        rig.blink()
      }
      continue
    }
    if (roll < 0.66) {
      let idx = Math.floor(Math.random() * LOOK_SEQS.length)
      if (idx === lastSeq) idx = (idx + 1) % LOOK_SEQS.length
      lastSeq = idx
      for (const step of LOOK_SEQS[idx]!) {
        look(rig, LOOK_GAZE[step]!)
        await sleep(rand(600, 1000), signal)
      }
      look(rig, { x: 0, y: 0 })
      if (Math.random() < 0.4) rig.blink()
      await sleep(260, signal)
    } else if (roll < 0.74) {
      rig.setFace('squinted')
      await sleep(900, signal)
      rig.setFace('neutral')
    } else if (roll < 0.85) {
      const side = sign()
      rig.setFace('inspecting')
      rig.set({ br: 7 * side, gx: 2.2 * side, gy: -1.6, by: -0.4 })
      await sleep(1300, signal)
      rig.setFace('neutral')
      rig.home()
    } else if (roll < 0.95) {
      rig.setFace('calm')
      rig.kick({ sy: -2.2, sx: 1.4 })
      await sleep(380, signal)
      rig.kick({ sy: -1.8, sx: 1.1 })
      await sleep(520, signal)
      rig.setFace('neutral')
    } else if (ctx.size >= 40) {
      rig.setFace('sleepy')
      rig.set({ sy: 1.08, sx: 0.95, by: -1, gy: -1 })
      await sleep(1000, signal)
      rig.setFace('neutral')
      rig.home()
      rig.kick({ sy: -1.6 })
    } else {
      rig.blink()
    }
  }
}

async function listeningLoop(rig: BotOrbRig, { signal }: DirectorCtx) {
  rig.setFace('calm')
  rig.set({ gx: 0, gy: 3.2, br: 5, by: 0.4, bx: 0, sx: 1, sy: 1 })
  while (!signal.aborted) {
    await sleep(rand(1100, 2400), signal)
    const roll = Math.random()
    if (roll < 0.45) {
      rig.set({ gy: 4.6, by: 1.2, sy: 0.97 })
      await sleep(180, signal)
      rig.set({ gy: 3.2, by: 0.4, sy: 1 })
    } else if (roll < 0.72) {
      rig.set({ gy: -0.5, br: 2 })
      await sleep(rand(700, 1100), signal)
      rig.set({ gy: 3.2, br: 5 })
    } else {
      rig.blink()
    }
  }
}

async function talkingLoop(rig: BotOrbRig, { signal }: DirectorCtx) {
  rig.setFace('neutral')
  rig.set({ gx: 0, gy: 0.6, bx: 0, br: 0 })
  while (!signal.aborted) {
    rig.set({ by: 0.7, sy: 0.97, gy: 1.4 })
    await sleep(130, signal)
    rig.set({ by: -0.35, sy: 1.02, gy: 0.1 })
    await sleep(150, signal)
    if (Math.random() < 0.14) rig.blink(50)
  }
}

async function thinkingLoop(rig: BotOrbRig, { signal }: DirectorCtx) {
  rig.setFace('calm')
  let last = 0
  while (!signal.aborted) {
    let side = pick([-1, 0, 1])
    if (side === last) side = side === 0 ? sign() : 0
    last = side
    rig.set({ gx: side * 4.6, gy: -6.4, br: side * 4, by: -0.6, bx: side * 0.6, sx: 1, sy: 1 })
    rig.setEyes(side < 0 ? 0.78 : 1, side > 0 ? 0.78 : 1)
    await sleep(rand(900, 1500), signal)
    const roll = Math.random()
    if (roll < 0.22) {
      rig.set({ gx: side * 4.6 + rand(-2.4, 2.4), gy: -6.4 + rand(-1, 1) })
      await sleep(140, signal)
      rig.set({ gx: side * 4.6 + rand(-2.4, 2.4) })
      await sleep(160, signal)
    } else if (roll < 0.36) {
      rig.kick({ by: 9, sy: -1.2 })
    } else if (roll < 0.46) {
      rig.blink()
    }
  }
}

const WORK_FOCUS: Gaze = { x: 0.25, y: -0.35 }

async function workingLoop(rig: BotOrbRig, { signal }: DirectorCtx) {
  rig.setFace('focused')
  rig.set({ gx: WORK_FOCUS.x, gy: WORK_FOCUS.y, bx: 0, br: 0 })
  while (!signal.aborted) {
    const steps = 14 + Math.floor(Math.random() * 18)
    for (let i = 0; i < steps; i++) {
      rig.set({
        gx: WORK_FOCUS.x + rand(-0.55, 0.55),
        gy: WORK_FOCUS.y + rand(-0.4, 0.4),
        by: i % 2 ? 0.5 : 0,
      })
      await sleep(rand(70, 110), signal)
    }
    rig.set({ by: 0 })
    const roll = Math.random()
    if (roll < 0.3) {
      const side = sign()
      rig.set({ gx: 4 * side, gy: 1, br: 2 * side })
      await sleep(420, signal)
      rig.set({ gx: WORK_FOCUS.x, gy: WORK_FOCUS.y, br: 0 })
    } else if (roll < 0.5) {
      rig.blink(60)
    }
  }
}

async function searchingLoop(rig: BotOrbRig, { signal }: DirectorCtx) {
  rig.setFace('inspecting')
  rig.tune(['gx', 'br', 'bx'], 7, 0.9)
  try {
    while (!signal.aborted) {
      for (const side of [-1, 1]) {
        rig.set({ gx: 5.5 * side, gy: -0.6, br: 4 * side, bx: 0.8 * side })
        rig.setEyes(side < 0 ? 1.14 : 0.8, side > 0 ? 1.14 : 0.8)
        await sleep(760, signal)
      }
      if (Math.random() < 0.28) {
        rig.resetTunes()
        rig.set({ gx: 0, gy: 0, br: 0, bx: 0 })
        rig.setEyes(1.1, 1.1)
        rig.blink(50)
        rig.kick({ sy: -1.6 })
        await sleep(420, signal)
        rig.tune(['gx', 'br', 'bx'], 7, 0.9)
      }
    }
  } finally {
    rig.resetTunes()
  }
}

async function writingLoop(rig: BotOrbRig, { signal }: DirectorCtx) {
  rig.setFace('calm')
  rig.set({ gx: 3.2, gy: 4.6, br: 3, bx: 0.4 })
  while (!signal.aborted) {
    const strokes = 4 + Math.floor(Math.random() * 4)
    for (let i = 0; i < strokes; i++) {
      rig.set({ gx: 3.2 + rand(-1.2, 1.2), gy: 4.6 + rand(-0.4, 0.4), by: 0.35 })
      await sleep(rand(120, 200), signal)
      rig.set({ by: 0 })
    }
    if (Math.random() < 0.35) {
      rig.set({ gx: 0, gy: -0.5, br: 0 })
      await sleep(rand(500, 800), signal)
      rig.set({ gx: 3.2, gy: 4.6, br: 3 })
    } else if (Math.random() < 0.3) {
      rig.blink()
    }
  }
}

async function sendingLoop(rig: BotOrbRig, { signal }: DirectorCtx) {
  rig.setFace('neutral')
  rig.set({ gx: 4.5, gy: -0.8 })
  while (!signal.aborted) {
    rig.set({ bx: -1.2, br: -5, sy: 0.95, sx: 1.03 })
    await sleep(260, signal)
    rig.set({ bx: 1.6, br: 6, sy: 1.04, sx: 0.97 })
    await sleep(200, signal)
    rig.set({ bx: 0.4, br: 2, sy: 1, sx: 1 })
    if (Math.random() < 0.2) rig.blink()
    await sleep(1040, signal)
  }
}

async function sleepingLoop(rig: BotOrbRig, { signal }: DirectorCtx) {
  rig.setFace('sleepy')
  rig.set({ gx: 0, gy: 1.5, br: -6, by: 1, bx: 0 })
  rig.tune(['sx', 'sy', 'by'], 3, 1)
  try {
    while (!signal.aborted) {
      rig.set({ sy: 1.035, sx: 0.985, by: 0.4 })
      await sleep(1700, signal)
      rig.set({ sy: 0.975, sx: 1.015, by: 1.2 })
      await sleep(1900, signal)
    }
  } finally {
    rig.resetTunes()
  }
}

const LOOPS: Partial<Record<BotOrbMotion, (rig: BotOrbRig, ctx: DirectorCtx) => Promise<void>>> = {
  idle: idleLoop,
  listening: listeningLoop,
  talking: talkingLoop,
  thinking: thinkingLoop,
  working: workingLoop,
  searching: searchingLoop,
  writing: writingLoop,
  sending: sendingLoop,
  sleeping: sleepingLoop,
}

/** Run one mood until aborted. Swallows the abort. */
export async function playLoop(motion: BotOrbMotion, rig: BotOrbRig, ctx: DirectorCtx) {
  const run = LOOPS[motion] ?? idleLoop
  rig.resetTunes()
  try {
    await run(rig, ctx)
  } catch {
    // aborted
  }
}

async function nod(rig: BotOrbRig, signal: AbortSignal) {
  rig.set({ gy: 3, by: 1.2, sy: 0.95 })
  await sleep(170, signal)
  rig.set({ gy: -1.5, by: -1, sy: 1.04 })
  await sleep(200, signal)
}

const SHOTS: Record<BotOrbOneShot, (rig: BotOrbRig, signal: AbortSignal) => Promise<void>> = {
  async yes(rig, signal) {
    rig.setFace('happy')
    await sleep(120, signal)
    await nod(rig, signal)
    await nod(rig, signal)
    rig.home()
    await sleep(600, signal)
  },
  async no(rig, signal) {
    rig.setFace('sad', { cut: true })
    await sleep(160, signal)
    for (const r of [-8, 8, -6, 4, 0]) {
      rig.set({ br: r, bx: r * 0.15, gx: -r * 0.3 })
      await sleep(130, signal)
    }
    rig.set({ gy: 2, by: 0.8 })
    await sleep(500, signal)
  },
  async alert(rig, signal) {
    rig.setFace('surprised')
    rig.set({ by: -2.2, sy: 1.12, sx: 0.92 })
    await sleep(160, signal)
    rig.set({ by: 0, sy: 1, sx: 1 })
    for (const x of [-1, 1, -0.8, 0.6, 0]) {
      rig.set({ bx: x })
      await sleep(60, signal)
    }
    await sleep(420, signal)
    rig.setFace('squinted')
    await sleep(420, signal)
  },
  async jump(rig, signal) {
    // Anticipation: sink low and wide, eyes narrow on the take-off.
    rig.setFace('focused')
    rig.tune(['sx', 'sy', 'by'], 14, 0.7)
    rig.set({ sy: 0.72, sx: 1.2, by: 2.6, gy: 1.5 })
    await sleep(260, signal)

    // Launch: stretch tall and shoot up on a slower, softer spring for hang time.
    rig.setFace('surprised', { cut: true })
    rig.tune(['by'], 9, 0.62)
    rig.tune(['sx', 'sy'], 18, 0.45)
    rig.set({ sy: 1.22, sx: 0.84, by: -17, gy: -3, br: -6 })
    await sleep(230, signal)

    // Apex: round out and enjoy it with a little tuck-turn.
    rig.setFace('happy')
    rig.set({ sy: 1.02, sx: 0.99, br: 8 })
    await sleep(170, signal)

    // Fall: stretch slightly into the drop.
    rig.tune(['by'], 16, 0.95)
    rig.set({ by: 0, sy: 1.1, sx: 0.92, br: 0, gy: 0 })
    await sleep(200, signal)

    // Land: hard squash, then a small rebound hop and settle.
    rig.tune(['sx', 'sy', 'by'], 20, 0.35)
    rig.snap({ sy: 0.74, sx: 1.24 })
    rig.set({ by: 1.6 })
    await sleep(110, signal)
    rig.set({ sy: 1.06, sx: 0.95, by: -3.5 })
    await sleep(150, signal)
    rig.set({ sy: 1, sx: 1, by: 0 })
    rig.kick({ sy: -1.6, sx: 1.2 })
    await sleep(420, signal)
  },
  async done(rig, signal) {
    rig.setFace('happy')
    rig.set({ sy: 0.88, sx: 1.12, by: 0.8 })
    await sleep(150, signal)
    rig.set({ sy: 1.09, sx: 0.93, by: -3.5, gy: -2 })
    await sleep(220, signal)
    rig.set({ sy: 1.04, sx: 0.97, by: 0, gy: 0 })
    await sleep(180, signal)
    rig.set({ sy: 1, sx: 1 })
    rig.kick({ sy: -2, sx: 1.2 })
    await sleep(320, signal)
    await nod(rig, signal)
    rig.home()
    await sleep(400, signal)
  },
  async leave(rig, signal) {
    rig.setFace('happy')
    rig.set({ gx: 5.5, gy: -2.5, br: 4 })
    await sleep(280, signal)
    rig.set({ sy: 0.76, sx: 1.22, by: 2, br: -6 })
    await sleep(200, signal)
    rig.tune(['bx', 'by'], 8, 1)
    rig.tune(['alpha'], 7, 1)
    rig.set({ bx: 46, by: -34, sy: 1.3, sx: 0.75, br: 18, alpha: 0 })
    await sleep(560, signal)
    rig.resetTunes()
    rig.setFace('neutral', { instant: true })
    rig.snap({ bx: 0, by: 0, br: 0, gx: 0, gy: 0, sx: 0.5, sy: 0.5, alpha: 0 })
    await sleep(240, signal)
    rig.set({ alpha: 1, sx: 1, sy: 1 })
    await sleep(500, signal)
  },
}

/** Play one reaction, then return the face to neutral. */
export async function playShot(shot: BotOrbOneShot, rig: BotOrbRig, signal: AbortSignal) {
  rig.resetTunes()
  try {
    await SHOTS[shot](rig, signal)
  } finally {
    rig.resetTunes()
    rig.setEyes(1, 1)
    if (!signal.aborted) {
      rig.setFace('neutral')
      rig.home()
    }
  }
}

/** The face a mood holds when nothing moves (static marks, reduced motion). */
export function restingFace(motion: BotOrbMotion): BotOrbFace {
  switch (motion) {
    case 'sleeping':
      return 'sleepy'
    case 'thinking':
    case 'listening':
    case 'talking':
    case 'writing':
      return 'calm'
    case 'working':
      return 'focused'
    case 'searching':
      return 'inspecting'
    case 'yes':
    case 'done':
    case 'jump':
      return 'happy'
    case 'no':
      return 'sad'
    case 'alert':
      return 'surprised'
    default:
      return 'neutral'
  }
}
