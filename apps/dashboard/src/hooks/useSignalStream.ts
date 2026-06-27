import { useCallback, useEffect, useState } from 'react'
import { onGatewayEvent } from '../lib/gateway'

export type AgentStep = {
  id: string
  stepType: string
  name: string
  payload: Record<string, unknown>
}

export type SignalStreamState = {
  streamText: string
  streaming: boolean
  steps: AgentStep[]
}

const EMPTY: SignalStreamState = { streamText: '', streaming: false, steps: [] }

/** Subscribe to gateway message.delta and agent.step for a thread. */
export function useSignalStream(signalId: string | null) {
  const [state, setState] = useState<SignalStreamState>(EMPTY)

  const reset = useCallback(() => setState(EMPTY), [])

  useEffect(() => {
    if (!signalId) {
      setState(EMPTY)
      return
    }
    const unsub = onGatewayEvent(`signal:${signalId}`, (event) => {
      if (event.event === 'message.delta') {
        const delta = String(event.data.delta ?? '')
        if (!delta) return
        setState((prev) => ({
          ...prev,
          streaming: true,
          streamText: prev.streamText + delta,
        }))
      } else if (event.event === 'agent.step') {
        const stepType = String(event.data.step_type ?? '')
        const name = String(event.data.name ?? '')
        const payload = (event.data.payload as Record<string, unknown>) ?? {}
        setState((prev) => ({
          ...prev,
          streaming: true,
          steps: [
            ...prev.steps,
            { id: `${stepType}-${name}-${prev.steps.length}`, stepType, name, payload },
          ],
        }))
      } else if (event.event === 'message') {
        setState(EMPTY)
      }
    })
    return () => {
      unsub()
      setState(EMPTY)
    }
  }, [signalId])

  return { ...state, reset }
}
