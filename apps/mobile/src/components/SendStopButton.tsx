import { ActivityIndicator, Pressable } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme, useThemedStyles } from '../context/ThemeContext'
import type { ColorTokens } from '../theme'

type Props = {
  streaming: boolean
  canSend: boolean
  onSend: () => void
  onStop: () => void
  busy?: boolean
}

export default function SendStopButton({ streaming, canSend, onSend, onStop, busy }: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(sendStyles)
  const disabled = streaming ? false : !canSend || busy

  return (
    <Pressable
      style={[styles.button, disabled && styles.disabled]}
      onPress={() => (streaming ? onStop() : onSend())}
      disabled={disabled}
    >
      {busy && !streaming ? (
        <ActivityIndicator color={colors.accentFg} size="small" />
      ) : streaming ? (
        <Ionicons name="stop" size={16} color={colors.accentFg} />
      ) : (
        <Ionicons name="send" size={16} color={colors.accentFg} />
      )}
    </Pressable>
  )
}

function sendStyles(colors: ColorTokens) {
  return {
    button: {
      backgroundColor: colors.accent,
      borderRadius: 18,
      width: 36,
      height: 36,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    disabled: { opacity: 0.5 },
  }
}
