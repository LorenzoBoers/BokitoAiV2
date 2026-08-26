import { useState } from 'react'
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import MessageAttachments from './MessageAttachments'
import { useCopy } from '../context/LocaleContext'
import { useTheme, useThemedStyles } from '../context/ThemeContext'
import {
  cancelScheduledMessage,
  resolveThreadDecision,
  submitMessageFeedback,
  type ResolveAction,
  type ThreadEvent,
  type ThreadMessage,
} from '../lib/api'
import {
  humanizeContactName,
  isPlaceholderContactAddress,
  optionLabel,
  optionResolveAction,
  translateKnownText,
  translateMockAgentBody,
} from '../lib/format'
import { spacing, type ColorTokens } from '../theme'

type Props = {
  message: ThreadMessage
  events?: ThreadEvent[]
  onDecisionResolved?: () => void
  resolveBusy?: boolean
  onResolve?: (
    messageId: string,
    action: ResolveAction,
    optionId?: string,
    opts?: { body?: string; subject?: string; sendAs?: 'user' | 'agent' },
  ) => void
  onEditDraft?: (draft: { body: string; subject?: string; decisionMessageId: string }) => void
  onEditNote?: (draft: { body: string; messageId: string }) => void
  onDeleteNote?: (messageId: string) => void
  currentUserId?: number | null
}

function isNoteKind(kind: string): boolean {
  return kind === 'note' || kind === 'internal_note'
}

function isDecisionResolved(message: ThreadMessage, events: ThreadEvent[]): boolean {
  if (!message.decision_id) return message.send_status === 'resolved'
  return events.some((event) => {
    if (!event.event_type.startsWith('decision_')) return false
    const payloadId = event.payload?.decision_id
    return typeof payloadId === 'string' && payloadId === message.decision_id
  })
}

type DecisionOption = {
  id: string
  label: string
  action_type?: string
  payload?: { body?: string; body_text?: string; subject?: string }
}

export default function MessageBubble({
  message,
  events = [],
  onDecisionResolved,
  resolveBusy,
  onResolve,
  onEditDraft,
  onEditNote,
  onDeleteNote,
  currentUserId,
}: Props) {
  const { t, locale } = useCopy()
  const { colors } = useTheme()
  const styles = useThemedStyles(bubbleStyles)
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)

  if (message.kind === 'decision_request') {
    const decision = message.payload?.decision
    const resolved = isDecisionResolved(message, events)
    const options: DecisionOption[] = decision?.options?.length
      ? (decision.options as DecisionOption[])
      : [
          { id: 'approve', label: t('decisions.approve') },
          { id: 'later', label: t('thread.defer') },
          { id: 'reject', label: t('decisions.reject') },
        ]

    const draftBody =
      options.find((o) => o.id === 'send' || o.action_type === 'send_reply' || o.action_type === 'send_email')?.payload?.body_text ||
      options.find((o) => o.id === 'send' || o.action_type === 'send_reply' || o.action_type === 'send_email')?.payload?.body ||
      decision?.summary ||
      message.body_text ||
      ''

    const act = (option: DecisionOption) => {
      if (option.id === 'edit' || option.action_type === 'draft') {
        onEditDraft?.({
          body: draftBody,
          subject: option.payload?.subject,
          decisionMessageId: message.id,
        })
        return
      }
      const action = optionResolveAction(option)
      const isSend =
        option.id === 'send' ||
        option.action_type === 'send_reply' ||
        option.action_type === 'send_email'
      const resolve = (sendAs?: 'user' | 'agent') => {
        const opts = {
          optionId: option.id,
          body: isSend ? draftBody : undefined,
          subject: isSend ? option.payload?.subject : undefined,
          sendAs,
        }
        if (onResolve) {
          onResolve(message.id, action, option.id, opts)
        } else {
          void resolveThreadDecision(message.signal_id, message.id, action, opts).then(() =>
            onDecisionResolved?.(),
          )
        }
      }
      if (isSend && action === 'approved') {
        Alert.alert(t('thread.sendAsTitle'), undefined, [
          { text: t('thread.sendAsYou'), onPress: () => resolve('user') },
          { text: t('thread.sendAsAgent'), onPress: () => resolve('agent') },
          { text: t('thread.cancel'), style: 'cancel' },
        ])
        return
      }
      resolve()
    }

    return (
      <View style={styles.decisionCard}>
        <Text style={styles.decisionLabel}>{t('thread.decisionRequested')}</Text>
        {decision?.title ? (
          <Text style={styles.decisionTitle}>{translateKnownText(decision.title, locale)}</Text>
        ) : null}
        <Text style={styles.decisionBody}>
          {translateKnownText(message.body_text || decision?.summary || '', locale)}
        </Text>
        {!resolved ? (
          <View style={styles.decisionActions}>
            {options.map((opt) => {
              const kind = optionResolveAction(opt)
              const isEdit = opt.id === 'edit' || opt.action_type === 'draft'
              return (
              <Pressable
                key={opt.id}
                style={[
                  styles.decisionButton,
                  kind === 'rejected' && styles.decisionReject,
                  kind === 'deferred' && styles.decisionDefer,
                  isEdit && styles.decisionEdit,
                  resolveBusy && styles.disabled,
                ]}
                disabled={resolveBusy}
                onPress={() => act(opt)}
              >
                {resolveBusy ? (
                  <ActivityIndicator color={colors.accentFg} size="small" />
                ) : (
                  <Text
                    style={[
                      styles.decisionButtonText,
                      (kind === 'rejected' || kind === 'deferred' || isEdit) && styles.decisionButtonTextAlt,
                    ]}
                  >
                    {optionLabel(opt, locale)}
                  </Text>
                )}
              </Pressable>
              )
            })}
          </View>
        ) : (
          <Text style={styles.resolvedLabel}>{t('thread.resolved')}</Text>
        )}
      </View>
    )
  }

  if (isNoteKind(message.kind)) {
    return (
      <Pressable
        style={styles.noteCard}
        onLongPress={() => {
          Alert.alert(t('thread.internalNote'), undefined, [
            {
              text: t('thread.editNote'),
              onPress: () => onEditNote?.({ body: message.body_text, messageId: message.id }),
            },
            {
              text: t('thread.deleteNote'),
              style: 'destructive',
              onPress: () =>
                Alert.alert(t('thread.deleteNoteTitle'), undefined, [
                  { text: t('thread.cancel'), style: 'cancel' },
                  { text: t('common.delete'), style: 'destructive', onPress: () => onDeleteNote?.(message.id) },
                ]),
            },
            { text: t('thread.cancel'), style: 'cancel' },
          ])
        }}
      >
        <Text style={styles.noteLabel}>{t('thread.internalNote')}</Text>
        <Text style={styles.noteText}>{message.body_text}</Text>
        {message.attachments?.length ? (
          <MessageAttachments attachments={message.attachments} />
        ) : null}
      </Pressable>
    )
  }

  const inbound = message.direction === 'inbound'
  const isAgent = Boolean(message.payload?.agent_id)
  const isSelf = !inbound && !isAgent && currentUserId != null && message.author_user_id === currentUserId
  const isTeammate = !inbound && !isAgent && !isSelf && message.author_user_id != null
  const hasHtml = !!message.body_html?.trim()
  const bubbleStyle = inbound
    ? styles.bubbleIn
    : isAgent
      ? styles.bubbleAi
      : isTeammate
        ? styles.bubbleTeam
        : styles.bubbleOut
  const visitor = t('inbox.visitor')
  const authorLabel = inbound
    ? humanizeContactName(null, message.from_address, visitor) ||
      (isPlaceholderContactAddress(message.from_address) ? visitor : message.from_address)
    : isAgent
      ? t('thread.ai')
      : isTeammate
        ? message.from_address || t('thread.team')
        : isSelf
          ? t('thread.you')
          : null

  const vote = (value: 'up' | 'down') => {
    setFeedback(value)
    void submitMessageFeedback(message.id, value).catch(() => setFeedback(null))
  }

  return (
    <View style={[styles.bubble, bubbleStyle]}>
      {authorLabel ? <Text style={styles.fromLabel}>{authorLabel}</Text> : null}
      {hasHtml ? (
        <View style={styles.webviewWrap}>
          <WebView
            originWhitelist={['*']}
            source={{
              html: `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;font-size:14px;line-height:1.5;color:${colors.htmlBody};background:transparent;margin:0;padding:0;}a{color:${colors.htmlLink};}</style></head><body>${message.body_html}</body></html>`,
            }}
            style={styles.webview}
            scrollEnabled={false}
            showsVerticalScrollIndicator={false}
          />
        </View>
      ) : (
        <Text style={inbound || isAgent || isTeammate ? styles.bubbleText : styles.bubbleTextOut}>
          {isAgent ? translateMockAgentBody(message.body_text, locale) : message.body_text}
        </Text>
      )}
      {message.attachments?.length ? (
        <MessageAttachments attachments={message.attachments} />
      ) : null}
      {message.send_status === 'failed' ? (
        <Text style={styles.statusFailed}>{t('thread.sendStatusFailed')}</Text>
      ) : null}
      {message.send_status === 'scheduled' || message.send_status === 'queued' ? (
        <Pressable
          onPress={() => {
            void cancelScheduledMessage(message.id).catch(() =>
              Alert.alert(t('thread.actionFailed'), t('thread.actionFailedBody')),
            )
          }}
        >
          <Text style={styles.statusScheduled}>{t('thread.sendStatusScheduled')}</Text>
          <Text style={styles.cancelSend}>{t('thread.cancelSend')}</Text>
        </Pressable>
      ) : null}
      {isAgent ? (
        <View style={styles.feedbackRow}>
          <Pressable onPress={() => vote('up')}>
            <Text style={[styles.feedback, feedback === 'up' && styles.feedbackOn]}>{t('thread.feedbackUp')}</Text>
          </Pressable>
          <Pressable onPress={() => vote('down')}>
            <Text style={[styles.feedback, feedback === 'down' && styles.feedbackOn]}>{t('thread.feedbackDown')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

function bubbleStyles(colors: ColorTokens) {
  return {
    bubble: {
      maxWidth: '88%' as const,
      borderRadius: 14,
      paddingHorizontal: spacing.lg,
      paddingVertical: 10,
    },
    bubbleIn: {
      alignSelf: 'flex-start' as const,
      backgroundColor: colors.elevated,
      borderColor: colors.border,
      borderWidth: 1,
    },
    bubbleOut: {
      alignSelf: 'flex-end' as const,
      backgroundColor: colors.accent,
    },
    bubbleTeam: {
      alignSelf: 'flex-start' as const,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
    },
    bubbleAi: {
      alignSelf: 'flex-start' as const,
      backgroundColor: colors.accentMuted,
      borderColor: colors.accent,
      borderWidth: 1,
    },
    fromLabel: { color: colors.textMuted, fontSize: 11, marginBottom: 2 },
    bubbleText: { color: colors.textHeading, fontSize: 15, lineHeight: 21 },
    bubbleTextOut: { color: colors.accentFg, fontSize: 15, lineHeight: 21 },
    webviewWrap: { minHeight: 40, overflow: 'hidden' as const },
    webview: { backgroundColor: 'transparent', minHeight: 40 },
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
      fontWeight: '700' as const,
      textTransform: 'uppercase' as const,
      letterSpacing: 0.8,
    },
    decisionTitle: { color: colors.textHeading, fontSize: 14, fontWeight: '600' as const },
    decisionBody: { color: colors.textPrimary, fontSize: 14, lineHeight: 20 },
    decisionActions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm, marginTop: spacing.xs },
    decisionButton: {
      borderRadius: 9,
      paddingHorizontal: spacing.md,
      paddingVertical: 9,
      backgroundColor: colors.accent,
      minWidth: 72,
      alignItems: 'center' as const,
    },
    decisionReject: { backgroundColor: colors.elevated, borderColor: colors.error, borderWidth: 1 },
    decisionDefer: { backgroundColor: colors.elevated, borderColor: colors.warning, borderWidth: 1 },
    decisionEdit: { backgroundColor: 'transparent', borderColor: colors.border, borderWidth: 1 },
    decisionButtonText: { color: colors.accentFg, fontWeight: '600' as const, fontSize: 13 },
    decisionButtonTextAlt: { color: colors.textPrimary },
    resolvedLabel: { color: colors.textMuted, fontSize: 12 },
    noteCard: {
      backgroundColor: colors.accentMuted,
      borderRadius: 10,
      padding: spacing.md,
      gap: 2,
    },
    noteLabel: { color: colors.accentInk, fontSize: 11, fontWeight: '600' as const },
    noteText: { color: colors.textPrimary, fontSize: 14 },
    disabled: { opacity: 0.5 },
    statusFailed: { color: colors.error, fontSize: 11, marginTop: 6 },
    statusScheduled: { color: colors.warning, fontSize: 11, marginTop: 6 },
    cancelSend: { color: colors.accentInk, fontSize: 11, fontWeight: '600' as const, marginTop: 2 },
    feedbackRow: { flexDirection: 'row' as const, gap: spacing.md, marginTop: 8 },
    feedback: { color: colors.textMuted, fontSize: 11 },
    feedbackOn: { color: colors.accentInk, fontWeight: '700' as const },
  }
}
