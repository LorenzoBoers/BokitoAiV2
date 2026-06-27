import { StyleSheet, Text, View } from 'react-native'
import type { ThreadEvent } from '../lib/api'
import { colors, spacing } from '../theme'

type Props = {
  event: ThreadEvent
}

function formatEventLabel(event: ThreadEvent): string {
  const type = event.event_type.replace(/_/g, ' ')
  const action = event.payload?.action
  if (typeof action === 'string') return `${type}: ${action}`
  return type
}

export default function EventRow({ event }: Props) {
  const time = event.created_at
    ? new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <View style={styles.root}>
      <View style={styles.dot} />
      <Text style={styles.label}>{formatEventLabel(event)}</Text>
      {time ? <Text style={styles.time}>{time}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    alignSelf: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textMuted,
  },
  label: { color: colors.textMuted, fontSize: 12 },
  time: { color: colors.textMuted, fontSize: 11, marginLeft: 'auto' },
})
