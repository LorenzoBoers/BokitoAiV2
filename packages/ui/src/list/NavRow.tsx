import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { Text } from '../Text'
import { useTokens } from '../theme'

export type NavItem = {
  id: string
  label: string
  unread?: number
  total?: number
  children?: NavItem[]
}

export function NavRow({
  label,
  unread = 0,
  total = 0,
  active = false,
  onPress,
  leading,
}: {
  label: string
  unread?: number
  total?: number
  active?: boolean
  onPress?: () => void
  leading?: ReactNode
}) {
  const tokens = useTokens()
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.spacing.sm,
        paddingHorizontal: tokens.spacing.sm,
        paddingVertical: 6,
        borderRadius: tokens.radius.md,
        backgroundColor: active ? tokens.color.bgHover : 'transparent',
      }}
    >
      {leading}
      <Text variant="xs" tone={active ? 'textHeading' : 'textSecondary'} numberOfLines={1} style={{ flex: 1 }}>
        {label}
      </Text>
      {unread > 0 ? (
        <Text variant="2xs" tone="accentInk">
          {unread}
        </Text>
      ) : null}
      {total > 0 ? (
        <Text variant="2xs" tone="textMuted">
          {total}
        </Text>
      ) : null}
    </Pressable>
  )
}

export function NavSection({ title, children }: { title: string; children: ReactNode }) {
  const tokens = useTokens()
  return (
    <View style={{ gap: 2, marginTop: tokens.spacing.sm }}>
      <Text variant="2xs" tone="textMuted">
        {title}
      </Text>
      {children}
    </View>
  )
}
