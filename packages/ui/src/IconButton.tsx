import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'
import { Icon } from './Icon'
import type { IconName } from './icons'
import { useTokens } from './theme'

export function IconButton({
  name,
  label,
  color,
  style,
  ...rest
}: PressableProps & {
  name: IconName
  label: string
  color?: string
}) {
  const tokens = useTokens()
  return (
    <Pressable
      accessibilityLabel={label}
      {...rest}
      style={(state: { pressed: boolean }) => {
        const base: ViewStyle = {
          width: 32,
          height: 32,
          borderRadius: tokens.radius.lg,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: state.pressed ? tokens.color.bgHover : 'transparent',
        }
        const extra = typeof style === 'function' ? style(state) : style
        return [base, extra] as StyleProp<ViewStyle>
      }}
    >
      <Icon name={name} color={color} />
    </Pressable>
  )
}
