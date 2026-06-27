import { useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import DaySeparator from '../../src/components/DaySeparator'
import EventRow from '../../src/components/EventRow'
import MessageBubble from '../../src/components/MessageBubble'
import StreamingBubble from '../../src/components/StreamingBubble'
import ThreadComposer from '../../src/components/ThreadComposer'
import { useSignalStream } from '../../src/hooks/useSignalStream'
import { useThreadDetail, useThreadMutations } from '../../src/hooks/useMessagingQueries'
import type { Attachment, ReplyAction, ThreadEvent, ThreadMessage } from '../../src/lib/api'
import { colors, spacing } from '../../src/theme'

type TimelineItem =
  | { type: 'day'; id: string; label: string }
  | { type: 'message'; id: string; data: ThreadMessage }
  | { type: 'event'; id: string; data: ThreadEvent }

const DAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

function makeDayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function makeDayLabel(date: Date): string {
  const now = new Date()
  const todayKey = makeDayKey(now)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const key = makeDayKey(date)
  if (key === todayKey) return 'Today'
  if (key === makeDayKey(yesterday)) return 'Yesterday'
  return DAY_FORMATTER.format(date)
}

function buildTimeline(messages: ThreadMessage[], events: ThreadEvent[]): TimelineItem[] {
  const entries: Array<{ time: string; item: TimelineItem }> = []

  for (const message of messages) {
    if (message.kind === 'event' || message.kind === 'system_event') continue
    const time = message.received_at ?? message.created_at ?? ''
    entries.push({
      time,
      item: { type: 'message', id: `m-${message.id}`, data: message },
    })
  }

  for (const event of events) {
    if (event.event_type === 'replied' || event.event_type === 'note_added') continue
    entries.push({
      time: event.created_at,
      item: { type: 'event', id: `e-${event.id}`, data: event },
    })
  }

  entries.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

  const items: TimelineItem[] = []
  let lastDayKey = ''
  for (const entry of entries) {
    const date = new Date(entry.time)
    if (Number.isNaN(date.getTime())) {
      items.push(entry.item)
      continue
    }
    const dayKey = makeDayKey(date)
    if (dayKey !== lastDayKey) {
      items.push({ type: 'day', id: `d-${dayKey}`, label: makeDayLabel(date) })
      lastDayKey = dayKey
    }
    items.push(entry.item)
  }
  return items
}

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const threadId = id ?? ''
  const [menuOpen, setMenuOpen] = useState(false)
  const listRef = useRef<FlatList<TimelineItem>>(null)

  const { data: detail, isLoading, refetch } = useThreadDetail(threadId || null)
  const mutations = useThreadMutations(threadId)
  const gatewayStream = useSignalStream(threadId || null)

  const thread = detail?.thread
  const events = detail?.events ?? []
  const messages = detail?.messages ?? []

  const timeline = useMemo(() => buildTimeline(messages, events), [messages, events])

  const showStreamBubble = gatewayStream.streaming || !!gatewayStream.streamText || gatewayStream.steps.length > 0

  const saving =
    mutations.reply.isPending ||
    mutations.note.isPending ||
    mutations.resolveDecision.isPending ||
    mutations.patch.isPending

  const openMenu = () => setMenuOpen(true)
  const closeMenu = () => setMenuOpen(false)

  const confirmDelete = () => {
    closeMenu()
    Alert.alert('Delete thread', 'This thread will be permanently deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void mutations.remove.mutateAsync().then(() => router.back())
        },
      },
    ])
  }

  const menuActions = [
    {
      label: thread?.is_pinned ? 'Unpin' : 'Pin',
      onPress: () => {
        closeMenu()
        void mutations.pin.mutateAsync(!thread?.is_pinned)
      },
    },
    {
      label: thread?.status === 'closed' ? 'Reopen' : 'Close',
      onPress: () => {
        closeMenu()
        void mutations.patch.mutateAsync({ status: thread?.status === 'closed' ? 'open' : 'closed' })
      },
    },
    {
      label: 'Mark unread',
      onPress: () => {
        closeMenu()
        void mutations.markUnread.mutateAsync()
      },
    },
    ...(thread &&
    (thread.ai_paused != null || ['widget', 'chat', 'assistant'].includes(thread.channel))
      ? [
          {
            label: thread.ai_paused ? 'Release to AI' : 'Take over',
            onPress: () => {
              closeMenu()
              void mutations.takeover.mutateAsync(!thread.ai_paused)
            },
          },
        ]
      : []),
    {
      label: 'Delete',
      destructive: true,
      onPress: confirmDelete,
    },
  ]

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen
        options={{
          title: thread?.email_subject || 'Thread',
          headerRight: () => (
            <Pressable onPress={openMenu} hitSlop={8} style={styles.headerButton}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.textHeading} />
            </Pressable>
          ),
        }}
      />

      <FlatList
        ref={listRef}
        data={timeline}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => {
          if (item.type === 'day') return <DaySeparator label={item.label} />
          if (item.type === 'event') return <EventRow event={item.data} />
          return (
            <MessageBubble
              message={item.data}
              events={events}
              resolveBusy={mutations.resolveDecision.isPending}
              onResolve={(messageId, action) =>
                void mutations.resolveDecision.mutateAsync({ messageId, action }).then(() => refetch())
              }
            />
          )
        }}
        ListEmptyComponent={<Text style={styles.empty}>No messages yet.</Text>}
        ListFooterComponent={
          showStreamBubble ? (
            <StreamingBubble
              text={gatewayStream.streamText}
              steps={gatewayStream.steps}
              active={gatewayStream.streaming}
            />
          ) : null
        }
      />

      <ThreadComposer
        saving={saving}
        onReply={async (bodyText, action, attachments: Attachment[]) => {
          await mutations.reply.mutateAsync({ bodyText, action: action as ReplyAction, attachments })
        }}
        onNote={async (bodyText, attachments: Attachment[]) => {
          await mutations.note.mutateAsync({ bodyText, attachments })
        }}
      />

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={closeMenu}>
        <Pressable style={styles.menuBackdrop} onPress={closeMenu}>
          <View style={styles.menuSheet}>
            {menuActions.map((action) => (
              <Pressable
                key={action.label}
                style={styles.menuItem}
                onPress={action.onPress}
              >
                <Text style={[styles.menuText, action.destructive && styles.menuDestructive]}>
                  {action.label}
                </Text>
              </Pressable>
            ))}
            <Pressable style={styles.menuItem} onPress={closeMenu}>
              <Text style={styles.menuText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  headerButton: { marginRight: spacing.sm },
  list: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl * 2 },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: spacing.xl,
  },
  menuItem: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuText: { color: colors.textPrimary, fontSize: 16 },
  menuDestructive: { color: colors.error },
})
