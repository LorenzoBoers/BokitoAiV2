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
import {
  createConversation,
  listChatMessages,
  listConversations,
  sendChatMessage,
  type ChatMessage,
} from '../../src/lib/api'
import { onGatewayEvent } from '../../src/lib/gateway'
import { colors, spacing } from '../../src/theme'

export default function AssistantScreen() {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const listRef = useRef<FlatList<ChatMessage>>(null)

  const loadMessages = useCallback(async (id: string) => {
    const rows = await listChatMessages(id)
    setMessages(rows.filter((m) => m.role === 'user' || m.role === 'assistant'))
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const conversations = await listConversations()
        let target = conversations[0]
        if (!target) {
          target = await createConversation('Assistant')
        }
        if (cancelled) return
        setConversationId(target.id)
        await loadMessages(target.id)
      } catch {
        // surface stays empty; user can retry by sending
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadMessages])

  useEffect(() => {
    if (!conversationId) return
    return onGatewayEvent(`signal:${conversationId}`, () => {
      void loadMessages(conversationId)
    })
  }, [conversationId, loadMessages])

  const send = async () => {
    const content = draft.trim()
    if (!content || sending) return
    setDraft('')
    setSending(true)
    const optimistic: ChatMessage = { id: `local-${Date.now()}`, role: 'user', content }
    setMessages((prev) => [...prev, optimistic])
    try {
      let id = conversationId
      if (!id) {
        const conversation = await createConversation('Assistant')
        id = conversation.id
        setConversationId(id)
      }
      const result = await sendChatMessage(id, content)
      setMessages((prev) => [...prev, { ...result.message }])
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      setDraft(content)
    } finally {
      setSending(false)
    }
  }

  if (loading) {
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
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}>
            <Text style={styles.bubbleText}>{item.content}</Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>Ask your assistant anything about your workspace.</Text>
        }
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Message your assistant"
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <Pressable
          style={[styles.sendButton, (sending || !draft.trim()) && styles.sendDisabled]}
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
    maxWidth: '85%',
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: colors.elevated,
    borderColor: colors.border,
    borderWidth: 1,
  },
  bubbleText: { color: colors.textHeading, fontSize: 15, lineHeight: 21 },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl * 2,
    fontSize: 14,
  },
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
  sendDisabled: { opacity: 0.5 },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 14 },
})
