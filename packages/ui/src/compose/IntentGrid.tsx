import { Pressable, ScrollView, View } from 'react-native'
import { Icon } from '../Icon'
import type { IconName } from '../icons'
import { Text } from '../Text'
import { useTokens } from '../theme'

export type IntentItem = {
  id: string
  label: string
  icon: IconName
  onPress: () => void
}

/** Quiet horizontal intent strip — no heavy bordered tiles. */
export function IntentGrid({ items }: { items: IntentItem[] }) {
  const tokens = useTokens()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, paddingVertical: 2 }}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={item.onPress}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 10,
            paddingVertical: 7,
            borderRadius: tokens.radius.full,
          }}
        >
          <Icon name={item.icon} size={15} color={tokens.color.textMuted} />
          <Text variant="xs" tone="textSecondary">
            {item.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  )
}

export function IntentLinks({ items }: { items: IntentItem[] }) {
  const tokens = useTokens()
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: tokens.spacing.md }}>
      {items.map((item) => (
        <Pressable key={item.id} onPress={item.onPress}>
          <Text variant="xs" tone="textMuted">
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}
