import { Text, View } from 'react-native'
import { useThemedStyles } from '../context/ThemeContext'
import type { AgentStep } from '../hooks/useSignalStream'
import { spacing, type ColorTokens } from '../theme'
import ThinkingTrace from './ThinkingTrace'

type Props = {
  text: string
  steps?: AgentStep[]
  active?: boolean
}

export default function StreamingBubble({ text, steps = [], active }: Props) {
  const styles = useThemedStyles(streamStyles)
  const showTrace = active || steps.length > 0
  if (!text && !showTrace) return null

  return (
    <View style={styles.root}>
      {showTrace ? <ThinkingTrace steps={steps} active={!!active} /> : null}
      {text ? (
        <View style={styles.bubble}>
          <Text style={styles.text}>{text}</Text>
          {active ? <View style={styles.cursor} /> : null}
        </View>
      ) : null}
    </View>
  )
}

function streamStyles(colors: ColorTokens) {
  return {
    root: { alignSelf: 'flex-start' as const, maxWidth: '88%' as const, gap: spacing.xs },
    bubble: {
      backgroundColor: colors.elevated,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: spacing.lg,
      paddingVertical: 10,
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      alignItems: 'flex-end' as const,
      gap: 4,
    },
    text: { color: colors.textHeading, fontSize: 15, lineHeight: 21 },
    cursor: {
      width: 6,
      height: 14,
      backgroundColor: colors.accent,
      borderRadius: 2,
      marginBottom: 2,
    },
  }
}
