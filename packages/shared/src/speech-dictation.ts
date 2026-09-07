/**
 * Shared Web Speech dictation helpers for dashboard composers and the chat widget.
 * UI shells stay React vs DOM; commit/dedupe rules live here once.
 */

export function appendSpeechChunk(prev: string, chunk: string): string {
  const next = chunk.replace(/\s+/g, ' ').trim()
  if (!next) return prev
  const base = prev.replace(/\s+$/, '')
  if (!base) return next
  if (base === next || base.endsWith(` ${next}`)) return base
  return `${base} ${next}`
}

export type SpeechResultLike = {
  isFinal: boolean
  transcript: string
}

/** Consume recognition results once per final index; interim is always the live non-final tail. */
export function consumeSpeechResults(
  results: ArrayLike<SpeechResultLike>,
  nextFinalIndex: number,
): { nextFinalIndex: number; finalChunk: string; interim: string } {
  let interim = ''
  let finalChunk = ''
  let cursor = nextFinalIndex
  for (let i = 0; i < results.length; i++) {
    const row = results[i]
    const piece = row?.transcript ?? ''
    if (row?.isFinal) {
      if (i >= cursor) {
        finalChunk += piece
        cursor = i + 1
      }
    } else {
      interim += piece
    }
  }
  return {
    nextFinalIndex: cursor,
    finalChunk: finalChunk.replace(/\s+/g, ' ').trim(),
    interim: interim.replace(/\s+/g, ' ').trim(),
  }
}

/** Wave bar geometry for the listening mic (viewBox 0 0 24 24). */
export const SPEECH_WAVE_BARS: ReadonlyArray<{
  x: number
  y: number
  width: number
  height: number
}> = [
  { x: 1, y: 16, width: 3, height: 8 },
  { x: 6, y: 8, width: 3, height: 16 },
  { x: 11, y: 4, width: 3, height: 20 },
  { x: 16, y: 12, width: 3, height: 12 },
  { x: 21, y: 18, width: 3, height: 6 },
]

/** Markup used by the vanilla chat-widget listening button. */
export function speechWaveSvgHtml(className = 'bk-speech-wave bk-record-wave'): string {
  const bars = SPEECH_WAVE_BARS.map(
    (b) =>
      `<rect class="bk-wave-bar" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="1.5"/>`,
  ).join('')
  return `<svg class="${className}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${bars}</svg>`
}
