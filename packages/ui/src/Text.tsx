import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native'
import type { FontSizeToken } from '@bokito/ui-tokens'
import { useTokens, type ColorName } from './theme'

export function Text({
  variant = 'base',
  tone = 'textPrimary',
  style,
  ...rest
}: RNTextProps & {
  variant?: FontSizeToken
  tone?: ColorName
}) {
  const tokens = useTokens()
  const scale = tokens.fontSize[variant]
  const flat: TextStyle = {
    fontSize: scale.fontSize,
    lineHeight: scale.lineHeight,
    color: tokens.color[tone],
    fontFamily: tokens.fontFamily.sansNative,
  }
  return <RNText {...rest} style={[flat, style]} />
}
