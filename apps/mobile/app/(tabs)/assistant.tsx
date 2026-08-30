import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Stack, useLocalSearchParams, useNavigation } from 'expo-router'
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
import EmptyState from '../../src/components/EmptyState'
import { LiveBanner } from '../../src/components/StatusBanner'
import { useCopy } from '../../src/context/LocaleContext'
import { streamChatMessage, type ChatMessage } from '../../src/lib/api'
import { translateMockAgentBody } from '../../src/lib/format'
import { useTheme, useThemedStyles } from '../../src/context/ThemeContext'
import { spacing, type ColorTokens } from '../../src/theme'

export default function AssistantScreen() {
  const { t, locale } = useCopy()
  const { colors } = useTheme()
  const styles = useThemedStyles(assistantStyles)
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ conversationId?: string }>()
  const [conversationId, setConversationId] = useState<string | null>(null)

  useEffect(() => {
    if (params.conversationId) setConversationId(params.conversationId)
  }, [params.conversationId])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<FlatList<ChatMessage>>(null)

  const {
    data: conversations = [],
    isLoading: loadingConversations,
    isError: conversationsError,
    refetch: refetchConversations,
  } = useConversations()
  const { data: targetsData } = useChatTargets()
  const targets = targetsData?.items ?? []
  const defaultAgentId = targetsData?.default_agent_id ?? null

  useEffect(() => {
    if (selectedAgentId) return
    if (defaultAgentId && targets.some((row) => row.id === defaultAgentId)) {
      setSelectedAgentId(defaultAgentId)
    }
  }, [defaultAgentId, selectedAgentId, targets])

  const activeId = conversationId ?? conversations[0]?.id ?? null
  const { data: messages = [], refetch: refetchMessages, isError: messagesError } = useChatMessages(activeId)
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
    if (!agentId) {
      throw new Error('no-agents')
    }
    const created = await create.mutateAsync({ title: t('assistant.defaultTitle'), agentId })
    setConversationId(created.id)
    if (created.agent_id) setSelectedAgentId(created.agent_id)
    return created.id
  }, [activeId, create, defaultAgentId, selectedAgentId, t])

  const send = async () => {
    const content = draft.trim()
    if (!content || isStreaming) return
    if (!selectedAgentId && !defaultAgentId && targets.length === 0) {
      Alert.alert(t('assistant.noAgentsAvailable'))
      return
    }
    if (!selectedAgentId && !defaultAgentId) {
      Alert.alert(t('assistant.chooseAgent'))
      setPickerOpen(true)
      return
    }
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
        if (err instanceof Error && err.message === 'no-agents') {
          Alert.alert(t('assistant.noAgentsAvailable'))
        } else {
          Alert.alert(t('assistant.sendFailed'))
        }
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
    gatewayStream.reset()
  }

  const handleCreateConversation = async (agentId?: string) => {
    const resolved = agentId ?? selectedAgentId ?? defaultAgentId ?? undefined
    if (!resolved) {
      Alert.alert(t('assistant.noAgentsAvailable'))
      return
    }
    try {
      const created = await create.mutateAsync({ title: t('assistant.newTitle'), agentId: resolved })
      setConversationId(created.id)
      setSelectedAgentId(resolved)
      if (created.agent_id) setSelectedAgentId(created.agent_id)
    } catch {
      Alert.alert(t('assistant.actionFailed'))
    }
  }

  const handleDeleteConversation = (id: string) => {
    Alert.alert(t('assistant.deleteTitle'), t('assistant.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          void remove
            .mutateAsync(id)
            .then(() => {
              if (conversationId === id) setConversationId(null)
            })
            .catch(() => Alert.alert(t('assistant.actionFailed')))
        },
      },
    ])
  }

  const handleRenameConversation = (id: string, title: string) => {
    void rename.mutateAsync({ id, title }).catch(() => Alert.alert(t('assistant.actionFailed')))
  }

  const handleSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId)
    if (activeConversation && activeConversation.agent_id !== agentId) {
      void handleCreateConversation(agentId)
    }
  }

  const loading = loadingConversations && !activeId
  const activeConversation = conversations.find((item) => item.id === activeId)
  const activeAgent =
    targets.find((item) => item.id === (activeConversation?.agent_id ?? selectedAgentId ?? defaultAgentId)) ??
    null
  const headerTitle = activeAgent?.name || activeConversation?.title || t('assistant.defaultTitle')

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle,
      tabBarLabel: t('tabs.assistant'),
    })
  }, [headerTitle, navigation, t])

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding" keyboardVerticalOffset={insets.top}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => void handleCreateConversation(selectedAgentId ?? defaultAgentId ?? undefined)}
                hitSlop={8}
                style={styles.headerButton}
              >
                <Ionicons name="add" size={22} color={colors.textHeading} />
              </Pressable>
              <Pressable onPress={() => setPickerOpen(true)} hitSlop={8} style={styles.headerButton}>
                <Ionicons name="list-outline" size={22} color={colors.textHeading} />
              </Pressable>
            </View>
          ),
        }}
      />

      <LiveBanner />

      {conversationsError ? (
        <EmptyState
          title={t('assistant.loadError')}
          actionLabel={t('common.retry')}
          onAction={() => void refetchConversations()}
        />
      ) : loading ? (
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
                <Text style={item.role === 'user' ? styles.bubbleTextUser : styles.bubbleText}>
                  {item.role === 'assistant' ? translateMockAgentBody(item.content, locale) : item.content}
                </Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <EmptyState
              title={messagesError ? t('assistant.loadError') : t('assistant.empty')}
              body={messagesError ? undefined : t('assistant.emptyHint')}
              actionLabel={messagesError ? t('common.retry') : t('assistant.conversations')}
              onAction={() => (messagesError ? void refetchMessages() : setPickerOpen(true))}
            />
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
            placeholder={t('assistant.placeholder')}
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
        onSelectAgent={handleSelectAgent}
        onCreateConversation={(agentId) => void handleCreateConversation(agentId)}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={handleRenameConversation}
      />
    </KeyboardAvoidingView>
  )
}

function assistantStyles(colors: ColorTokens) {
  return {
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
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
  bubbleTextUser: { color: colors.accentFg, fontSize: 15, lineHeight: 21 },
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
  }
}
