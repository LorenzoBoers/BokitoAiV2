import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { advanceSmoothStream } from '@bokito/shared'
import { Text } from '../Text'
import { ThinkingTrace, type TraceStep } from './ThinkingTrace'
import { MessageBubble } from './MessageBubble'

export function StreamingBubble({
  text,
  active = false,
  steps = [],
}: {
  text: string
  active?: boolean
  steps?: TraceStep[]
}) {
  const [visible, setVisible] = useState('')
  const state = useRef({ prev: '', carry: 0, lastMs: 0, startedAtMs: null as number | null })

  useEffect(() => {
    let frame = 0
    const tick = (now: number) => {
      const current = state.current
      const result = advanceSmoothStream({
        goal: text,
        prev: current.prev,
        active,
        holdLead: active,
        nowMs: now,
        lastMs: current.lastMs || now,
        startedAtMs: current.startedAtMs,
        carry: current.carry,
      })
      current.prev = result.visible
      current.carry = result.carry
      current.lastMs = result.lastMs
      current.startedAtMs = result.startedAtMs
      setVisible(result.visible)
      if (active || result.visible.length < text.length) {
        frame = requestAnimationFrame(tick)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [text, active])

  if (!visible && steps.length === 0 && !active) return null
  return (
    <View style={{ alignSelf: 'flex-start', maxWidth: '88%', gap: 6 }}>
      <ThinkingTrace steps={steps} active={active} />
      {visible ? (
        <MessageBubble
          side="left"
          variant="ai"
          stack="single"
          body={<Text variant="base">{visible}</Text>}
        />
      ) : null}
    </View>
  )
}
