import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import MessageAttachments from './MessageAttachments'
import {
  resolveThreadDecision,
  type ResolveAction,
  type ThreadEvent,
  type ThreadMessage,
} from '../lib/api'
import { colors, spacing } from '../theme'

type Props = {
  message: ThreadMessage
  events?: ThreadEvent[]
  onDecisionResolved?: () => void
  resolveBusy?: boolean
  onResolve?: (messageId: string, action: ResolveAction, optionId?: string) => void
  onEditDraft?: (draft: { body: string; subject?: string; decisionMessageId: string }) => void
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

function optionAction(option: DecisionOption): ResolveAction {
  const id = option.id.toLowerCase()
  const actionType = (option.action_type || '').toLowerCase()
  if (id === 'escalate' || actionType === 'escalate') return 'rejected'
  if (id.includes('reject') || id === 'no' || actionType === 'reject') return 'rejected'
  if (id.includes('later') || id.includes('defer') || id === 'skip' || actionType === 'defer') {
    return 'deferred'
  }
  return 'approved'
}

export default function MessageBubble({
  message,
  events = [],
  onDecisionResolved,
  resolveBusy,
  onResolve,
  onEditDraft,
}: Props) {
  if (message.kind === 'decision_request') {
    const decision = message.payload?.decision
    const resolved = isDecisionResolved(message, events)
    const options: DecisionOption[] = decision?.options?.length
      ? (decision.options as DecisionOption[])
      : [
          { id: 'approve', label: 'Approve' },
          { id: 'later', label: 'Defer' },
          { id: 'reject', label: 'Reject' },
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
      const action = optionAction(option)
      if (onResolve) {
        onResolve(message.id, action, option.id)
      } else {
        void resolveThreadDecision(message.signal_id, message.id, action, {
          optionId: option.id,
          body: option.id === 'send' || option.action_type === 'send_reply' || option.action_type === 'send_email' ? draftBody : undefined,
        }).then(() => onDecisionResolved?.())
      }
    }

    return (
      <View style={styles.decisionCard}>
        <Text style={styles.decisionLabel}>Decision requested</Text>
        {decision?.title ? <Text style={styles.decisionTitle}>{decision.title}</Text> : null}
        <Text style={styles.decisionBody}>{message.body_text || decision?.summary || ''}</Text>
        {!resolved ? (
          <View style={styles.decisionActions}>
            {options.map((opt) => (
              <Pressable
                key={opt.id}
                style={[styles.decisionButton, resolveBusy && styles.disabled]}
                disabled={resolveBusy}
                onPress={() => act(opt)}
              >
                {resolveBusy ? (
                  <ActivityIndicator color={colors.textHeading} size="small" />
                ) : (
                  <Text style={styles.decisionButtonText}>{opt.label}</Text>
                )}
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.resolvedLabel}>Resolved</Text>
        )}
      </View>
    )
  }

  if (isNoteKind(message.kind)) {
    return (
      <View style={styles.noteCard}>
        <Text style={styles.noteLabel}>Internal note</Text>
        <Text style={styles.noteText}>{message.body_text}</Text>
        {message.attachments?.length ? (
          <MessageAttachments attachments={message.attachments} />
        ) : null}
      </View>
    )
  }

  const inbound = message.direction === 'inbound'
  const hasHtml = !!message.body_html?.trim()

  return (
    <View style={[styles.bubble, inbound ? styles.bubbleIn : styles.bubbleOut]}>
      {inbound && message.from_address ? (
        <Text style={styles.fromLabel}>{message.from_address}</Text>
      ) : null}
      {hasHtml ? (
        <View style={styles.webviewWrap}>
          <WebView
            originWhitelist={['*']}
            source={{
              html: `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;font-size:14px;line-height:1.5;color:#d6dae6;background:transparent;margin:0;padding:0;}a{color:#6e66ff;}</style></head><body>${message.body_html}</body></html>`,
            }}
            style={styles.webview}
            scrollEnabled={false}
            showsVerticalScrollIndicator={false}
          />
        </View>
      ) : (
        <Text style={styles.bubbleText}>{message.body_text}</Text>
      )}
      {message.attachments?.length ? (
        <MessageAttachments attachments={message.attachments} />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
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
  webviewWrap: { minHeight: 40, overflow: 'hidden' },
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
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  decisionTitle: { color: colors.textHeading, fontSize: 14, fontWeight: '600' },
  decisionBody: { color: colors.textPrimary, fontSize: 14, lineHeight: 20 },
  decisionActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  decisionButton: {
    borderRadius: 9,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    backgroundColor: colors.accent,
    minWidth: 72,
    alignItems: 'center',
  },
  decisionButtonText: { color: colors.textHeading, fontWeight: '600', fontSize: 13 },
  resolvedLabel: { color: colors.textMuted, fontSize: 12 },
  noteCard: {
    backgroundColor: colors.accentMuted,
    borderRadius: 10,
    padding: spacing.md,
    gap: 2,
  },
  noteLabel: { color: colors.accent, fontSize: 11, fontWeight: '600' },
  noteText: { color: colors.textPrimary, fontSize: 14 },
  disabled: { opacity: 0.5 },
})
