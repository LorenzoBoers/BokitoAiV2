import { View } from 'react-native'
import { Text } from '../Text'
import { useTokens } from '../theme'

export function DaySeparator({ label }: { label: string }) {
  const tokens = useTokens()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.spacing.md,
        marginVertical: tokens.spacing.md,
      }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: tokens.color.border }} />
      <Text variant="2xs" tone="textMuted">
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: tokens.color.border }} />
    </View>
  )
}
