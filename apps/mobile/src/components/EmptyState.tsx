import { Pressable, Text, View } from 'react-native'
import { useThemedStyles } from '../context/ThemeContext'
import { radius, spacing, type ColorTokens } from '../theme'

type Props = {
  title: string
  body?: string
  actionLabel?: string
  onAction?: () => void
}

export default function EmptyState({ title, body, actionLabel, onAction }: Props) {
  const styles = useThemedStyles(emptyStyles)
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable style={styles.button} onPress={onAction}>
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function emptyStyles(colors: ColorTokens) {
  return {
    root: {
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.xl * 2,
      alignItems: 'center' as const,
      gap: spacing.sm,
    },
    title: {
      color: colors.textHeading,
      fontSize: 16,
      fontWeight: '600' as const,
      textAlign: 'center' as const,
    },
    body: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center' as const,
    },
    button: {
      marginTop: spacing.sm,
      backgroundColor: colors.accentMuted,
      borderColor: colors.accent,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: 8,
    },
    buttonText: { color: colors.accentInk, fontWeight: '600' as const, fontSize: 13 },
  }
}
