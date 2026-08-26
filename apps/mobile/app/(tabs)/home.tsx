import { useEffect, useState } from 'react'
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useAuth } from '../../src/context/AuthContext'
import { useCopy } from '../../src/context/LocaleContext'
import { ChannelBadge } from '../../src/components/ChannelGlyph'
import EmptyState from '../../src/components/EmptyState'
import { LiveBanner, StatusBanner } from '../../src/components/StatusBanner'
import { useGatewayStatus } from '../../src/hooks/useGatewayStatus'
import {
  useBadgeCounts,
  useCockpitSummary,
  useDecisions,
  useNotifications,
  useThreadsInfinite,
} from '../../src/hooks/useMessagingQueries'
import { useTheme, useThemedStyles } from '../../src/context/ThemeContext'
import { displayThreadTitle, firstName, greeting, relativeTime, translateKnownText, urgencyTier } from '../../src/lib/format'
import { loadHideLoopHint, saveHideLoopHint } from '../../src/lib/storage'
import { radius, spacing, type ColorTokens } from '../../src/theme'

export default function HomeScreen() {
  const { user } = useAuth()
  const { t, locale } = useCopy()
  const { colors } = useTheme()
  const styles = useThemedStyles(homeStyles)
  const status = useGatewayStatus()
  const [hideLoop, setHideLoop] = useState(false)
  const { data: badges, refetch: refetchBadges, isRefetching: badgesRefreshing } = useBadgeCounts()
  const { data: summary, refetch: refetchSummary, isRefetching: summaryRefreshing, isError: summaryError } = useCockpitSummary()
  const { data: decisions = [], refetch: refetchDecisions, isRefetching: decisionsRefreshing, isError: decisionsError } = useDecisions()
  const { data: notifications = [], refetch: refetchNotifications, isRefetching: notesRefreshing } = useNotifications()
  const {
    data: threadPages,
    refetch: refetchThreads,
    isRefetching: threadsRefreshing,
    isError: threadsError,
  } = useThreadsInfinite({ view: 'all_open', folder: 'external', per_page: 8 })

  const threads = threadPages?.pages.flatMap((page) => page.items) ?? []
  const customerTotal = threadPages?.pages[0]?.itemsTotal ?? threads.length
  const attention = threads.filter((thread) => {
    const tier = urgencyTier(thread.urgency)
    return thread.has_unread || tier === 'high' || tier === 'urgent'
  })
  const attentionList = (attention.length > 0 ? attention : threads).slice(0, 5)

  useEffect(() => {
    void loadHideLoopHint().then(setHideLoop)
  }, [])

  const refreshing =
    badgesRefreshing || summaryRefreshing || decisionsRefreshing || threadsRefreshing || notesRefreshing
  const refresh = () => {
    void refetchBadges()
    void refetchSummary()
    void refetchDecisions()
    void refetchThreads()
    void refetchNotifications()
  }

  const openCount = customerTotal
  const visitor = t('inbox.visitor')
  const decisionCount = badges?.agents_attention ?? decisions.length
  const name = firstName(user?.display_name, user?.email)
  const statusLabel =
    status === 'connected' ? t('home.connected') : status === 'connecting' ? t('home.connecting') : t('home.offline')

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
    >
      <LiveBanner />
      {summaryError ? (
        <StatusBanner
          tone="error"
          message={t('home.summaryFailed')}
          actionLabel={t('common.retry')}
          onAction={() => void refetchSummary()}
        />
      ) : null}
      <View style={styles.hero}>
        <Text style={styles.greeting}>
          {greeting(locale)}
          {name ? `, ${name}` : ''}
        </Text>
        <Text style={styles.workspace}>
          {user?.tenant?.name ?? t('home.workspace')}
        </Text>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              status === 'connected' && styles.statusOn,
              status === 'connecting' && styles.statusWait,
            ]}
          />
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.stats}>
        <Pressable style={styles.stat} onPress={() => router.push('/(tabs)/inbox')}>
          <Text style={styles.statLabel}>{t('home.openMessages')}</Text>
          <Text style={styles.statValue}>{openCount}</Text>
        </Pressable>
        <Pressable style={styles.stat} onPress={() => router.push('/(tabs)/decisions')}>
          <Text style={styles.statLabel}>{t('home.waitingDecisions')}</Text>
          <Text style={styles.statValue}>{decisionCount}</Text>
          {summary ? (
            <Text style={styles.statSub}>{t('home.autonomy', { pct: Math.round(summary.autonomy_rate_pct) })}</Text>
          ) : null}
        </Pressable>
      </View>

      {!hideLoop ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardTitle}>{t('home.loopTitle')}</Text>
              <Text style={styles.cardHint}>{t('home.loopHint')}</Text>
            </View>
            <Pressable
              onPress={() => {
                setHideLoop(true)
                void saveHideLoopHint()
              }}
              hitSlop={8}
            >
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
          <View style={styles.loopRow}>
            <LoopLink
              icon="mail-outline"
              title={t('home.loopMessages')}
              hint={t('home.loopMessagesHint')}
              styles={styles}
              accent={colors.accentInk}
              onPress={() => router.push('/(tabs)/inbox')}
            />
            <LoopLink
              icon="chatbubble-ellipses-outline"
              title={t('home.loopAgents')}
              hint={t('home.loopAgentsHint')}
              styles={styles}
              accent={colors.accentInk}
              onPress={() => router.push('/(tabs)/assistant')}
            />
            <LoopLink
              icon="checkmark-circle-outline"
              title={t('home.loopGovern')}
              hint={t('home.loopGovernHint')}
              styles={styles}
              accent={colors.accentInk}
              onPress={() => router.push('/(tabs)/decisions')}
            />
          </View>
        </View>
      ) : null}

      <Pressable style={styles.notes} onPress={() => router.push('/notifications')}>
        <Ionicons name="notifications-outline" size={18} color={colors.accentInk} />
        <View style={styles.askText}>
          <Text style={styles.askTitle}>{t('home.notifications')}</Text>
          <Text style={styles.askHint}>
            {t('home.unreadCount', { count: notifications.filter((item) => item.status === 'unread').length })}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </Pressable>

      <Pressable style={styles.ask} onPress={() => router.push('/(tabs)/assistant')}>
        <Ionicons name="sparkles-outline" size={18} color={colors.accentInk} />
        <View style={styles.askText}>
          <Text style={styles.askTitle}>{t('home.askAssistant')}</Text>
          <Text style={styles.askHint}>{t('home.askAssistantHint')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </Pressable>

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{t('home.attention')}</Text>
        <Pressable onPress={() => router.push('/(tabs)/inbox')}>
          <Text style={styles.seeAll}>{t('home.seeAll')}</Text>
        </Pressable>
      </View>
      {threadsError ? (
        <EmptyState title={t('home.loadError')} actionLabel={t('common.retry')} onAction={refresh} />
      ) : attentionList.length === 0 ? (
        <EmptyState title={t('home.emptyAttention')} actionLabel={t('home.askAssistant')} onAction={() => router.push('/(tabs)/assistant')} />
      ) : (
        <View style={styles.card}>
          {attentionList.map((thread, index) => (
            <Pressable
              key={thread.id}
              style={[styles.row, index === attentionList.length - 1 && styles.rowLast]}
              onPress={() => router.push(`/thread/${thread.id}`)}
            >
              <View style={styles.rowBody}>
                <Text style={[styles.rowTitle, thread.has_unread && styles.rowUnread]} numberOfLines={1}>
                  {displayThreadTitle(thread, locale, {
                    visitor,
                    noSubject: t('inbox.noSubject'),
                    unknownSender: t('inbox.unknownSender'),
                  })}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {thread.ai_summary || translateKnownText(thread.email_subject, locale)}
                </Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={styles.rowTime}>{relativeTime(thread.last_message_at, locale)}</Text>
                <ChannelBadge channel={thread.channel} />
              </View>
            </Pressable>
          ))}
        </View>
      )}

      {decisionsError ? (
        <EmptyState title={t('decisions.loadError')} actionLabel={t('common.retry')} onAction={refresh} />
      ) : decisions.length > 0 ? (
        <>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{t('home.waitingDecisions')}</Text>
            <Pressable onPress={() => router.push('/(tabs)/decisions')}>
              <Text style={styles.seeAll}>{t('home.seeAll')}</Text>
            </Pressable>
          </View>
          <View style={styles.card}>
            {decisions.slice(0, 3).map((decision, index) => (
              <Pressable
                key={decision.id}
                style={[styles.row, index === Math.min(decisions.length, 3) - 1 && styles.rowLast]}
                onPress={() =>
                  decision.signal_id ? router.push(`/thread/${decision.signal_id}`) : router.push('/(tabs)/decisions')
                }
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {translateKnownText(decision.title, locale)}
                  </Text>
                  {decision.summary ? (
                    <Text style={styles.rowMeta} numberOfLines={2}>
                      {translateKnownText(decision.summary, locale)}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.rowTime}>{relativeTime(decision.created_at, locale)}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  )
}

function LoopLink({
  icon,
  title,
  hint,
  onPress,
  styles,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap
  title: string
  hint: string
  onPress: () => void
  styles: ReturnType<typeof StyleSheet.create>
  accent: string
}) {
  return (
    <Pressable style={styles.loopItem} onPress={onPress}>
      <Ionicons name={icon} size={16} color={accent} />
      <Text style={styles.loopTitle}>{title}</Text>
      <Text style={styles.loopHint}>{hint}</Text>
    </Pressable>
  )
}

function homeStyles(colors: ColorTokens) {
  return {
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  hero: { gap: 4, paddingTop: spacing.sm },
  greeting: { color: colors.textHeading, fontSize: 24, fontWeight: '700' },
  workspace: { color: colors.textSecondary, fontSize: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.textMuted },
  statusOn: { backgroundColor: colors.success },
  statusWait: { backgroundColor: colors.warning },
  statusText: { color: colors.textMuted, fontSize: 12 },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 6,
  },
  statLabel: { color: colors.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  statValue: { color: colors.textHeading, fontSize: 26, fontWeight: '700' },
  statSub: { color: colors.textMuted, fontSize: 11 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  cardHeaderText: { flex: 1, gap: 4 },
  cardTitle: { color: colors.textHeading, fontSize: 15, fontWeight: '600' },
  cardHint: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  loopRow: { gap: spacing.sm },
  loopItem: {
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  loopTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  loopHint: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  notes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  ask: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.accentMuted,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  askText: { flex: 1, gap: 2 },
  askTitle: { color: colors.textHeading, fontSize: 15, fontWeight: '600' },
  askHint: { color: colors.textSecondary, fontSize: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  sectionTitle: { color: colors.textHeading, fontSize: 15, fontWeight: '600' },
  seeAll: { color: colors.accentInk, fontSize: 13, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLast: { borderBottomWidth: 0 },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { color: colors.textPrimary, fontSize: 14 },
  rowUnread: { color: colors.textHeading, fontWeight: '700' },
  rowMeta: { color: colors.textMuted, fontSize: 12 },
  rowRight: { alignItems: 'flex-end', gap: 6 },
  rowTime: { color: colors.textMuted, fontSize: 11 },
  }
}
