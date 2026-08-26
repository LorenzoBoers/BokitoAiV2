import { Ionicons } from '@expo/vector-icons'
import { StyleSheet, Text, View } from 'react-native'
import { useCopy } from '../context/LocaleContext'
import { useTheme } from '../context/ThemeContext'
import { channelIcon, channelKind, channelLabel } from '../lib/channel'

type Props = {
  channel: string
  size?: number
  showLabel?: boolean
}

export default function ChannelGlyph({ channel, size = 13, showLabel = false }: Props) {
  const { locale } = useCopy()
  const { colors } = useTheme()
  return (
    <View style={styles.row}>
      <Ionicons name={channelIcon(channel)} size={size} color={colors.textMuted} />
      {showLabel ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>{channelLabel(channel, locale)}</Text> : null}
    </View>
  )
}

export function ChannelBadge({ channel }: { channel: string }) {
  const { locale } = useCopy()
  const { colors } = useTheme()
  return (
    <View style={[styles.badge, { backgroundColor: colors.elevated }]}>
      <Ionicons name={channelIcon(channelKind(channel))} size={11} color={colors.textMuted} />
      <Text style={{ color: colors.textMuted, fontSize: 11 }}>{channelLabel(channel, locale)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
})
