import { Text, View } from 'react-native'
import { useCopy } from '../context/LocaleContext'
import { useThemedStyles } from '../context/ThemeContext'
import type { AgentStep } from '../hooks/useSignalStream'
import { stepHeadline, stepLabel } from '../lib/agentSteps'
import { spacing, type ColorTokens } from '../theme'

type Props = {
  steps: AgentStep[]
}

export default function AgentSteps({ steps }: Props) {
  const { locale } = useCopy()
  const styles = useThemedStyles(agentStepStyles)
  if (steps.length === 0) return null
  return (
    <View style={styles.root}>
      {steps.map((step) => (
        <View key={step.id} style={styles.row}>
          <Text style={styles.label}>{stepLabel(step, locale)}</Text>
          <Text style={styles.name}>{stepHeadline(step, locale)}</Text>
        </View>
      ))}
    </View>
  )
}

function agentStepStyles(colors: ColorTokens) {
  return {
    root: {
      alignSelf: 'flex-start' as const,
      maxWidth: '90%' as const,
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
      fontWeight: '600' as const,
      textTransform: 'uppercase' as const,
      letterSpacing: 0.6,
    },
    name: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  }
}
