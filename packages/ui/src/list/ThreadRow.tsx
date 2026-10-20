import { Pressable, View } from 'react-native'
import { Text } from '../Text'
import { useTokens } from '../theme'

export function ThreadRow({
  title,
  preview,
  time,
  unread = 0,
  channel,
  pinned = false,
  onPress,
}: {
  title: string
  preview?: string
  time?: string
  unread?: number
  channel?: string
  pinned?: boolean
  onPress?: () => void
}) {
  const tokens = useTokens()
  const body = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm }}>
        <Text variant="sm" tone={unread > 0 ? 'textHeading' : 'textPrimary'} numberOfLines={1} style={{ flex: 1 }}>
          {title}
        </Text>
        {time ? (
          <Text variant="2xs" tone="textMuted">
            {time}
          </Text>
        ) : null}
      </View>
      {preview ? (
        <Text variant="xs" tone="textMuted" numberOfLines={1}>
          {preview}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm }}>
        {channel ? (
          <Text variant="2xs" tone="textSecondary">
            {channel}
          </Text>
        ) : null}
        {pinned ? (
          <Text variant="2xs" tone="accentInk">
            Pin
          </Text>
        ) : null}
        {unread > 0 ? (
          <View
            style={{
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              paddingHorizontal: 4,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: tokens.color.accent,
            }}
          >
            <Text variant="2xs" tone="accentFg">
              {unread > 99 ? '99+' : String(unread)}
            </Text>
          </View>
        ) : null}
      </View>
    </>
  )
  if (!onPress) return <View style={{ gap: 4 }}>{body}</View>
  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: tokens.spacing.lg, paddingVertical: tokens.spacing.md }}>
      {body}
    </Pressable>
  )
}
