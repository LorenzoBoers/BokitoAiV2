import { Pressable, Text, View } from 'react-native'
import { useCopy } from '../context/LocaleContext'
import { useThemedStyles } from '../context/ThemeContext'
import { useGatewayStatus } from '../hooks/useGatewayStatus'
import { gateway } from '../lib/gateway'
import { spacing, type ColorTokens } from '../theme'

type Props = {
  message: string
  actionLabel?: string
  onAction?: () => void
  tone?: 'warn' | 'error'
}

export function StatusBanner({ message, actionLabel, onAction, tone = 'warn' }: Props) {
  const styles = useThemedStyles(bannerStyles)
  return (
    <Pressable
      style={[styles.banner, tone === 'error' ? styles.error : styles.warn]}
      onPress={onAction}
      disabled={!onAction}
    >
      <Text style={styles.text}>{message}</Text>
      {actionLabel ? <Text style={styles.action}>{actionLabel}</Text> : null}
    </Pressable>
  )
}

export function LiveBanner() {
  const { t } = useCopy()
  const status = useGatewayStatus()
  if (status === 'connected') return null
  return (
    <StatusBanner
      message={status === 'connecting' ? t('live.connecting') : t('live.paused')}
      actionLabel={status === 'disconnected' ? t('live.retry') : undefined}
      onAction={status === 'disconnected' ? () => gateway.reset() : undefined}
    />
  )
}

function bannerStyles(colors: ColorTokens) {
  return {
    banner: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    warn: { backgroundColor: colors.accentMuted },
    error: { backgroundColor: 'rgba(239,68,68,0.12)' },
    text: { flex: 1, color: colors.textHeading, fontSize: 12, lineHeight: 17 },
    action: { color: colors.accentInk, fontSize: 12, fontWeight: '700' as const },
  }
}
