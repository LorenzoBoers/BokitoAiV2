import { useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import EmptyState from '../../src/components/EmptyState'
import { NavRow, NavSection } from '@bokito/ui'
import { listCommunicationNav } from '../../src/lib/api'
import { useCopy } from '../../src/context/LocaleContext'
import { useTheme, useThemedStyles } from '../../src/context/ThemeContext'
import { useThreadsInfinite } from '../../src/hooks/useMessagingQueries'
import type { Thread } from '../../src/lib/api'
import { displayThreadPreview, displayThreadTitle, relativeTime } from '../../src/lib/format'
import { ThreadRow } from '@bokito/ui'
import { radius, spacing, type ColorTokens } from '../../src/theme'

export default function ConversationsScreen() {
  const { t, locale } = useCopy()
  const { colors } = useTheme()
  const styles = useThemedStyles(listStyles)
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState('for_you')
  const [queuesOpen, setQueuesOpen] = useState(false)
  const navQuery = useQuery({ queryKey: ['communication-nav'], queryFn: listCommunicationNav })

  const filters = useMemo(
    () => ({ view, search: search || undefined, per_page: 30 }),
    [search, view],
  )
  const { data, isLoading, isError, isFetchingNextPage, fetchNextPage, hasNextPage, refetch, isRefetching } =
    useThreadsInfinite(filters)
  const threads = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data])

  return (
    <View style={styles.root}>
      <Pressable onPress={() => setQueuesOpen(true)} style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <Text style={{ color: colors.accentInk }}>{t('inbox.queues')}</Text>
      </Pressable>
      <Modal visible={queuesOpen} animationType="slide" onRequestClose={() => setQueuesOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16, gap: 8 }}>
          <NavSection title={t('inbox.queues')}>
            {[
              ['for_you', t('inbox.forYou')],
              ['all', t('inbox.all')],
              ['unassigned', t('inbox.unassigned')],
            ].map(([id, label]) => (
              <NavRow
                key={id}
                label={label}
                active={view === id}
                onPress={() => {
                  setView(id)
                  setQueuesOpen(false)
                }}
              />
            ))}
          </NavSection>
          <NavSection title={t('inbox.folders')}>
            {(navQuery.data?.projects ?? []).map((row) => (
              <NavRow key={row.id} label={row.name} total={row.count} onPress={() => setQueuesOpen(false)} />
            ))}
          </NavSection>
          <NavSection title={t('inbox.flows')}>
            {(navQuery.data?.ticket_tags ?? []).map((row) => (
              <NavRow key={row.id} label={row.name} total={row.count} onPress={() => setQueuesOpen(false)} />
            ))}
          </NavSection>
          <Pressable onPress={() => setQueuesOpen(false)}>
            <Text style={{ color: colors.textMuted }}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </Modal>
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
    <ThreadRow
      title={title}
      preview={preview || undefined}
      time={relativeTime(thread.last_message_at, locale)}
      channel={thread.channel}
      unread={thread.has_unread ? 1 : 0}
      pinned={thread.is_pinned}
      onPress={() => router.push(`/thread/${thread.id}`)}
    />
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
    dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.accent },
    footer: { marginVertical: spacing.md },
  }
}
