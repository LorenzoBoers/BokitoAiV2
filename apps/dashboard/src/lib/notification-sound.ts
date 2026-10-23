/**
 * Live notices play ``/sounds/notification.mp3``. Dictation blips stay
 * short Web Audio tones.
 */

const NOTIFICATION_SOUND_URL = '/sounds/notification.mp3'

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

function primeNotificationClip(): void {
  if (typeof Audio === 'undefined') return
  const audio = new Audio(NOTIFICATION_SOUND_URL)
  audio.muted = true
  void audio.play().then(() => {
    audio.pause()
    audio.currentTime = 0
    audio.muted = false
  }).catch(() => {
    // The next real notice retries after this gesture.
  })
}

/** Call once from the shell so the first notice is not blocked by autoplay policy. */
export function unlockNotificationAudio(): void {
  if (typeof window === 'undefined' || unlockBound) return
  unlockBound = true
  const unlock = () => {
    try {
      const ctx = ensureContext()
      if (ctx?.state === 'suspended') void ctx.resume()
      primeNotificationClip()
    } catch {
      // ignore
    }
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })
}

/**
 * Soft rising blip when dictation starts. Not a notice, so it ignores the
 * notification-sound preference. The click that starts recording is the gesture.
 */
export async function playDictationStartSound(): Promise<void> {
  try {
    const ctx = ensureContext()
    if (!ctx) return
    if (ctx.state === 'suspended') await ctx.resume()
    const osc = ctx.createOscillator()
    const vol = ctx.createGain()
    osc.connect(vol)
    vol.connect(ctx.destination)
    osc.type = 'sine'
    const t0 = ctx.currentTime
    osc.frequency.setValueAtTime(520, t0)
    osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.09)
    vol.gain.setValueAtTime(0.0001, t0)
    vol.gain.exponentialRampToValueAtTime(0.09, t0 + 0.02)
    vol.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16)
    osc.start(t0)
    osc.stop(t0 + 0.18)
  } catch {
    // Autoplay or missing Web Audio — ignore.
  }
}

/** Soft falling blip when dictation stops. Pair of the start sound. */
export async function playDictationStopSound(): Promise<void> {
  try {
    const ctx = ensureContext()
    if (!ctx) return
    if (ctx.state === 'suspended') await ctx.resume()
    const osc = ctx.createOscillator()
    const vol = ctx.createGain()
    osc.connect(vol)
    vol.connect(ctx.destination)
    osc.type = 'sine'
    const t0 = ctx.currentTime
    osc.frequency.setValueAtTime(740, t0)
    osc.frequency.exponentialRampToValueAtTime(360, t0 + 0.12)
    vol.gain.setValueAtTime(0.0001, t0)
    vol.gain.exponentialRampToValueAtTime(0.08, t0 + 0.015)
    vol.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18)
    osc.start(t0)
    osc.stop(t0 + 0.2)
  } catch {
    // Autoplay or missing Web Audio — ignore.
  }
}

/** Play when a conversation notice arrives while the dashboard is open. */
export async function playIncomingNotificationSound(opts?: { force?: boolean }): Promise<void> {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return
  if (!opts?.force && !isNotificationSoundEnabled()) return
  try {
    const audio = new Audio(NOTIFICATION_SOUND_URL)
    audio.preload = 'auto'
    await audio.play()
  } catch {
    // Autoplay blocked — ignore.
  }
}
