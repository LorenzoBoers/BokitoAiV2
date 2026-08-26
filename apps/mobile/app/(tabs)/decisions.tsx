import { useState } from 'react'
import { router } from 'expo-router'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native'
import EmptyState from '../../src/components/EmptyState'
import { LiveBanner } from '../../src/components/StatusBanner'
import { useCopy } from '../../src/context/LocaleContext'
import { useDecisions } from '../../src/hooks/useMessagingQueries'
import { approveDecision, deferDecision, rejectDecision, type Decision } from '../../src/lib/api'
import { optionLabel, optionResolveAction, relativeTime, translateKnownText } from '../../src/lib/format'
import { useTheme, useThemedStyles } from '../../src/context/ThemeContext'
import { radius, spacing, type ColorTokens } from '../../src/theme'
import { useQueryClient } from '@tanstack/react-query'
import { messagingKeys } from '../../src/hooks/useMessagingQueries'

export default function DecisionsScreen() {
  const { t, locale } = useCopy()
  const { colors } = useTheme()
  const styles = useThemedStyles(decisionStyles)
  const queryClient = useQueryClient()
  const { data: decisions = [], isLoading, isError, refetch, isRefetching } = useDecisions()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const act = async (decision: Decision, option: Decision['options'][number]) => {
    if (busyId) return
    setBusyId(decision.id)
    setError(null)
    try {
      const action = optionResolveAction(option)
      if (action === 'rejected') {
        await rejectDecision(decision.id, option.id)
      } else if (action === 'deferred') {
        await deferDecision(decision.id, option.id)
      } else {
        await approveDecision(decision.id, option.id)
      }
      await queryClient.invalidateQueries({ queryKey: messagingKeys.decisions })
      await queryClient.invalidateQueries({ queryKey: messagingKeys.badgeCounts })
    } catch {
      setError(t('decisions.error'))
    } finally {
      setBusyId(null)
    }
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <FlatList
      style={styles.root}
      data={decisions}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.accent} />
      }
      ListHeaderComponent={
        <>
          <LiveBanner />
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </>
      }
      renderItem={({ item }) => {
        const options =
          item.options.length > 0
            ? item.options
            : [
                { id: 'approve', label: t('decisions.approve') },
                { id: 'reject', label: t('decisions.reject') },
              ]
        return (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.title}>{translateKnownText(item.title, locale)}</Text>
              <Text style={styles.time}>{relativeTime(item.created_at, locale)}</Text>
            </View>
            {item.summary ? <Text style={styles.summary}>{translateKnownText(item.summary, locale)}</Text> : null}
            {item.signal_id ? (
              <Pressable onPress={() => router.push(`/thread/${item.signal_id}`)}>
                <Text style={styles.threadLink}>{t('decisions.openThread')}</Text>
              </Pressable>
            ) : null}
            <View style={styles.actions}>
              {options.map((option, index) => {
                const action = optionResolveAction(option)
                return (
                  <Pressable
                    key={option.id}
                    style={[
                      styles.button,
                      action === 'rejected' ? styles.reject : action === 'deferred' ? styles.defer : styles.approve,
                      busyId === item.id && styles.buttonDisabled,
                    ]}
                    onPress={() => void act(item, option)}
                  >
                    <Text
                      style={[
                        styles.buttonText,
                        (action === 'rejected' || action === 'deferred') && styles.rejectText,
                      ]}
                    >
                      {optionLabel(option, locale) || (index === 0 ? t('decisions.approve') : t('decisions.reject'))}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        )
      }}
      ListEmptyComponent={
        <EmptyState
          title={isError ? t('decisions.loadError') : t('decisions.empty')}
          body={isError ? undefined : t('decisions.emptyHint')}
          actionLabel={isError ? t('common.retry') : t('decisions.openMessages')}
          onAction={() => (isError ? void refetch() : router.push('/(tabs)/inbox'))}
        />
      }
    />
  )
}

function decisionStyles(colors: ColorTokens) {
  return {
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  error: { color: colors.error, fontSize: 13, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  title: { flex: 1, color: colors.textHeading, fontSize: 15, fontWeight: '600' },
  time: { color: colors.textMuted, fontSize: 12 },
  summary: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  threadLink: { color: colors.accentInk, fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  button: {
    flexGrow: 1,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  approve: { backgroundColor: colors.accent },
  reject: { backgroundColor: colors.elevated, borderColor: colors.border, borderWidth: 1 },
  defer: { backgroundColor: colors.elevated, borderColor: colors.warning, borderWidth: 1 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.accentFg, fontWeight: '600', fontSize: 14 },
  rejectText: { color: colors.textPrimary },
  }
}
