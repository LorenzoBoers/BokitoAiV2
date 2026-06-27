import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { router } from 'expo-router'
import {
  useBadgeCounts,
  useThreadsInfinite,
} from '../../src/hooks/useMessagingQueries'
import type { Thread } from '../../src/lib/api'
import { colors, spacing } from '../../src/theme'

const VIEWS = [
  { id: 'all_open', label: 'Open', countKey: 'all' as const },
  { id: 'mine', label: 'Mine', countKey: 'my' as const },
  { id: 'unassigned', label: 'Unassigned', countKey: 'unassigned' as const },
  { id: 'awaiting_decision', label: 'Decisions', countKey: null },
] as const

const CHANNELS = [
  { id: '', label: 'All channels' },
  { id: 'email', label: 'Email' },
  { id: 'widget', label: 'Widget' },
  { id: 'chat', label: 'Chat' },
  { id: 'internal', label: 'Internal' },
] as const

const FOLDERS = [
  { id: '', label: 'All folders' },
  { id: 'external', label: 'External' },
  { id: 'internal', label: 'Internal' },
] as const

function timeLabel(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function badgeLabel(count: number): string {
  if (count <= 0) return ''
  return count > 99 ? '99+' : String(count)
}

export default function InboxScreen() {
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('all_open')
  const [search, setSearch] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [channel, setChannel] = useState('')
  const [folder, setFolder] = useState('')

  const filters = useMemo(
    () => ({
      view,
      search: search || undefined,
      channel: channel || undefined,
      folder: folder || undefined,
      per_page: 30,
    }),
    [view, search, channel, folder],
  )

  const { data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage, refetch, isRefetching } =
    useThreadsInfinite(filters)
  const { data: badges } = useBadgeCounts()

  const threads = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data],
  )

  const applySearch = () => setSearch(searchDraft.trim())

  return (
    <View style={styles.root}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search threads"
          placeholderTextColor={colors.textMuted}
          value={searchDraft}
          onChangeText={setSearchDraft}
          onSubmitEditing={applySearch}
          returnKeyType="search"
        />
        <Pressable style={styles.searchButton} onPress={applySearch}>
          <Text style={styles.searchButtonText}>Search</Text>
        </Pressable>
      </View>

      <View style={styles.tabs}>
        {VIEWS.map((option) => {
          const count =
            option.countKey && badges
              ? badges.inbox_by_queue[option.countKey]
              : option.id === 'awaiting_decision'
                ? badges?.agents_attention ?? 0
                : 0
          const badge = badgeLabel(count)
          return (
            <Pressable
              key={option.id}
              style={[styles.tab, view === option.id && styles.tabActive]}
              onPress={() => setView(option.id)}
            >
              <Text style={[styles.tabText, view === option.id && styles.tabTextActive]}>
                {option.label}
              </Text>
              {badge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ) : null}
            </Pressable>
          )
        })}
      </View>

      <FlatList
        horizontal
        data={CHANNELS}
        keyExtractor={(item) => item.id || 'all-channels'}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chips}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.chip, channel === item.id && styles.chipActive]}
            onPress={() => setChannel(item.id)}
          >
            <Text style={[styles.chipText, channel === item.id && styles.chipTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        )}
      />

      <FlatList
        horizontal
        data={FOLDERS}
        keyExtractor={(item) => item.id || 'all-folders'}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chips}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.chip, folder === item.id && styles.chipActive]}
            onPress={() => setFolder(item.id)}
          >
            <Text style={[styles.chipText, folder === item.id && styles.chipTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        )}
      />

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
          renderItem={({ item }) => <ThreadRow thread={item} />}
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator color={colors.accent} style={styles.footerLoader} />
            ) : null
          }
          ListEmptyComponent={<Text style={styles.empty}>No threads in this view.</Text>}
        />
      )}
    </View>
  )
}

function ThreadRow({ thread }: { thread: Thread }) {
  return (
    <Pressable style={styles.row} onPress={() => router.push(`/thread/${thread.id}`)}>
      <View style={styles.rowHeader}>
        <Text style={[styles.subject, thread.has_unread && styles.subjectUnread]} numberOfLines={1}>
          {thread.is_pinned ? '[Pinned] ' : ''}
          {thread.email_subject || '(no subject)'}
        </Text>
        <Text style={styles.time}>{timeLabel(thread.last_message_at)}</Text>
      </View>
      <View style={styles.rowMeta}>
        <Text style={styles.contact} numberOfLines={1}>
          {thread.contact_name || thread.contact_email || thread.channel}
        </Text>
        <View style={styles.channelBadge}>
          <Text style={styles.channelText}>{thread.channel}</Text>
        </View>
        {thread.has_unread ? <View style={styles.unreadDot} /> : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  searchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  searchInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    color: colors.textPrimary,
    fontSize: 14,
  },
  searchButton: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  searchButtonText: { color: colors.accent, fontWeight: '600', fontSize: 13 },
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
    borderRadius: 999,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  tabActive: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
  tabText: { color: colors.textSecondary, fontSize: 13 },
  tabTextActive: { color: colors.accent, fontWeight: '600' },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  chipsScroll: { maxHeight: 40, marginBottom: spacing.sm },
  chips: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  chip: {
    borderRadius: 999,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  chipActive: { backgroundColor: colors.elevated, borderColor: colors.textMuted },
  chipText: { color: colors.textMuted, fontSize: 12 },
  chipTextActive: { color: colors.textPrimary, fontWeight: '600' },
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
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  contact: { color: colors.textSecondary, fontSize: 13, flexShrink: 1 },
  channelBadge: {
    borderRadius: 6,
    backgroundColor: colors.elevated,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  channelText: { color: colors.textMuted, fontSize: 11 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginLeft: 'auto',
  },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl * 2 },
  footerLoader: { marginVertical: spacing.lg },
})
