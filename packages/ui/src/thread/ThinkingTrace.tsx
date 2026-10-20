import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Text } from '../Text'
import { useTokens } from '../theme'

export type TraceStep = { id: string; label: string; detail?: string }

export function ThinkingTrace({
  steps,
  active = false,
  title,
}: {
  steps: TraceStep[]
  active?: boolean
  title?: string
}) {
  const tokens = useTokens()
  const [open, setOpen] = useState(false)
  if (!active && steps.length === 0) return null
  const headline = title ?? (active ? 'Working' : 'Thought')
  return (
    <View style={{ gap: tokens.spacing.xs, marginBottom: tokens.spacing.xs }}>
      <Pressable onPress={() => steps.length > 0 && setOpen((value) => !value)} disabled={steps.length === 0}>
        <Text variant="xs" tone="textMuted">
          {headline}
        </Text>
      </Pressable>
      {open
        ? steps.map((step) => (
            <Text key={step.id} variant="2xs" tone="textSecondary">
              {step.detail ? `${step.label}: ${step.detail}` : step.label}
            </Text>
          ))
        : null}
    </View>
  )
}
