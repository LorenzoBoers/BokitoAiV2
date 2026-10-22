import { View } from 'react-native'
import { Text } from './Text'
import { useTokens, type ColorName } from './theme'

export type BadgeTone = 'neutral' | 'accent' | 'ai' | 'success' | 'warning' | 'error' | 'info'

const TONE: Record<BadgeTone, { fg: ColorName; bg: ColorName }> = {
  neutral: { fg: 'textSecondary', bg: 'bgHover' },
  accent: { fg: 'accentInk', bg: 'bgHover' },
  ai: { fg: 'aiInk', bg: 'bgHover' },
  success: { fg: 'statusSuccess', bg: 'bgHover' },
  warning: { fg: 'statusWarning', bg: 'bgHover' },
  error: { fg: 'statusError', bg: 'bgHover' },
  info: { fg: 'statusInfo', bg: 'bgHover' },
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const tokens = useTokens()
  const colors = TONE[tone]
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: tokens.color[colors.bg],
        borderRadius: tokens.radius.full,
        paddingHorizontal: tokens.spacing.sm,
        paddingVertical: 2,
      }}
    >
      <Text variant="xs" tone={colors.fg}>
        {label}
      </Text>
    </View>
  )
}
