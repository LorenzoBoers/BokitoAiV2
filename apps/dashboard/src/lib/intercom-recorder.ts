/* Hold-to-talk recorder for the dock intercom: MediaRecorder for the upload
 * plus an analyser that drives the mic-level ring on the held face. */

/** Shorter holds count as a click (replay), not as speech. */
export const MIN_TALK_MS = 450
/** The server refuses recordings above this size; stop well before it. */
export const MAX_TALK_MS = 120_000

export type Recording = { blob: Blob; durationMs: number; filename: string }

export type RecorderHandle = {
  /** Resolves with the recording, or null when the hold was too short or failed. */
  stop: () => Promise<Recording | null>
  cancel: () => void
}

function pickMime(): string {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  if (typeof MediaRecorder === 'undefined') return ''
  return options.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
}

function extensionFor(mime: string): string {
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('mp4')) return 'm4a'
  return 'webm'
}

export async function startRecording(onLevel?: (level: number) => void): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  const mime = pickMime()
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data)
  }
  const startedAt = performance.now()
  recorder.start(250)

  let raf = 0
  let ac: AudioContext | null = null
  /** Peak raw RMS while held. Below this after stop → treat as silence (no upload). */
  let peakRms = 0
  let levelMeter = false
  const SILENCE_PEAK = 0.015
  try {
    ac = new AudioContext()
    const source = ac.createMediaStreamSource(stream)
    const analyser = ac.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const buf = new Uint8Array(analyser.fftSize)
    levelMeter = true
    const tick = () => {
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (const v of buf) {
        const x = (v - 128) / 128
        sum += x * x
      }
      const rms = Math.sqrt(sum / buf.length)
      if (rms > peakRms) peakRms = rms
      onLevel?.(Math.min(1, rms * 4))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
  } catch {
    ac = null
    levelMeter = false
  }

  const release = () => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    onLevel?.(0)
    void ac?.close().catch(() => {})
    ac = null
    for (const track of stream.getTracks()) track.stop()
  }

  let done = false
  const cap = window.setTimeout(() => {
    if (recorder.state === 'recording') recorder.stop()
  }, MAX_TALK_MS)

  return {
    stop: () =>
      new Promise<Recording | null>((resolve) => {
        if (done) {
          resolve(null)
          return
        }
        done = true
        window.clearTimeout(cap)
        const durationMs = performance.now() - startedAt
        const finish = () => {
          const silent = levelMeter && peakRms < SILENCE_PEAK
          release()
          // Too short, empty, or never rose above ambient noise: no request.
          if (durationMs < MIN_TALK_MS || !chunks.length || silent) {
            resolve(null)
            return
          }
          const type = recorder.mimeType || mime || 'audio/webm'
          resolve({ blob: new Blob(chunks, { type }), durationMs, filename: `speech.${extensionFor(type)}` })
        }
        if (recorder.state === 'inactive') {
          finish()
          return
        }
        recorder.onstop = finish
        recorder.stop()
      }),
    cancel: () => {
      if (done) return
      done = true
      window.clearTimeout(cap)
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },
  }
}
