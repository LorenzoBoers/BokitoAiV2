import { useCallback, useEffect, useRef, useState } from 'react'
import { workforceRealtimeChannel, type WorkforceGraphEvent } from '../lib/workforce-api'
import { WorkforceRealtimeClient, type WorkforceRealtimeDebugEvent } from '../lib/workforce-realtime'

interface UseWorkforceRealtimeOptions {
  organisationId: string | null
  token: string
  onEvent: (event: WorkforceGraphEvent) => void
  onRefresh: () => Promise<void>
}

export function useWorkforceRealtime({
  organisationId,
  token,
  onEvent,
  onRefresh,
}: UseWorkforceRealtimeOptions) {
  const [connectionState, setConnectionState] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  >('disconnected')
  const [realtimeDebug, setRealtimeDebug] = useState<string | null>(null)
  const realtimeRef = useRef<WorkforceRealtimeClient | null>(null)
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleRealtimeDebug = useCallback((debug: WorkforceRealtimeDebugEvent) => {
    if (debug.phase === 'open') {
      setRealtimeDebug(null)
      return
    }
    if (debug.phase === 'close') {
      const code = debug.closeCode ?? 0
      const reason = debug.closeReason?.trim()
      setRealtimeDebug(reason ? `WS gesloten (${code}): ${reason}` : `WS gesloten (${code})`)
      return
    }
    if (debug.phase === 'error') {
      setRealtimeDebug('WebSocket fout voor verbinding')
      return
    }
    if (debug.phase === 'give_up') {
      setRealtimeDebug('Realtime retry-limiet bereikt; fallback naar polling')
      return
    }
    if (debug.phase === 'connect') {
      setRealtimeDebug(`Realtime verbinden (poging ${debug.attempt + 1})`)
    }
  }, [])

  const handleEvent = useCallback(
    (event: WorkforceGraphEvent) => {
      onEvent(event)
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
      reloadTimerRef.current = setTimeout(() => {
        void onRefresh()
      }, 350)
    },
    [onEvent, onRefresh],
  )

  useEffect(() => {
    if (!organisationId) return
    realtimeRef.current?.destroy()
    const client = new WorkforceRealtimeClient({
      channel: workforceRealtimeChannel(organisationId),
      token,
      onEvent: handleEvent,
      onStatus: setConnectionState,
      onDebug: handleRealtimeDebug,
    })
    realtimeRef.current = client
    client.connect()

    return () => {
      realtimeRef.current?.destroy()
      realtimeRef.current = null
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
    }
  }, [organisationId, token, handleEvent, handleRealtimeDebug])

  useEffect(() => {
    const intervalMs = connectionState === 'connected' ? 20000 : 5000
    const timer = setInterval(() => {
      void onRefresh()
    }, intervalMs)
    return () => clearInterval(timer)
  }, [connectionState, onRefresh])

  return {
    connectionState,
    realtimeDebug,
  }
}
