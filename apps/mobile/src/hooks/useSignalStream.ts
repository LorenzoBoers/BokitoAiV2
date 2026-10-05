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

/** One gateway activity item as a step: running work is a call, finished work a result. */
function stepFromItem(item: Record<string, unknown>): AgentStep | null {
  const id = String(item.id ?? '')
  if (!id) return null
  const kind = String(item.kind ?? 'work')
  const status = String(item.status ?? 'running')
  const stepType = kind === 'think' ? 'think' : status === 'running' ? 'tool_call' : 'tool_result'
  return {
    id,
    stepType,
    name: String(item.tool || item.label || ''),
    payload: { input: item.input, result: item.result },
  }
}

/**
 * Live agent turn on a thread (`agent.turn`, `agent.activity`, `message.delta`).
 * A saved message mid-turn does not end it; only `agent.turn end` does.
 */
export function useSignalStream(signalId: string | null) {
  const [state, setState] = useState<SignalStreamState>(EMPTY)

  const reset = useCallback(() => setState(EMPTY), [])

  useEffect(() => {
    if (!signalId) {
      setState(EMPTY)
      return
    }
    const unsub = onGatewayEvent(`signal:${signalId}`, (event) => {
      const data = (event.data ?? {}) as Record<string, unknown>
      if (event.event === 'agent.turn') {
        if (data.phase === 'end') setState(EMPTY)
        else setState((prev) => (prev.streaming ? prev : { ...EMPTY, streaming: true }))
      } else if (event.event === 'message.delta') {
        const delta = String(data.delta ?? '')
        if (!delta) return
        setState((prev) => ({ ...prev, streaming: true, streamText: prev.streamText + delta }))
      } else if (event.event === 'agent.activity') {
        const step = stepFromItem((data.item as Record<string, unknown>) ?? {})
        if (!step) return
        setState((prev) => {
          const index = prev.steps.findIndex((s) => s.id === step.id)
          const steps = prev.steps.slice()
          if (index < 0) steps.push(step)
          else steps[index] = step
          return { ...prev, streaming: true, steps }
        })
      }
    })
    return () => {
      unsub()
      setState(EMPTY)
    }
  }, [signalId])

  return { ...state, reset }
}
