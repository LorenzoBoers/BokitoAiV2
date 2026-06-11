import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { listThreads, type Thread } from '../../src/lib/api'
import { onGatewayEvent } from '../../src/lib/gateway'
import { colors, spacing } from '../../src/theme'

const VIEWS = [
  { id: 'all_open', label: 'Open' },
  { id: 'mine', label: 'Mine' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'awaiting_decision', label: 'Decisions' },
] as const

function timeLabel(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function InboxScreen() {
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('all_open')
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (selected: string) => {
    const result = await listThreads(selected)
    setThreads(result.items)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    load(view)
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [view, load])

  useEffect(() => {
    return onGatewayEvent('threads', () => {
      void load(view)
    })
  }, [view, load])

  const refresh = async () => {
    setRefreshing(true)
    try {
      await load(view)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        {VIEWS.map((option) => (
          <Pressable
            key={option.id}
            style={[styles.tab, view === option.id && styles.tabActive]}
            onPress={() => setView(option.id)}
          >
            <Text style={[styles.tabText, view === option.id && styles.tabTextActive]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/thread/${item.id}`)}>
              <View style={styles.rowHeader}>
                <Text style={[styles.subject, item.has_unread && styles.subjectUnread]} numberOfLines={1}>
                  {item.email_subject || '(no subject)'}
                </Text>
                <Text style={styles.time}>{timeLabel(item.last_message_at)}</Text>
              </View>
              <View style={styles.rowMeta}>
                <Text style={styles.contact} numberOfLines={1}>
                  {item.contact_name || item.contact_email || item.channel}
                </Text>
                <View style={styles.channelBadge}>
                  <Text style={styles.channelText}>{item.channel}</Text>
                </View>
                {item.has_unread ? <View style={styles.unreadDot} /> : null}
              </View>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No threads in this view.</Text>}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  tab: {
    borderRadius: 999,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  tabActive: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accent,
  },
  tabText: { color: colors.textSecondary, fontSize: 13 },
  tabTextActive: { color: colors.accent, fontWeight: '600' },
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
})
