import { useCallback, useEffect, useRef, useState } from 'react'

export type AutosavePhase = 'idle' | 'pending' | 'saving' | 'error'

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null
  const at = new Date(value)
  return Number.isFinite(at.getTime()) ? at : null
}

/**
 * Debounced autosave for inline editors. Call sites keep local draft state;
 * when `dirty && canSave`, this schedules `save` and tracks last-saved time.
 */
export function useAutosave({
  dirty,
  enabled = true,
  canSave = true,
  save,
  delayMs = 700,
  initialSavedAt = null,
}: {
  dirty: boolean
  enabled?: boolean
  canSave?: boolean
  save: () => Promise<void>
  delayMs?: number
  initialSavedAt?: Date | string | null
}): {
  phase: AutosavePhase
  lastSavedAt: Date | null
  error: string | null
  flush: () => Promise<void>
} {
  const [phase, setPhase] = useState<AutosavePhase>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(() => parseDate(initialSavedAt))
  const [error, setError] = useState<string | null>(null)

  const saveRef = useRef(save)
  saveRef.current = save
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const canSaveRef = useRef(canSave)
  canSaveRef.current = canSave
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const queuedRef = useRef(false)
  const generationRef = useRef(0)

  useEffect(() => {
    const next = parseDate(initialSavedAt)
    if (!next) return
    setLastSavedAt((prev) => {
      if (!prev) return next
      return next.getTime() > prev.getTime() ? next : prev
    })
  }, [initialSavedAt])

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const runSave = useCallback(async () => {
    if (!enabledRef.current || !canSaveRef.current) return
    if (inFlightRef.current) {
      queuedRef.current = true
      return
    }
    inFlightRef.current = true
    const gen = ++generationRef.current
    setPhase('saving')
    setError(null)
    try {
      await saveRef.current()
      if (gen !== generationRef.current) return
      setLastSavedAt(new Date())
      setPhase('idle')
    } catch (err) {
      if (gen !== generationRef.current) return
      setError(err instanceof Error ? err.message : 'save failed')
      setPhase('error')
    } finally {
      inFlightRef.current = false
      if (queuedRef.current) {
        queuedRef.current = false
        if (enabledRef.current && canSaveRef.current && dirtyRef.current) {
          void runSave()
        }
      }
    }
  }, [])

  const flush = useCallback(async () => {
    clearTimer()
    if (!enabledRef.current || !canSaveRef.current || !dirtyRef.current) return
    await runSave()
  }, [runSave])

  useEffect(() => {
    if (!enabled || !dirty || !canSave) {
      clearTimer()
      setPhase((prev) => (prev === 'pending' ? 'idle' : prev))
      return
    }
    setPhase((prev) => (prev === 'saving' ? prev : 'pending'))
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void runSave()
    }, delayMs)
    return clearTimer
  }, [dirty, enabled, canSave, delayMs, runSave])

  useEffect(() => () => clearTimer(), [])

  return { phase, lastSavedAt, error, flush }
}
