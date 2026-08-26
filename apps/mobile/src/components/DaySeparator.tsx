import { StyleSheet, Text, View } from 'react-native'
import { useThemedStyles } from '../context/ThemeContext'
import { spacing, type ColorTokens } from '../theme'

type Props = {
  label: string
}

export default function DaySeparator({ label }: Props) {
  const styles = useThemedStyles(dayStyles)
  return (
    <View style={styles.root}>
      <View style={styles.line} />
      <Text style={styles.label}>{label}</Text>
      <View style={styles.line} />
    </View>
  )
}

function dayStyles(colors: ColorTokens) {
  return {
    root: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.md,
      marginVertical: spacing.md,
    },
    line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
    label: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '600' as const,
      textTransform: 'uppercase' as const,
      letterSpacing: 0.6,
    },
  }
}
