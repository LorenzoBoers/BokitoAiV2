import { StyleSheet, Text, View } from 'react-native'
import type { AgentStep } from '../hooks/useSignalStream'
import { colors, spacing } from '../theme'

type Props = {
  steps: AgentStep[]
}

export default function AgentSteps({ steps }: Props) {
  if (steps.length === 0) return null
  return (
    <View style={styles.root}>
      {steps.map((step) => (
        <View key={step.id} style={styles.row}>
          <Text style={styles.label}>{stepLabel(step)}</Text>
          {step.name ? <Text style={styles.name}>{step.name}</Text> : null}
        </View>
      ))}
    </View>
  )
}

function stepLabel(step: AgentStep): string {
  if (step.stepType === 'tool_call') return 'Tool call'
  if (step.stepType === 'tool_result') return 'Tool result'
  if (step.stepType === 'think') return 'Thinking'
  return step.stepType
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'flex-start',
    maxWidth: '90%',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  row: {
    backgroundColor: colors.elevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  name: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
})
