/**
 * Soft chime for live notices — same two-tone shape as the chat widget
 * ``incoming`` sound (Web Audio, no asset file).
 */

const SOUND_PREF_KEY = 'bokito-notification-sound'

let audioCtx: AudioContext | null = null
let unlockBound = false
/** In-memory mirror; null until set or hydrated from localStorage. */
let soundEnabledMemory: boolean | null = null

function audioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  )
}

function ensureContext(): AudioContext | null {
  const AC = audioContextCtor()
  if (!AC) return null
  if (!audioCtx) audioCtx = new AC()
  return audioCtx
}

/** Local mirror of the account ``sound`` pref so live events need no fetch. */
export function isNotificationSoundEnabled(): boolean {
  if (soundEnabledMemory !== null) return soundEnabledMemory
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(SOUND_PREF_KEY)
      if (raw === '0' || raw === 'off' || raw === 'false') {
        soundEnabledMemory = false
        return false
      }
      if (raw === '1' || raw === 'on' || raw === 'true') {
        soundEnabledMemory = true
        return true
      }
    } catch {
      // default on
    }
  }
  soundEnabledMemory = true
  return true
}

export function setNotificationSoundEnabled(enabled: boolean): void {
  soundEnabledMemory = enabled
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SOUND_PREF_KEY, enabled ? '1' : '0')
  } catch {
    // ignore
  }
}

/** Call once from the shell so the first notice is not blocked by autoplay policy. */
export function unlockNotificationAudio(): void {
  if (typeof window === 'undefined' || unlockBound) return
  unlockBound = true
  const unlock = () => {
    try {
      const ctx = ensureContext()
      if (ctx?.state === 'suspended') void ctx.resume()
    } catch {
      // ignore
    }
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })
}

function tone(
  ctx: AudioContext,
  freq: number,
  duration: number,
  gain = 0.15,
  delay = 0,
  type: OscillatorType = 'sine',
) {
  const osc = ctx.createOscillator()
  const vol = ctx.createGain()
  osc.connect(vol)
  vol.connect(ctx.destination)
  osc.type = type
  const t0 = ctx.currentTime + delay
  osc.frequency.setValueAtTime(freq, t0)
  vol.gain.setValueAtTime(0, t0)
  vol.gain.linearRampToValueAtTime(gain, t0 + 0.01)
  vol.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.start(t0)
  osc.stop(t0 + duration + 0.01)
}

/** Play when a conversation notice arrives while the dashboard is open. */
export async function playIncomingNotificationSound(opts?: { force?: boolean }): Promise<void> {
  if (!opts?.force && !isNotificationSoundEnabled()) return
  try {
    const ctx = ensureContext()
    if (!ctx) return
    if (ctx.state === 'suspended') await ctx.resume()
    // Match chat-widget ``incoming``: C5 then E5.
    tone(ctx, 523, 0.12, 0.18)
    tone(ctx, 659, 0.22, 0.14, 0.11)
  } catch {
    // Autoplay or missing Web Audio — ignore.
  }
}
