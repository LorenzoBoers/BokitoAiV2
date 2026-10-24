/* Short synthesized cues for the dock intercom. No audio files: two or three
 * sine tones through one shared AudioContext, quiet enough to sit under speech. */

export type Earcon =
  | 'talkStart'
  | 'talkStop'
  | 'noteIn'
  | 'noteOut'
  | 'pause'
  | 'error'
  | 'panelOpen'
  | 'panelClose'

type Tone = { freq: number; at: number; dur: number; gain?: number }

const CUES: Record<Earcon, Tone[]> = {
  talkStart: [
    { freq: 660, at: 0, dur: 0.06 },
    { freq: 990, at: 0.06, dur: 0.08 },
  ],
  talkStop: [
    { freq: 990, at: 0, dur: 0.06 },
    { freq: 660, at: 0.06, dur: 0.08 },
  ],
  noteIn: [
    { freq: 784, at: 0, dur: 0.09, gain: 0.07 },
    { freq: 1175, at: 0.1, dur: 0.12, gain: 0.06 },
  ],
  noteOut: [{ freq: 523, at: 0, dur: 0.07, gain: 0.05 }],
  pause: [{ freq: 440, at: 0, dur: 0.07, gain: 0.05 }],
  error: [
    { freq: 330, at: 0, dur: 0.1 },
    { freq: 247, at: 0.12, dur: 0.16 },
  ],
  // Same two-note chimes as the chat widget open and close effects.
  panelOpen: [
    { freq: 440, at: 0, dur: 0.14, gain: 0.18 },
    { freq: 554, at: 0.12, dur: 0.2, gain: 0.14 },
  ],
  panelClose: [
    { freq: 370, at: 0, dur: 0.18, gain: 0.15 },
    { freq: 294, at: 0.13, dur: 0.16, gain: 0.12 },
  ],
}

/** Delay before a note starts after its `noteIn` cue. */
export const NOTE_IN_LEAD_MS = 250

let ctx: AudioContext | null = null
let muted = false

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!ctx) ctx = new Ctor()
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  return ctx
}

export function setEarconsMuted(next: boolean) {
  muted = next
}

export function playEarcon(name: Earcon) {
  if (muted) return
  const ac = audio()
  if (!ac) return
  const start = ac.currentTime + 0.01
  for (const tone of CUES[name]) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.value = tone.freq
    const peak = tone.gain ?? 0.08
    const t0 = start + tone.at
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.dur)
    osc.connect(gain).connect(ac.destination)
    osc.start(t0)
    osc.stop(t0 + tone.dur + 0.02)
  }
}
