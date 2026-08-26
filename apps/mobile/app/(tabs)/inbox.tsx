import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { ChannelBadge } from '../../src/components/ChannelGlyph'
import EmptyState from '../../src/components/EmptyState'
import { LiveBanner, StatusBanner } from '../../src/components/StatusBanner'
import { useCopy } from '../../src/context/LocaleContext'
import { useTheme, useThemedStyles } from '../../src/context/ThemeContext'
import { useBadgeCounts, useThreadsInfinite } from '../../src/hooks/useMessagingQueries'
import type { Thread } from '../../src/lib/api'
import { channelLabel } from '../../src/lib/channel'
import { WEB_APP_URL } from '../../src/lib/config'
import { agentRoleLabel, categoryLabel, displayThreadPreview, displayThreadTitle, relativeTime, urgencyLabel, urgencyTier } from '../../src/lib/format'
import { coerceInboxView, inboxFolderParam, viewsForFolder, type InboxViewId } from '../../src/lib/inbox-views'
import { radius, spacing, type ColorTokens } from '../../src/theme'

const CHANNELS = ['', 'email', 'widget', 'whatsapp', 'slack', 'internal'] as const
const FOLDERS = ['', 'external', 'internal'] as const

function badgeLabel(count: number): string {
  if (count <= 0) return ''
  return count > 99 ? '99+' : String(count)
}

export default function InboxScreen() {
  const { t, locale } = useCopy()
  const { colors } = useTheme()
  const styles = useThemedStyles(inboxStyles)
  const [view, setView] = useState<InboxViewId>('all_open')
  const [search, setSearch] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [channel, setChannel] = useState('')
  const [folder, setFolder] = useState('external')
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchDraft])

  const filters = useMemo(
    () => ({
      view,
      search: search || undefined,
      channel: channel || undefined,
      folder: inboxFolderParam(view, folder),
      per_page: 30,
    }),
    [view, search, channel, folder],
  )

  const { data, isLoading, isError, isFetchingNextPage, fetchNextPage, hasNextPage, refetch, isRefetching } =
    useThreadsInfinite(filters)
  const { data: badges } = useBadgeCounts()

  const threads = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data])
  const filtersActive = Boolean(channel)

  const views = viewsForFolder(folder)

  const viewLabel = (id: InboxViewId) => {
    if (id === 'all_open') return t('inbox.open')
    if (id === 'mine') return t('inbox.mine')
    if (id === 'unassigned') return t('inbox.unassigned')
    if (id === 'closed') return t('inbox.closed')
    if (id === 'snoozed') return t('inbox.snoozed')
    if (id === 'spam') return t('inbox.spam')
    if (id === 'updates') return t('inbox.updates')
    if (id === 'results') return t('inbox.results')
    if (id === 'pinned') return t('inbox.pinned')
    return t('inbox.decisions')
  }

  const viewCount = (id: InboxViewId): number => {
    if (id === view) return data?.pages[0]?.itemsTotal ?? 0
    if (id === 'awaiting_decision') return badges?.agents_attention ?? 0
    if (folder === 'internal') return 0
    if (id === 'mine') return badges?.inbox_by_queue.my ?? 0
    if (id === 'unassigned') return badges?.inbox_by_queue.unassigned ?? 0
    return 0
  }

  const emptyTitle = () => {
    if (isError) return t('inbox.error')
    if (view === 'awaiting_decision') return t('inbox.emptyDecisions')
    if (view === 'snoozed') return t('inbox.emptySnoozed')
    if (view === 'spam') return t('inbox.emptySpam')
    if (view === 'updates') return t('inbox.emptyUpdates')
    if (view === 'results') return t('inbox.emptyResults')
    if (view === 'pinned') return t('inbox.emptyPinned')
    if (folder === 'external') return t('inbox.emptyCustomers')
    if (folder === 'internal') return t('inbox.emptyTeam')
    return t('inbox.empty')
  }

  const emptyBody = () => {
    if (isError) return undefined
    if (view === 'awaiting_decision') return t('inbox.emptyDecisionsHint')
    if (view === 'snoozed') return t('inbox.emptySnoozedHint')
    if (view === 'updates') return t('inbox.emptyUpdatesHint')
    if (view === 'results') return t('inbox.emptyResultsHint')
    if (folder === 'external') return t('inbox.emptyCustomersHint')
    if (folder === 'internal') return t('inbox.emptyTeamHint')
    return t('inbox.emptyHint')
  }

  const openCompose = () => {
    Alert.alert(t('inbox.compose'), t('inbox.composeHint'), [
      {
        text: t('inbox.newCustomer'),
        onPress: () => void Linking.openURL(`${WEB_APP_URL}/communication/new`),
      },
      { text: t('inbox.newChat'), onPress: () => router.push('/(tabs)/assistant') },
      { text: t('common.cancel'), style: 'cancel' },
    ])
  }

  const selectFolder = (next: string) => {
    setFolder(next)
    setView(coerceInboxView(next, view))
  }

  const labelForChannel = (id: string) => (id ? channelLabel(id, locale) : t('inbox.allChannels'))

  return (
    <View style={styles.root}>
      <LiveBanner />
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('inbox.search')}
          placeholderTextColor={colors.textMuted}
          value={searchDraft}
          onChangeText={setSearchDraft}
          returnKeyType="search"
        />
        <Pressable
          style={styles.filterToggle}
          onPress={openCompose}
          accessibilityLabel={t('inbox.compose')}
        >
          <Ionicons name="create-outline" size={16} color={colors.textMuted} />
        </Pressable>
        <Pressable
          style={[styles.filterToggle, (filtersOpen || filtersActive) && styles.filterToggleOn]}
          onPress={() => setFiltersOpen((v) => !v)}
        >
          <Ionicons name="options-outline" size={16} color={filtersOpen || filtersActive ? colors.accentInk : colors.textMuted} />
        </Pressable>
      </View>

      {view === 'awaiting_decision' ? null : (
      <FlatList
        horizontal
        data={FOLDERS}
        keyExtractor={(item) => item || 'all-folders'}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chips}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.chip, folder === item && styles.chipActive]}
            onPress={() => selectFolder(item)}
          >
            <Text style={[styles.chipText, folder === item && styles.chipTextActive]}>
              {item === '' ? t('inbox.allFolders') : item === 'external' ? t('inbox.external') : t('inbox.internal')}
            </Text>
          </Pressable>
        )}
      />
      )}

      {isError && threads.length > 0 ? (
        <StatusBanner
          tone="error"
          message={t('inbox.refreshFailed')}
          actionLabel={t('common.retry')}
          onAction={() => void refetch()}
        />
      ) : null}

      <View style={styles.tabs}>
        {views.map((id) => {
          const badge = badgeLabel(viewCount(id))
          return (
            <Pressable
              key={id}
              style={[styles.tab, view === id && styles.tabActive]}
              onPress={() => setView(id)}
            >
              <Text style={[styles.tabText, view === id && styles.tabTextActive]}>{viewLabel(id)}</Text>
              {badge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ) : null}
            </Pressable>
          )
        })}
      </View>

      {!filtersOpen && filtersActive ? (
        <Pressable style={styles.activeFilters} onPress={() => setFiltersOpen(true)}>
          <Text style={styles.activeFiltersText}>
            {channel ? channelLabel(channel, locale) : ''}
          </Text>
        </Pressable>
      ) : null}

      {filtersOpen ? (
        <View>
          <FlatList
            horizontal
            data={CHANNELS}
            keyExtractor={(item) => item || 'all-channels'}
            style={styles.chipsScroll}
            contentContainerStyle={styles.chips}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => (
              <Pressable
                style={[styles.chip, channel === item && styles.chipActive]}
                onPress={() => setChannel(item)}
              >
                <Text style={[styles.chipText, channel === item && styles.chipTextActive]}>
                  {labelForChannel(item)}
                </Text>
              </Pressable>
            )}
          />
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.accent} />
          }
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
          }}
          onEndReachedThreshold={0.4}
          renderItem={({ item }) => <ThreadRow thread={item} styles={styles} />}
          ListFooterComponent={
            isFetchingNextPage ? <ActivityIndicator color={colors.accent} style={styles.footerLoader} /> : null
          }
          ListEmptyComponent={
            <EmptyState
              title={emptyTitle()}
              body={emptyBody()}
              actionLabel={
                isError
                  ? t('common.retry')
                  : folder === 'external'
                    ? t('inbox.openChannels')
                    : t('inbox.openAssistant')
              }
              onAction={() =>
                isError
                  ? void refetch()
                  : folder === 'external'
                    ? void Linking.openURL(`${WEB_APP_URL}/settings/channels`)
                    : router.push('/(tabs)/assistant')
              }
            />
          }
        />
      )}
    </View>
  )
}

function ThreadRow({ thread, styles }: { thread: Thread; styles: ReturnType<typeof StyleSheet.create> }) {
  const { t, locale } = useCopy()
  const { colors } = useTheme()
  const title = displayThreadTitle(thread, locale, {
    visitor: t('inbox.visitor'),
    noSubject: t('inbox.noSubject'),
    unknownSender: t('inbox.unknownSender'),
  })
  const preview = displayThreadPreview(thread, locale)

  return (
    <Pressable style={styles.row} onPress={() => router.push(`/thread/${thread.id}`)}>
      <View style={styles.rowHeader}>
        {thread.is_pinned ? <Ionicons name="pin" size={12} color={colors.accentInk} /> : null}
        <Text style={[styles.subject, thread.has_unread && styles.subjectUnread]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.time}>{relativeTime(thread.last_message_at, locale)}</Text>
      </View>
      {preview ? (
        <Text style={styles.preview} numberOfLines={1}>
          {preview}
        </Text>
      ) : null}
      <View style={styles.rowMeta}>
        <ChannelBadge channel={thread.channel} />
        {urgencyTier(thread.urgency) === 'urgent' || urgencyTier(thread.urgency) === 'high' ? (
          <Text style={styles.urgency}>{urgencyLabel(thread.urgency, locale)}</Text>
        ) : null}
        {thread.category ? (
          <Text style={styles.agent} numberOfLines={1}>
            {categoryLabel(thread.category, locale)}
          </Text>
        ) : null}
        {thread.agent_name ? (
          <Text style={styles.agent} numberOfLines={1}>
            {thread.agent_name}
          </Text>
        ) : thread.agent_kind ? (
          <Text style={styles.agent} numberOfLines={1}>
            {agentRoleLabel(thread.agent_kind, locale)}
          </Text>
        ) : null}
        {thread.has_unread ? <View style={styles.unreadDot} /> : null}
      </View>
    </Pressable>
  )
}

function inboxStyles(colors: ColorTokens) {
  return {
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 9,
    color: colors.textPrimary,
    fontSize: 14,
  },
  filterToggle: { padding: 4 },
  filterToggleOn: {
    backgroundColor: colors.accentMuted,
    borderRadius: radius.sm,
  },
  activeFilters: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  activeFiltersText: { color: colors.accentInk, fontSize: 12, fontWeight: '600' },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  tabActive: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
  tabText: { color: colors.textSecondary, fontSize: 13 },
  tabTextActive: { color: colors.accentInk, fontWeight: '600' },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: colors.accentFg, fontSize: 10, fontWeight: '700' },
  chipsScroll: { maxHeight: 40, marginBottom: spacing.sm },
  chips: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  chip: {
    borderRadius: radius.pill,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  chipActive: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
  chipText: { color: colors.textMuted, fontSize: 12 },
  chipTextActive: { color: colors.accentInk, fontWeight: '600' },
  row: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  subject: { flex: 1, color: colors.textPrimary, fontSize: 15 },
  subjectUnread: { color: colors.textHeading, fontWeight: '700' },
  time: { color: colors.textMuted, fontSize: 12 },
  preview: { color: colors.textSecondary, fontSize: 13 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  agent: { color: colors.textMuted, fontSize: 12, flexShrink: 1 },
  urgency: { color: colors.warning, fontSize: 11, fontWeight: '700' },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginLeft: 'auto',
  },
  footerLoader: { marginVertical: spacing.lg },
  }
}
