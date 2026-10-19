import { useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { ChannelBadge } from '../../src/components/ChannelGlyph'
import EmptyState from '../../src/components/EmptyState'
import { useCopy } from '../../src/context/LocaleContext'
import { useTheme, useThemedStyles } from '../../src/context/ThemeContext'
import { useThreadsInfinite } from '../../src/hooks/useMessagingQueries'
import type { Thread } from '../../src/lib/api'
import { displayThreadPreview, displayThreadTitle, relativeTime } from '../../src/lib/format'
import { radius, spacing, type ColorTokens } from '../../src/theme'

export default function ConversationsScreen() {
  const { t, locale } = useCopy()
  const { colors } = useTheme()
  const styles = useThemedStyles(listStyles)
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')

  const filters = useMemo(
    () => ({ view: 'for_you' as const, search: search || undefined, per_page: 30 }),
    [search],
  )
  const { data, isLoading, isError, isFetchingNextPage, fetchNextPage, hasNextPage, refetch, isRefetching } =
    useThreadsInfinite(filters)
  const threads = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data])

  return (
    <View style={styles.root}>
      <TextInput
        value={searchDraft}
        onChangeText={(value) => {
          setSearchDraft(value)
          setSearch(value.trim())
        }}
        placeholder={t('inbox.search')}
        placeholderTextColor={colors.textMuted}
        style={styles.search}
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
          renderItem={({ item }) => <Row thread={item} />}
          ListFooterComponent={
            isFetchingNextPage ? <ActivityIndicator color={colors.accent} style={styles.footer} /> : null
          }
          ListEmptyComponent={
            <EmptyState
              title={isError ? t('inbox.error') : t('inbox.emptyForYou')}
              body={isError ? undefined : t('inbox.emptyForYouHint')}
              actionLabel={isError ? t('common.retry') : undefined}
              onAction={isError ? () => void refetch() : undefined}
            />
          }
        />
      )}
    </View>
  )
}

function Row({ thread }: { thread: Thread }) {
  const { t, locale } = useCopy()
  const styles = useThemedStyles(listStyles)
  const title = displayThreadTitle(thread, locale, {
    visitor: t('inbox.visitor'),
    noSubject: t('inbox.noSubject'),
    unknownSender: t('inbox.unknownSender'),
  })
  const preview = displayThreadPreview(thread, locale)
  return (
    <Pressable style={styles.row} onPress={() => router.push(`/thread/${thread.id}`)}>
      <View style={styles.rowHeader}>
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
      <View style={styles.meta}>
        <ChannelBadge channel={thread.channel} />
        {thread.has_unread ? <View style={styles.dot} /> : null}
      </View>
    </Pressable>
  )
}

function listStyles(colors: ColorTokens) {
  return {
    root: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
    search: {
      margin: spacing.lg,
      marginBottom: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      color: colors.textPrimary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 15,
    },
    row: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: spacing.xs,
    },
    rowHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
    subject: { flex: 1, color: colors.textPrimary, fontSize: 15 },
    subjectUnread: { color: colors.textHeading, fontWeight: '600' as const },
    time: { color: colors.textMuted, fontSize: 12 },
    preview: { color: colors.textSecondary, fontSize: 13 },
    meta: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
    footer: { marginVertical: spacing.md },
  }
}
