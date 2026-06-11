import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import {
  getThread,
  markThreadRead,
  replyToThread,
  resolveThreadDecision,
  type ThreadDetail,
  type ThreadMessage,
} from '../../src/lib/api'
import { onGatewayEvent } from '../../src/lib/gateway'
import { colors, spacing } from '../../src/theme'

function isInbound(message: ThreadMessage): boolean {
  return message.direction === 'inbound'
}

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [detail, setDetail] = useState<ThreadDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [busyDecision, setBusyDecision] = useState<string | null>(null)
  const listRef = useRef<FlatList<ThreadMessage>>(null)

  const load = useCallback(async () => {
    if (!id) return
    const result = await getThread(id)
    setDetail(result)
  }, [id])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await load()
        if (id) void markThreadRead(id).catch(() => undefined)
      } catch {
        // thread not reachable; show empty state
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, load])

  useEffect(() => {
    if (!id) return
    return onGatewayEvent(`signal:${id}`, () => {
      void load()
    })
  }, [id, load])

  const send = async () => {
    const bodyText = draft.trim()
    if (!bodyText || sending || !id) return
    setSending(true)
    try {
      await replyToThread(id, bodyText)
      setDraft('')
      await load()
    } catch {
      // keep draft so user can retry
    } finally {
      setSending(false)
    }
  }

  const resolve = async (message: ThreadMessage, action: 'approved' | 'rejected') => {
    if (!id || busyDecision) return
    setBusyDecision(message.id)
    try {
      await resolveThreadDecision(id, message.id, action)
      await load()
    } catch {
      // keep controls; user can retry
    } finally {
      setBusyDecision(null)
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  const thread = detail?.thread
  const messages = (detail?.messages ?? []).filter((m) => m.kind !== 'event')

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen options={{ title: thread?.email_subject || 'Thread' }} />
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => {
          if (item.kind === 'decision_request') {
            const open = item.send_status !== 'resolved'
            return (
              <View style={styles.decisionCard}>
                <Text style={styles.decisionLabel}>Decision requested</Text>
                <Text style={styles.decisionBody}>{item.body_text}</Text>
                {open ? (
                  <View style={styles.decisionActions}>
                    <Pressable
                      style={[styles.decisionButton, styles.approve, busyDecision === item.id && styles.disabled]}
                      onPress={() => void resolve(item, 'approved')}
                    >
                      <Text style={styles.decisionButtonText}>Approve</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.decisionButton, styles.reject, busyDecision === item.id && styles.disabled]}
                      onPress={() => void resolve(item, 'rejected')}
                    >
                      <Text style={styles.decisionButtonText}>Reject</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            )
          }
          if (item.kind === 'note') {
            return (
              <View style={styles.noteCard}>
                <Text style={styles.noteLabel}>Internal note</Text>
                <Text style={styles.noteText}>{item.body_text}</Text>
              </View>
            )
          }
          const inbound = isInbound(item)
          return (
            <View style={[styles.bubble, inbound ? styles.bubbleIn : styles.bubbleOut]}>
              {inbound && item.from_address ? (
                <Text style={styles.fromLabel}>{item.from_address}</Text>
              ) : null}
              <Text style={styles.bubbleText}>{item.body_text}</Text>
            </View>
          )
        }}
        ListEmptyComponent={<Text style={styles.empty}>No messages yet.</Text>}
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Write a reply"
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <Pressable
          style={[styles.sendButton, (sending || !draft.trim()) && styles.disabled]}
          onPress={() => void send()}
        >
          {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sendText}>Send</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  list: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  bubble: {
    maxWidth: '88%',
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  bubbleIn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.elevated,
    borderColor: colors.border,
    borderWidth: 1,
  },
  bubbleOut: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
  },
  fromLabel: { color: colors.textMuted, fontSize: 11, marginBottom: 2 },
  bubbleText: { color: colors.textHeading, fontSize: 15, lineHeight: 21 },
  decisionCard: {
    backgroundColor: colors.surface,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  decisionLabel: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  decisionBody: { color: colors.textPrimary, fontSize: 14, lineHeight: 20 },
  decisionActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  decisionButton: { flex: 1, borderRadius: 9, paddingVertical: 9, alignItems: 'center' },
  approve: { backgroundColor: colors.accent },
  reject: { backgroundColor: colors.elevated, borderColor: colors.border, borderWidth: 1 },
  decisionButtonText: { color: colors.textHeading, fontWeight: '600', fontSize: 13 },
  noteCard: {
    backgroundColor: colors.accentMuted,
    borderRadius: 10,
    padding: spacing.md,
    gap: 2,
  },
  noteLabel: { color: colors.accent, fontSize: 11, fontWeight: '600' },
  noteText: { color: colors.textPrimary, fontSize: 14 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl * 2 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    color: colors.textPrimary,
    fontSize: 15,
  },
  sendButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
  },
  disabled: { opacity: 0.5 },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 14 },
})
