import { ActivityIndicator, Pressable, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../theme'

type Props = {
  streaming: boolean
  canSend: boolean
  onSend: () => void
  onStop: () => void
  busy?: boolean
}

export default function SendStopButton({ streaming, canSend, onSend, onStop, busy }: Props) {
  const disabled = streaming ? false : !canSend || busy

  return (
    <Pressable
      style={[styles.button, disabled && styles.disabled]}
      onPress={() => (streaming ? onStop() : onSend())}
      disabled={disabled}
    >
      {busy && !streaming ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : streaming ? (
        <Ionicons name="stop" size={16} color="#fff" />
      ) : (
        <Ionicons name="send" size={16} color="#fff" />
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.accent,
    borderRadius: 18,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
})
