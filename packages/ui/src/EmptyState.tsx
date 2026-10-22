import { Pressable, View } from 'react-native'
import { Text } from './Text'
import { useTokens } from './theme'

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string
  body?: string
  actionLabel?: string
  onAction?: () => void
}) {
  const tokens = useTokens()
  return (
    <View style={{ alignItems: 'center', padding: tokens.spacing.xl, gap: tokens.spacing.sm }}>
      <Text variant="sm" tone="textPrimary" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {body ? (
        <Text variant="xs" tone="textMuted" style={{ textAlign: 'center' }}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={{
            marginTop: tokens.spacing.sm,
            borderWidth: 1,
            borderColor: tokens.color.accent,
            backgroundColor: tokens.color.bgHover,
            borderRadius: tokens.radius.lg,
            paddingHorizontal: tokens.spacing.lg,
            paddingVertical: tokens.spacing.sm,
          }}
        >
          <Text variant="sm" tone="accentInk">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}
