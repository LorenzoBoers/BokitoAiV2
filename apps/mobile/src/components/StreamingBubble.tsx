import { StyleSheet, Text, View } from 'react-native'
import AgentSteps from './AgentSteps'
import type { AgentStep } from '../hooks/useSignalStream'
import { colors, spacing } from '../theme'

type Props = {
  text: string
  steps?: AgentStep[]
  active?: boolean
}

export default function StreamingBubble({ text, steps = [], active }: Props) {
  if (!text && steps.length === 0 && !active) return null

  return (
    <View style={styles.root}>
      {steps.length > 0 ? <AgentSteps steps={steps} /> : null}
      <View style={styles.bubble}>
        {text ? <Text style={styles.text}>{text}</Text> : null}
        {active && !text ? <Text style={styles.placeholder}>Thinking...</Text> : null}
        {active && text ? <View style={styles.cursor} /> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { alignSelf: 'flex-start', maxWidth: '88%', gap: spacing.xs },
  bubble: {
    backgroundColor: colors.elevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 4,
  },
  text: { color: colors.textHeading, fontSize: 15, lineHeight: 21 },
  placeholder: { color: colors.textMuted, fontSize: 14, fontStyle: 'italic' },
  cursor: {
    width: 6,
    height: 14,
    backgroundColor: colors.accent,
    borderRadius: 2,
    marginBottom: 2,
  },
})
