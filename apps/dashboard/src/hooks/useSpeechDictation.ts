/**
 * Client-side hold-to-talk / toggle dictation via the Web Speech API.
 * Falls back gracefully when the browser has no speech recognition.
 *
 * Commit/dedupe rules live in `@bokito/shared` so the chat-widget stays aligned.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { appendSpeechChunk, consumeSpeechResults } from '@bokito/shared'

export { appendSpeechChunk } from '@bokito/shared'

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function speechDictationSupported(): boolean {
  return getSpeechRecognitionCtor() != null
}

export function useSpeechDictation(opts: {
  lang?: string
  onFinal: (text: string) => void
  onInterim?: (text: string) => void
}) {
  const [listening, setListening] = useState(false)
  const [supported] = useState(() => speechDictationSupported())
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  /** When true, ignore further recognition events (set before stop/abort). */
  const closedRef = useRef(true)
  const onFinalRef = useRef(opts.onFinal)
  const onInterimRef = useRef(opts.onInterim)
  onFinalRef.current = opts.onFinal
  onInterimRef.current = opts.onInterim

  const stop = useCallback(() => {
    // Close first so a late final (same text as the last interim) is ignored.
    closedRef.current = true
    const rec = recognitionRef.current
    recognitionRef.current = null
    try {
      rec?.stop()
    } catch {
      // already stopped
    }
    setListening(false)
    onInterimRef.current?.('')
  }, [])

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return false
    stop()
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = opts.lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US')
    let nextFinalIndex = 0
    closedRef.current = false
    rec.onresult = (event) => {
      if (closedRef.current) return
      const mapped = Array.from({ length: event.results.length }, (_, i) => {
        const row = event.results[i]
        return {
          isFinal: Boolean(row?.isFinal),
          transcript: row?.[0]?.transcript ?? '',
        }
      })
      const { nextFinalIndex: next, finalChunk, interim } = consumeSpeechResults(
        mapped,
        nextFinalIndex,
      )
      nextFinalIndex = next
      if (finalChunk) onFinalRef.current(finalChunk)
      onInterimRef.current?.(interim)
    }
    rec.onerror = () => {
      closedRef.current = true
      setListening(false)
      recognitionRef.current = null
      onInterimRef.current?.('')
    }
    rec.onend = () => {
      closedRef.current = true
      setListening(false)
      recognitionRef.current = null
    }
    recognitionRef.current = rec
    try {
      rec.start()
      setListening(true)
      return true
    } catch {
      closedRef.current = true
      setListening(false)
      recognitionRef.current = null
      return false
    }
  }, [opts.lang, stop])

  const toggle = useCallback(() => {
    if (listening) {
      stop()
      return
    }
    start()
  }, [listening, start, stop])

  useEffect(() => () => stop(), [stop])

  return { supported, listening, start, stop, toggle }
}
