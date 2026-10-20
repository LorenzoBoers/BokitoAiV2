import { Pressable, View } from 'react-native'
import { Avatar } from '../Avatar'
import { Icon } from '../Icon'
import { Text } from '../Text'
import { useTokens } from '../theme'

export type TargetItem = {
  id: string
  name: string
  subtitle?: string
  lead?: boolean
  color?: string
}

/** One large selected target with side steppers — same shape as web New conversation. */
export function TargetCarousel({
  items,
  selectedId,
  onSelect,
  previousLabel = 'Previous',
  nextLabel = 'Next',
  leadLabel,
}: {
  items: TargetItem[]
  selectedId?: string | null
  onSelect: (id: string) => void
  previousLabel?: string
  nextLabel?: string
  leadLabel?: string
}) {
  const tokens = useTokens()
  if (items.length === 0) return null
  const index = Math.max(
    0,
    items.findIndex((item) => item.id === selectedId),
  )
  const active = items[index] ?? items[0]
  const step = (delta: number) => {
    if (items.length < 2) return
    const next = items[(index + delta + items.length) % items.length]
    if (next) onSelect(next.id)
  }

  return (
    <View style={{ alignItems: 'center', gap: tokens.spacing.sm, paddingVertical: tokens.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md }}>
        {items.length > 1 ? (
          <Pressable
            accessibilityLabel={previousLabel}
            onPress={() => step(-1)}
            style={{
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: tokens.radius.md,
            }}
          >
            <Icon name="chevron-left" size={22} color={tokens.color.textMuted} />
          </Pressable>
        ) : (
          <View style={{ width: 44 }} />
        )}
        <View style={{ width: 72, height: 72, alignItems: 'center', justifyContent: 'center' }}>
          {active.color ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                width: 108,
                height: 108,
                borderRadius: 54,
                backgroundColor: active.color,
                opacity: 0.28,
              }}
            />
          ) : null}
          <Avatar name={active.name} ai size={72} />
        </View>
        {items.length > 1 ? (
          <Pressable
            accessibilityLabel={nextLabel}
            onPress={() => step(1)}
            style={{
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: tokens.radius.md,
            }}
          >
            <Icon name="chevron-right" size={22} color={tokens.color.textMuted} />
          </Pressable>
        ) : (
          <View style={{ width: 44 }} />
        )}
      </View>
      <Text variant="2xs" tone="textMuted">
        {active.lead && leadLabel ? leadLabel : ' '}
      </Text>
      <Text variant="xl" tone="textHeading" numberOfLines={1} style={{ textAlign: 'center' }}>
        {active.name}
      </Text>
      {active.subtitle ? (
        <Text variant="sm" tone="accentInk" numberOfLines={1} style={{ textAlign: 'center' }}>
          {active.subtitle}
        </Text>
      ) : null}
    </View>
  )
}

/** Kept for compact pickers; prefer TargetCarousel for the new-conversation hero. */
export function TargetChip({
  item,
  selected,
  onPress,
  leadLabel,
}: {
  item: TargetItem
  selected?: boolean
  onPress?: () => void
  leadLabel?: string
}) {
  const tokens = useTokens()
  return (
    <Pressable
      onPress={onPress}
      style={{
        alignItems: 'center',
        gap: tokens.spacing.xs,
        padding: tokens.spacing.sm,
        minWidth: 72,
      }}
    >
      <Avatar name={item.name} ai size={40} />
      <Text variant="xs" tone={selected ? 'textHeading' : 'textSecondary'} numberOfLines={1}>
        {item.name}
      </Text>
      {item.lead ? (
        <Text variant="2xs" tone="accentInk">
          {leadLabel ?? 'Lead'}
        </Text>
      ) : null}
    </Pressable>
  )
}
