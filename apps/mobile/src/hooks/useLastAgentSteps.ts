import { useEffect, useRef, useState } from 'react'
import type { AgentStep } from './useSignalStream'

/** Retain the latest agent step trace briefly after a stream completes. */
export function useLastAgentSteps(streaming: boolean, steps: AgentStep[]) {
  const [lastSteps, setLastSteps] = useState<AgentStep[]>([])
  const latestRef = useRef<AgentStep[]>([])
  const wasStreamingRef = useRef(false)

  useEffect(() => {
    if (steps.length > 0) latestRef.current = steps
  }, [steps])

  useEffect(() => {
    const wasStreaming = wasStreamingRef.current
    if (wasStreaming && !streaming && latestRef.current.length > 0) {
      setLastSteps([...latestRef.current])
      latestRef.current = []
    }
    if (streaming) setLastSteps([])
    wasStreamingRef.current = streaming
  }, [streaming])

  return lastSteps
}
