import { View, type ViewProps } from 'react-native'
import { useTokens } from './theme'

export function Surface({ style, ...rest }: ViewProps) {
  const tokens = useTokens()
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: tokens.color.bgSurface,
          borderColor: tokens.color.border,
          borderWidth: 1,
          borderRadius: tokens.radius.md,
        },
        style,
      ]}
    />
  )
}
