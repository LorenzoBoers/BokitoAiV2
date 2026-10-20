import { Image, View } from 'react-native'
import { Text } from './Text'
import { useTokens } from './theme'

export function Avatar({
  name,
  imageUrl,
  ai = false,
  size = 28,
}: {
  name: string
  imageUrl?: string | null
  ai?: boolean
  size?: number
}) {
  const tokens = useTokens()
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: ai ? tokens.color.ai : tokens.color.bgHover,
        }}
      >
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={{ width: size, height: size }} />
        ) : (
          <Text variant="2xs" tone={ai ? 'accentFg' : 'textSecondary'}>
            {initials || '?'}
          </Text>
        )}
      </View>
      {ai ? (
        <View
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: tokens.color.ai,
            borderWidth: 1,
            borderColor: tokens.color.bg,
          }}
        />
      ) : null}
    </View>
  )
}
