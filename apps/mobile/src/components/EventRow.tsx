import { Text, View } from 'react-native'
import { useCopy } from '../context/LocaleContext'
import { useThemedStyles } from '../context/ThemeContext'
import type { ThreadEvent } from '../lib/api'
import { eventLabel, translateKnownText } from '../lib/format'
import { spacing, type ColorTokens } from '../theme'

type Props = {
  event: ThreadEvent
}

export default function EventRow({ event }: Props) {
  const { locale } = useCopy()
  const styles = useThemedStyles(eventStyles)
  const action = event.payload?.action
  const label =
    typeof action === 'string'
      ? `${eventLabel(event.event_type, locale)}: ${translateKnownText(action, locale)}`
      : eventLabel(event.event_type, locale)
  const time = event.created_at
    ? new Date(event.created_at).toLocaleTimeString(locale === 'nl' ? 'nl-NL' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''

  return (
    <View style={styles.root}>
      <View style={styles.dot} />
      <Text style={styles.label}>{label}</Text>
      {time ? <Text style={styles.time}>{time}</Text> : null}
    </View>
  )
}

function eventStyles(colors: ColorTokens) {
  return {
    root: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.sm,
      paddingVertical: spacing.xs,
      alignSelf: 'center' as const,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.textMuted,
    },
    label: { color: colors.textMuted, fontSize: 12 },
    time: { color: colors.textMuted, fontSize: 11, marginLeft: 'auto' as const },
  }
}
