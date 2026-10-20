import { Pressable, View } from 'react-native'
import { Text } from '../Text'
import { useTokens, type ColorName } from '../theme'

function statusTone(status: string | undefined): ColorName {
  const value = (status ?? '').toLowerCase()
  if (value.includes('fail') || value.includes('error')) return 'statusError'
  if (value.includes('run') || value.includes('active')) return 'statusSuccess'
  if (value.includes('wait') || value.includes('pause')) return 'statusWarning'
  return 'textMuted'
}

export function AgendaItemRow({
  time,
  title,
  owner,
  repeat = false,
  status,
  onPress,
}: {
  time: string
  title: string
  owner?: string
  repeat?: boolean
  status?: string
  onPress?: () => void
}) {
  const tokens = useTokens()
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.spacing.sm,
        paddingHorizontal: tokens.spacing.md,
        paddingVertical: tokens.spacing.sm,
      }}
    >
      <Text variant="xs" tone="textMuted" style={{ width: 48 }}>
        {time}
      </Text>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tokens.color[statusTone(status)] }} />
      <View style={{ flex: 1 }}>
        <Text variant="sm" numberOfLines={1}>
          {title}
        </Text>
        {owner ? (
          <Text variant="2xs" tone="textMuted" numberOfLines={1}>
            {owner}
          </Text>
        ) : null}
      </View>
      {repeat ? (
        <Text variant="2xs" tone="textMuted">
          Repeat
        </Text>
      ) : null}
    </Pressable>
  )
}

export function AgendaDayHeader({ label }: { label: string }) {
  const tokens = useTokens()
  return (
    <View style={{ paddingHorizontal: tokens.spacing.md, paddingTop: tokens.spacing.lg }}>
      <Text variant="xs" tone="textSecondary">
        {label}
      </Text>
    </View>
  )
}

export function AgendaEmpty({ title, body }: { title: string; body?: string }) {
  return (
    <View style={{ padding: 24 }}>
      <Text variant="sm" tone="textPrimary">
        {title}
      </Text>
      {body ? (
        <Text variant="xs" tone="textMuted">
          {body}
        </Text>
      ) : null}
    </View>
  )
}
