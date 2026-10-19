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
 * Speech and steps from the turn surface. When the frame carries blocks, those
 * replace the bubble text and the step list. Deltas are only a fallback.
 */
function readSurface(data: Record<string, unknown>): { streamText: string; steps: AgentStep[] } | null {
  const surface = data.surface
  if (!surface || typeof surface !== 'object') return null
  const blocks = (surface as { blocks?: unknown }).blocks
  if (!Array.isArray(blocks) || blocks.length === 0) return null
  const texts: string[] = []
  const steps: AgentStep[] = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const row = block as { type?: unknown; text?: unknown; items?: unknown }
    if (row.type === 'speech') {
      const text = String(row.text ?? '')
      if (text.trim()) texts.push(text)
      continue
    }
    if (row.type !== 'activity' || !Array.isArray(row.items)) continue
    for (const item of row.items) {
      if (!item || typeof item !== 'object') continue
      const step = stepFromItem(item as Record<string, unknown>)
      if (step) steps.push(step)
    }
  }
  return { streamText: texts.join('\n\n'), steps }
}

/**
 * Live agent turn on a thread. The socket surface is the document: speech
 * blocks are the bubble text, activity blocks are the steps. A saved message
 * mid-turn does not end it; only `agent.turn` end does.
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
      const rawSignal = data.signal_id
      if (rawSignal != null && rawSignal !== '' && String(rawSignal) !== String(signalId)) return
      if (event.event === 'agent.turn') {
        if (data.phase === 'end') setState(EMPTY)
        else setState((prev) => (prev.streaming ? prev : { ...EMPTY, streaming: true }))
        return
      }
      const surface = readSurface(data)
      if (
        surface &&
        (event.event === 'message.delta' ||
          event.event === 'message.part' ||
          event.event === 'agent.activity' ||
          event.event === 'agent.thinking')
      ) {
        setState({ streaming: true, streamText: surface.streamText, steps: surface.steps })
        return
      }
      if (event.event === 'message.delta') {
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
