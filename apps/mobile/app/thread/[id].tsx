import { useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { KeyboardAvoidingView, KeyboardStickyView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import EmptyState from '../../src/components/EmptyState'
import { LiveBanner } from '../../src/components/StatusBanner'
import { ChannelBadge } from '../../src/components/ChannelGlyph'
import DaySeparator from '../../src/components/DaySeparator'
import EventRow from '../../src/components/EventRow'
import MessageBubble from '../../src/components/MessageBubble'
import StreamingBubble from '../../src/components/StreamingBubble'
import ThinkingTrace from '../../src/components/ThinkingTrace'
import ThreadComposer from '../../src/components/ThreadComposer'
import { useCopy } from '../../src/context/LocaleContext'
import { useLastAgentSteps } from '../../src/hooks/useLastAgentSteps'
import { useSignalStream } from '../../src/hooks/useSignalStream'
import { useSavedReplies, useSignalMembers, useThreadDetail, useThreadMutations } from '../../src/hooks/useMessagingQueries'
import { useAuth } from '../../src/context/AuthContext'
import {
  createConversation,
  draftThreadReply,
  getContact,
  invokeThreadAgent,
  listChatTargets,
  listContactThreads,
  patchContact,
  type Attachment,
  type Contact,
  type ReplyAction,
  type Thread,
  type ThreadEvent,
  type ThreadMessage,
} from '../../src/lib/api'
import { isInternalThread } from '../../src/lib/composer'
import { channelLabel, isCustomerChannel } from '../../src/lib/channel'
import { WEB_APP_URL } from '../../src/lib/config'
import {
  categoryLabel,
  displayContactAddress,
  displayThreadTitle,
  humanizeContactName,
  translateKnownText,
  urgencyLabel,
  userNumericId,
} from '../../src/lib/format'
import { useTheme, useThemedStyles } from '../../src/context/ThemeContext'
import { tomorrowMorningIso } from '../../src/lib/inbox-views'
import { radius, spacing, type ColorTokens } from '../../src/theme'

type TimelineItem =
  | { type: 'day'; id: string; label: string }
  | { type: 'message'; id: string; data: ThreadMessage }
  | { type: 'event'; id: string; data: ThreadEvent }

function makeDayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function makeDayLabel(date: Date, todayLabel: string, yesterdayLabel: string, locale: string): string {
  const now = new Date()
  const todayKey = makeDayKey(now)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const key = makeDayKey(date)
  if (key === todayKey) return todayLabel
  if (key === makeDayKey(yesterday)) return yesterdayLabel
  return new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function buildTimeline(
  messages: ThreadMessage[],
  events: ThreadEvent[],
  todayLabel: string,
  yesterdayLabel: string,
  locale: string,
): TimelineItem[] {
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
      items.push({ type: 'day', id: `d-${dayKey}`, label: makeDayLabel(date, todayLabel, yesterdayLabel, locale) })
      lastDayKey = dayKey
    }
    items.push(entry.item)
  }
  return items
}

export default function ThreadScreen() {
  const { t, locale } = useCopy()
  const { colors } = useTheme()
  const styles = useThemedStyles(threadStyles)
  const { user } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const threadId = id ?? ''
  const insets = useSafeAreaInsets()
  const [menuOpen, setMenuOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const [contact, setContact] = useState<Contact | null>(null)
  const [siblings, setSiblings] = useState<Thread[]>([])
  const [draftPreset, setDraftPreset] = useState<{ body: string; nonce: number; asNote?: boolean } | undefined>()
  const [drafting, setDrafting] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [contactNotes, setContactNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const listRef = useRef<FlatList<TimelineItem>>(null)

  const { data: detail, isLoading, isError, refetch } = useThreadDetail(threadId || null)
  const mutations = useThreadMutations(threadId)
  const { data: savedReplies = [] } = useSavedReplies()
  const { data: members = [] } = useSignalMembers()
  const myUserId = userNumericId(user?.id)
  const gatewayStream = useSignalStream(threadId || null)

  const thread = detail?.thread
  const events = detail?.events ?? []
  const messages = detail?.messages ?? []

  const timeline = useMemo(
    () => buildTimeline(messages, events, t('thread.today'), t('thread.yesterday'), locale),
    [messages, events, t, locale],
  )

  const showStreamBubble = gatewayStream.streaming || !!gatewayStream.streamText || gatewayStream.steps.length > 0
  const lastCompletedSteps = useLastAgentSteps(gatewayStream.streaming, gatewayStream.steps)

  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]
      if (message.kind === 'event' || message.kind === 'system_event') continue
      if (message.kind === 'note' || message.kind === 'internal_note') continue
      if (message.direction === 'outbound') return message.id
    }
    return null
  }, [messages])

  const saving =
    mutations.reply.isPending ||
    mutations.note.isPending ||
    mutations.resolveDecision.isPending ||
    mutations.patch.isPending

  const openMenu = () => setMenuOpen(true)
  const closeMenu = () => setMenuOpen(false)

  const failAction = () => Alert.alert(t('thread.actionFailed'), t('thread.actionFailedBody'))

  const runAction = (work: Promise<unknown>) => {
    void work.catch(failAction)
  }

  const confirmDelete = () => {
    closeMenu()
    Alert.alert(t('thread.deleteTitle'), t('thread.deleteBody'), [
      { text: t('thread.cancel'), style: 'cancel' },
      {
        text: t('thread.delete'),
        style: 'destructive',
        onPress: () => {
          void mutations.remove
            .mutateAsync()
            .then(() => router.back())
            .catch(failAction)
        },
      },
    ])
  }

  const openContact = () => {
    setContactOpen(true)
    if (thread?.contact_id) {
      void getContact(thread.contact_id)
        .then((row) => {
          setContact(row)
          setContactNotes(row.notes || '')
        })
        .catch(() => setContact(null))
      void listContactThreads(thread.contact_id)
        .then((page) => setSiblings((page.threads ?? []).filter((item) => item.id !== threadId).slice(0, 4)))
        .catch(() => setSiblings([]))
    }
  }

  const menuActions = [
    {
      label: thread?.is_pinned ? t('thread.unpin') : t('thread.pin'),
      onPress: () => {
        closeMenu()
        runAction(mutations.pin.mutateAsync(!thread?.is_pinned))
      },
    },
    {
      label: thread?.status === 'closed' ? t('thread.reopen') : t('thread.close'),
      onPress: () => {
        closeMenu()
        runAction(mutations.patch.mutateAsync({ status: thread?.status === 'closed' ? 'open' : 'closed' }))
      },
    },
    {
      label: t('thread.markUnread'),
      onPress: () => {
        closeMenu()
        runAction(mutations.markUnread.mutateAsync())
      },
    },
    {
      label: t('thread.assignTo'),
      onPress: () => {
        closeMenu()
        setAssignOpen(true)
      },
    },
    {
      label: t('thread.assignMe'),
      onPress: () => {
        closeMenu()
        const me = members.find((member) => member.email === user?.email || member.id === myUserId)
        if (!me) {
          Alert.alert(t('thread.assignFailed'))
          return
        }
        runAction(mutations.patch.mutateAsync({ assigned_to_user_id: me.id }))
      },
    },
    ...(thread?.assigned_to_user_id
      ? [
          {
            label: t('thread.unassign'),
            onPress: () => {
              closeMenu()
              runAction(mutations.patch.mutateAsync({ assigned_to_user_id: null }))
            },
          },
        ]
      : []),
    {
      label: t('thread.askAssistant'),
      onPress: () => {
        closeMenu()
        void createConversation(
          translateKnownText(thread?.email_subject, locale) || t('assistant.newTitle'),
          undefined,
          threadId,
        )
          .then((created) => {
            router.push({ pathname: '/(tabs)/assistant', params: { conversationId: created.id } })
          })
          .catch(failAction)
      },
    },
    ...(thread && (thread.ai_paused != null || isCustomerChannel(thread.channel) || thread.channel === 'assistant')
      ? [
          {
            label: thread.ai_paused ? t('thread.release') : t('thread.takeover'),
            onPress: () => {
              closeMenu()
              runAction(mutations.takeover.mutateAsync(!thread.ai_paused))
            },
          },
        ]
      : []),
    ...(thread && isCustomerChannel(thread.channel)
      ? [
          {
            label: t('thread.draftReply'),
            onPress: () => {
              closeMenu()
              setDrafting(true)
              void draftThreadReply(threadId)
                .then((result) => {
                  const text = result.draft?.trim()
                  if (text) setDraftPreset({ body: text, nonce: Date.now() })
                  else Alert.alert(t('thread.draftFailed'))
                })
                .catch(() => Alert.alert(t('thread.draftFailed')))
                .finally(() => setDrafting(false))
            },
          },
          {
            label: t('thread.invokeAgent'),
            onPress: () => {
              closeMenu()
              void listChatTargets()
                .then((targets) => {
                  const agentId = thread.agent_id || targets.default_agent_id
                  if (!agentId) throw new Error('no agent')
                  return invokeThreadAgent(threadId, agentId)
                })
                .then(() => {
                  Alert.alert(t('thread.invokeOk'))
                  return refetch()
                })
                .catch(() => Alert.alert(t('thread.invokeFailed')))
            },
          },
          {
            label: thread.snoozed_until ? t('thread.unsnooze') : t('thread.snooze'),
            onPress: () => {
              closeMenu()
              runAction(
                mutations.patch.mutateAsync({
                  snoozed_until: thread.snoozed_until ? null : tomorrowMorningIso(),
                }),
              )
            },
          },
          {
            label: t('thread.spam'),
            onPress: () => {
              closeMenu()
              runAction(mutations.patch.mutateAsync({ status: 'spam' }))
            },
          },
        ]
      : []),
    {
      label: t('thread.delete'),
      destructive: true,
      onPress: confirmDelete,
    },
  ]

  const visitor = t('inbox.visitor')
  const headerTitle = thread
    ? displayThreadTitle(thread, locale, {
        visitor,
        noSubject: t('inbox.noSubject'),
        unknownSender: t('inbox.unknownSender'),
      })
    : t('thread.title')
  const headerSubtitle = thread
    ? thread.contact_name
      ? translateKnownText(thread.email_subject, locale) || channelLabel(thread.channel, locale)
      : channelLabel(thread.channel, locale)
    : ''
  const contactName = humanizeContactName(
    contact?.display_name || thread?.contact_name,
    contact?.address || thread?.contact_email,
    visitor,
  )
  const contactAddress = displayContactAddress(contact?.address || thread?.contact_email)

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  if (isError || !thread) {
    return (
      <View style={styles.root}>
        <EmptyState
          title={isError ? t('thread.loadError') : t('thread.notFound')}
          actionLabel={isError ? t('common.retry') : t('inbox.openAssistant')}
          onAction={() => (isError ? void refetch() : router.replace('/(tabs)/inbox'))}
        />
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior="padding"
      keyboardVerticalOffset={insets.top}
    >
      <Stack.Screen
        options={{
          title: headerTitle,
          headerTitle: () => (
            <Pressable onPress={openContact} style={styles.headerTitle}>
              <Text style={styles.headerTitleText} numberOfLines={1}>
                {headerTitle}
              </Text>
              {headerSubtitle ? (
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {headerSubtitle}
                </Text>
              ) : null}
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={openMenu} hitSlop={8} style={styles.headerButton}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.textHeading} />
            </Pressable>
          ),
        }}
      />

      <LiveBanner />

      {thread?.ai_paused ? (
        <View style={styles.takeoverBanner}>
          <Text style={styles.takeoverText}>{t('thread.aiPaused')}</Text>
        </View>
      ) : null}

      {thread?.ai_summary || thread?.category || thread?.urgency ? (
        <View style={styles.triageBanner}>
          <Text style={styles.triageText} numberOfLines={2}>
            {[
              thread.category ? categoryLabel(thread.category, locale) : null,
              urgencyLabel(thread.urgency, locale),
              thread.ai_summary,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={timeline}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => {
          if (item.type === 'day') return <DaySeparator label={item.label} />
          if (item.type === 'event') return <EventRow event={item.data} />
          const showThought =
            item.data.id === lastAssistantMessageId &&
            lastCompletedSteps.length > 0 &&
            !gatewayStream.streaming
          return (
            <View style={styles.messageBlock}>
              {showThought ? <ThinkingTrace steps={lastCompletedSteps} compact /> : null}
              <MessageBubble
                message={item.data}
                events={events}
                resolveBusy={mutations.resolveDecision.isPending}
                onResolve={(messageId, action, optionId, opts) =>
                  void mutations.resolveDecision
                    .mutateAsync({
                      messageId,
                      action,
                      optionId,
                      body: opts?.body,
                      subject: opts?.subject,
                      sendAs: opts?.sendAs,
                    })
                    .then(() => refetch())
                    .catch(failAction)
                }
                onEditDraft={(draft) => setDraftPreset({ body: draft.body, nonce: Date.now() })}
                onEditNote={(draft) => {
                  setEditingNoteId(draft.messageId)
                  setDraftPreset({ body: draft.body, nonce: Date.now(), asNote: true })
                }}
                onDeleteNote={(messageId) => runAction(mutations.removeNote.mutateAsync(messageId))}
                currentUserId={myUserId}
              />
            </View>
          )
        }}
        ListEmptyComponent={<Text style={styles.empty}>{t('thread.empty')}</Text>}
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

      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <ThreadComposer
          saving={saving}
          streaming={gatewayStream.streaming}
          onStop={() => gatewayStream.reset()}
          noteOnly={isInternalThread(thread)}
          showNoteTab={!isInternalThread(thread)}
          presetDraft={draftPreset}
          threadId={threadId}
          thread={thread}
          savedReplies={savedReplies}
          drafting={drafting}
          onRequestDraft={async () => {
            setDrafting(true)
            try {
              const result = await draftThreadReply(threadId)
              return result.draft ?? ''
            } finally {
              setDrafting(false)
            }
          }}
          onReply={async (bodyText, action, attachments: Attachment[]) => {
            await mutations.reply.mutateAsync({ bodyText, action: action as ReplyAction, attachments })
          }}
          onNote={async (bodyText, attachments: Attachment[]) => {
            if (editingNoteId) {
              await mutations.updateNote.mutateAsync({ messageId: editingNoteId, bodyText })
              setEditingNoteId(null)
              return
            }
            await mutations.note.mutateAsync({ bodyText, attachments })
          }}
        />
      </KeyboardStickyView>

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
              <Text style={styles.menuText}>{t('thread.cancel')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={assignOpen} transparent animationType="fade" onRequestClose={() => setAssignOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setAssignOpen(false)}>
          <View style={styles.menuSheet}>
            <Text style={styles.contactTitle}>{t('thread.assignTo')}</Text>
            {members.map((member) => (
              <Pressable
                key={member.id}
                style={styles.menuItem}
                onPress={() => {
                  setAssignOpen(false)
                  runAction(mutations.patch.mutateAsync({ assigned_to_user_id: member.id }))
                }}
              >
                <Text style={styles.menuText}>
                  {member.name}
                  {member.id === myUserId ? ` · ${t('thread.you')}` : ''}
                </Text>
              </Pressable>
            ))}
            <Pressable style={styles.menuItem} onPress={() => setAssignOpen(false)}>
              <Text style={styles.menuText}>{t('thread.cancel')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={contactOpen} transparent animationType="fade" onRequestClose={() => setContactOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setContactOpen(false)}>
          <View style={styles.contactSheet}>
            <Text style={styles.contactTitle}>{t('thread.contactTitle')}</Text>
            <Text style={styles.contactName}>
              {contactName || contactAddress || '—'}
            </Text>
            {thread ? <ChannelBadge channel={contact?.channel || thread.channel} /> : null}
            {contactAddress ? <Text style={styles.contactMeta}>{contactAddress}</Text> : null}
            {contact?.company ? <Text style={styles.contactMeta}>{contact.company}</Text> : null}
            {(contact?.phone || thread?.contact_phone) ? (
              <Text style={styles.contactMeta}>{contact?.phone || thread?.contact_phone}</Text>
            ) : null}
            {thread?.contact_id ? (
              <View>
                <Text style={styles.contactTitle}>{t('thread.contactNotes')}</Text>
                <TextInput
                  style={styles.notesInput}
                  value={contactNotes}
                  onChangeText={setContactNotes}
                  multiline
                  placeholder={t('thread.notePlaceholder')}
                  placeholderTextColor={colors.textMuted}
                />
                <Pressable
                  style={styles.contactClose}
                  disabled={savingNotes}
                  onPress={() => {
                    if (!thread.contact_id) return
                    setSavingNotes(true)
                    void patchContact(thread.contact_id, { notes: contactNotes })
                      .then((row) => {
                        setContact(row)
                        Alert.alert(t('thread.contactSaved'))
                      })
                      .catch(failAction)
                      .finally(() => setSavingNotes(false))
                  }}
                >
                  <Text style={styles.threadLink}>{t('thread.contactSave')}</Text>
                </Pressable>
              </View>
            ) : contact?.notes ? (
              <Text style={styles.contactMeta}>{contact.notes}</Text>
            ) : null}
            {contact?.thread_count != null ? (
              <Text style={styles.contactMeta}>
                {contact.thread_count} {t('thread.contactThreads')}
              </Text>
            ) : null}
            {siblings.length > 0 ? (
              <View style={styles.siblingBlock}>
                <Text style={styles.contactTitle}>{t('thread.contactOther')}</Text>
                {siblings.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      setContactOpen(false)
                      router.push(`/thread/${item.id}`)
                    }}
                  >
                    <Text style={styles.threadLink} numberOfLines={1}>
                      {displayThreadTitle(item, locale, {
                        visitor,
                        noSubject: t('inbox.noSubject'),
                        unknownSender: t('inbox.unknownSender'),
                      })}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {thread?.contact_id ? (
              <Pressable
                style={styles.contactClose}
                onPress={() => void Linking.openURL(`${WEB_APP_URL}/contacts/${thread.contact_id}`)}
              >
                <Text style={styles.threadLink}>{t('thread.openContactWeb')}</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.contactClose} onPress={() => setContactOpen(false)}>
              <Text style={styles.menuText}>{t('thread.cancel')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  )
}

function threadStyles(colors: ColorTokens) {
  return {
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  headerButton: { marginRight: spacing.sm },
  headerTitle: { alignItems: 'center', maxWidth: 220 },
  headerTitleText: { color: colors.textHeading, fontSize: 15, fontWeight: '600' },
  headerSubtitle: { color: colors.textMuted, fontSize: 11 },
  takeoverBanner: {
    backgroundColor: colors.accentMuted,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  takeoverText: { color: colors.accentInk, fontSize: 12, lineHeight: 17 },
  triageBanner: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  triageText: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  contactSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  contactTitle: {
    color: colors.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  contactName: { color: colors.textHeading, fontSize: 18, fontWeight: '700' },
  contactMeta: { color: colors.textSecondary, fontSize: 13 },
  contactClose: { marginTop: spacing.sm, paddingVertical: spacing.sm },
  siblingBlock: { gap: spacing.sm, marginTop: spacing.sm },
  notesInput: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    minHeight: 72,
    textAlignVertical: 'top' as const,
  },
  list: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  messageBlock: { gap: spacing.xs },
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
  threadLink: { color: colors.accentInk, fontSize: 14, fontWeight: '600' },
  }
}
