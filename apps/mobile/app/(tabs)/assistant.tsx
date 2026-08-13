import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Stack } from 'expo-router'
import { KeyboardAvoidingView, KeyboardStickyView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import ConversationPicker from '../../src/components/ConversationPicker'
import SendStopButton from '../../src/components/SendStopButton'
import StreamingBubble from '../../src/components/StreamingBubble'
import ThinkingTrace from '../../src/components/ThinkingTrace'
import {
  useChatMessages,
  useChatTargets,
  useConversationMutations,
  useConversations,
} from '../../src/hooks/useMessagingQueries'
import { useLastAgentSteps } from '../../src/hooks/useLastAgentSteps'
import { useSignalStream } from '../../src/hooks/useSignalStream'
import { streamChatMessage, type ChatMessage } from '../../src/lib/api'
import { colors, spacing } from '../../src/theme'

export default function AssistantScreen() {
  const insets = useSafeAreaInsets()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<FlatList<ChatMessage>>(null)

  const { data: conversations = [], isLoading: loadingConversations } = useConversations()
  const { data: targetsData } = useChatTargets()
  const targets = targetsData?.items ?? []
  const defaultAgentId = targetsData?.default_agent_id ?? null

  const activeId = conversationId ?? conversations[0]?.id ?? null
  const { data: messages = [], refetch: refetchMessages } = useChatMessages(activeId)
  const gatewayStream = useSignalStream(activeId)
  const { create, rename, remove } = useConversationMutations()

  const visibleMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant')
  const isStreaming = streaming || gatewayStream.streaming
  const showStreamBubble =
    isStreaming || !!streamText || !!gatewayStream.streamText || gatewayStream.steps.length > 0
  const activeStreamText = streaming ? streamText : gatewayStream.streamText
  const activeSteps = gatewayStream.steps
  const lastCompletedSteps = useLastAgentSteps(isStreaming, activeSteps)

  const lastAssistantId = [...visibleMessages].reverse().find((m) => m.role === 'assistant')?.id

  const ensureConversation = useCallback(async () => {
    if (activeId) return activeId
    const agentId = selectedAgentId ?? defaultAgentId ?? undefined
    const created = await create.mutateAsync({ title: 'Assistant', agentId })
    setConversationId(created.id)
    if (created.agent_id) setSelectedAgentId(created.agent_id)
    return created.id
  }, [activeId, create, defaultAgentId, selectedAgentId])

  const send = async () => {
    const content = draft.trim()
    if (!content || isStreaming) return
    setDraft('')
    setStreaming(true)
    setStreamText('')
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const id = await ensureConversation()
      await streamChatMessage(
        id,
        content,
        (delta) => setStreamText((prev) => prev + delta),
        controller.signal,
      )
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        setDraft(content)
      }
    } finally {
      abortRef.current = null
      setStreaming(false)
      setStreamText('')
      void refetchMessages()
    }
  }

  const stopStreaming = () => {
    abortRef.current?.abort()
  }

  const handleCreateConversation = async (agentId?: string) => {
    const created = await create.mutateAsync({ title: 'New conversation', agentId })
    setConversationId(created.id)
    if (agentId) setSelectedAgentId(agentId)
    else if (created.agent_id) setSelectedAgentId(created.agent_id)
  }

  const loading = loadingConversations && !activeId

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding" keyboardVerticalOffset={insets.top}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => setPickerOpen(true)} hitSlop={8} style={styles.headerButton}>
              <Ionicons name="list-outline" size={22} color={colors.textHeading} />
            </Pressable>
          ),
        }}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={visibleMessages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => (
            <View style={styles.messageRow}>
              {item.id === lastAssistantId && lastCompletedSteps.length > 0 && !isStreaming ? (
                <ThinkingTrace steps={lastCompletedSteps} compact />
              ) : null}
              <View
                style={[
                  styles.bubble,
                  item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
                ]}
              >
                <Text style={styles.bubbleText}>{item.content}</Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>Ask your assistant anything about your workspace.</Text>
          }
          ListFooterComponent={
            showStreamBubble ? (
              <StreamingBubble
                text={activeStreamText}
                steps={activeSteps}
                active={isStreaming}
              />
            ) : null
          }
        />
      )}

      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Message your assistant"
            placeholderTextColor={colors.textMuted}
            value={draft}
            onChangeText={setDraft}
            multiline
            editable={!isStreaming}
          />
          <SendStopButton
            streaming={isStreaming}
            canSend={!!draft.trim()}
            onSend={() => void send()}
            onStop={stopStreaming}
          />
        </View>
      </KeyboardStickyView>

      <ConversationPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        conversations={conversations}
        targets={targets}
        selectedId={activeId}
        selectedAgentId={selectedAgentId ?? defaultAgentId}
        loading={loadingConversations}
        onSelectConversation={setConversationId}
        onCreateConversation={(agentId) => void handleCreateConversation(agentId)}
        onDeleteConversation={(id) => void remove.mutate(id)}
        onRenameConversation={(id, title) => void rename.mutate({ id, title })}
      />
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerButton: { marginRight: spacing.sm },
  list: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  messageRow: { gap: spacing.xs },
  bubble: {
    maxWidth: '85%',
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: colors.accent },
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
})
