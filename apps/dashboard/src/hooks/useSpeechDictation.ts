/**
 * Client-side hold-to-talk / toggle dictation via the Web Speech API.
 * Falls back gracefully when the browser has no speech recognition.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

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
  const onFinalRef = useRef(opts.onFinal)
  const onInterimRef = useRef(opts.onInterim)
  onFinalRef.current = opts.onFinal
  onInterimRef.current = opts.onInterim

  const stop = useCallback(() => {
    const rec = recognitionRef.current
    recognitionRef.current = null
    try {
      rec?.stop()
    } catch {
      // already stopped
    }
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return false
    stop()
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = opts.lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US')
    rec.onresult = (event) => {
      let interim = ''
      let finalChunk = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const row = event.results[i]
        const piece = row[0]?.transcript ?? ''
        if (row.isFinal) finalChunk += piece
        else interim += piece
      }
      if (finalChunk.trim()) onFinalRef.current(finalChunk.trim())
      if (interim.trim()) onInterimRef.current?.(interim.trim())
    }
    rec.onerror = () => {
      setListening(false)
      recognitionRef.current = null
    }
    rec.onend = () => {
      setListening(false)
      recognitionRef.current = null
    }
    recognitionRef.current = rec
    try {
      rec.start()
      setListening(true)
      return true
    } catch {
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
