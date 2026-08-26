import { useEffect, useState } from 'react'
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import MessageAttachments from './MessageAttachments'
import SendStopButton from './SendStopButton'
import { useCopy } from '../context/LocaleContext'
import { useTheme, useThemedStyles } from '../context/ThemeContext'
import { uploadFile, type Attachment, type ReplyAction, type SavedReply } from '../lib/api'
import { resolveComposerSurface } from '../lib/composer'
import { loadThreadDraft, saveThreadDraft } from '../lib/storage'
import { spacing, type ColorTokens } from '../theme'

type Tab = 'reply' | 'note'

type Props = {
  onReply: (bodyText: string, action: ReplyAction, attachments: Attachment[]) => Promise<void>
  onNote: (bodyText: string, attachments: Attachment[]) => Promise<void>
  saving?: boolean
  showNoteTab?: boolean
  streaming?: boolean
  onStop?: () => void
  presetDraft?: { body: string; nonce: number; asNote?: boolean }
  threadId?: string
  thread?: { channel?: string; folder?: string; contact_name?: string; contact_email?: string }
  savedReplies?: SavedReply[]
  onRequestDraft?: () => Promise<string>
  drafting?: boolean
  noteOnly?: boolean
}

export default function ThreadComposer({
  onReply,
  onNote,
  saving,
  showNoteTab = true,
  streaming = false,
  onStop,
  presetDraft,
  threadId,
  thread,
  savedReplies = [],
  onRequestDraft,
  drafting,
  noteOnly = false,
}: Props) {
  const { t } = useCopy()
  const { colors } = useTheme()
  const styles = useThemedStyles(composerStyles)
  const [tab, setTab] = useState<Tab>(noteOnly ? 'note' : 'reply')
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [repliesOpen, setRepliesOpen] = useState(false)

  const surface = resolveComposerSurface(thread ?? {}, {
    visitor: t('inbox.visitor'),
    agent: t('thread.ai'),
  })

  useEffect(() => {
    if (!threadId) return
    void loadThreadDraft(threadId).then((draft) => {
      if (draft) setBody(draft)
    })
  }, [threadId])

  useEffect(() => {
    if (!threadId) return
    const timer = setTimeout(() => {
      void saveThreadDraft(threadId, body)
    }, 400)
    return () => clearTimeout(timer)
  }, [body, threadId])

  useEffect(() => {
    if (!presetDraft?.body) return
    setTab(presetDraft.asNote || noteOnly ? 'note' : 'reply')
    setBody(presetDraft.body)
  }, [presetDraft?.nonce, presetDraft?.body, presetDraft?.asNote, noteOnly])

  const busy = saving || uploading || drafting
  const runActive = streaming || busy

  const applyDraft = async () => {
    if (!onRequestDraft || busy) return
    try {
      const text = await onRequestDraft()
      if (text.trim()) {
        setTab('reply')
        setBody(text)
      }
    } catch {
      Alert.alert(t('thread.draftFailed'))
    }
  }

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    })
    if (result.canceled || !result.assets[0]) return
    const asset = result.assets[0]
    setUploading(true)
    try {
      const uploaded = await uploadFile({
        uri: asset.uri,
        name: asset.fileName ?? `photo-${Date.now()}.jpg`,
        mime: asset.mimeType ?? 'image/jpeg',
      })
      setAttachments((prev) => [...prev, uploaded])
    } catch {
      Alert.alert(t('thread.uploadFailed'), t('thread.uploadFailedBody'))
    } finally {
      setUploading(false)
    }
  }

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
    if (result.canceled || !result.assets[0]) return
    const asset = result.assets[0]
    setUploading(true)
    try {
      const uploaded = await uploadFile({
        uri: asset.uri,
        name: asset.name,
        mime: asset.mimeType ?? 'application/octet-stream',
      })
      setAttachments((prev) => [...prev, uploaded])
    } catch {
      Alert.alert(t('thread.uploadFailed'), t('thread.uploadFailedBody'))
    } finally {
      setUploading(false)
    }
  }

  const submit = async (action: ReplyAction = 'send') => {
    const text = body.trim()
    if (!text || busy) return
    const currentAttachments = attachments
    setBody('')
    setAttachments([])
    if (threadId) void saveThreadDraft(threadId, '')
    try {
      if (tab === 'note') {
        await onNote(text, currentAttachments)
      } else {
        await onReply(text, action, currentAttachments)
      }
    } catch {
      setBody(text)
      setAttachments(currentAttachments)
      Alert.alert(t('thread.sendFailed'), t('thread.sendFailedBody'))
    }
  }

  const isNote = tab === 'note'
  const placeholder = isNote
    ? t('thread.notePlaceholder')
    : t(surface.placeholderKey, surface.placeholderName ? { name: surface.placeholderName } : undefined)

  return (
    <View style={styles.root}>
      {showNoteTab && !noteOnly ? (
        <View style={styles.tabs}>
          <Pressable
            style={[styles.tab, !isNote && styles.tabActive]}
            onPress={() => setTab('reply')}
          >
            <Text style={[styles.tabText, !isNote && styles.tabTextActive]}>{t(surface.replyLabelKey)}</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, isNote && styles.tabActiveNote]}
            onPress={() => setTab('note')}
          >
            <Text style={[styles.tabText, isNote && styles.tabTextActiveNote]}>{t('thread.note')}</Text>
          </Pressable>
        </View>
      ) : null}

      {surface.showRecipient && !isNote && surface.recipientValue ? (
        <Text style={styles.recipient} numberOfLines={1}>
          {t(surface.recipientLabelKey)} {surface.recipientValue}
        </Text>
      ) : null}

      {attachments.length > 0 ? (
        <View style={styles.attachments}>
          <MessageAttachments attachments={attachments} />
          <Pressable onPress={() => setAttachments([])}>
            <Text style={styles.clearAttachments}>{t('thread.clearAttachments')}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.composer, isNote && styles.composerNote]}>
        <View style={styles.attachButtons}>
          <Pressable style={styles.iconButton} onPress={() => void pickImage()} disabled={busy}>
            <Ionicons name="image-outline" size={20} color={colors.textSecondary} />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => void pickDocument()} disabled={busy}>
            <Ionicons name="attach-outline" size={20} color={colors.textSecondary} />
          </Pressable>
          {!isNote ? (
            <Pressable
              style={styles.iconButton}
              onPress={() => setRepliesOpen(true)}
              disabled={busy}
              accessibilityLabel={t('thread.savedReplies')}
            >
              <Ionicons name="bookmark-outline" size={20} color={colors.textSecondary} />
            </Pressable>
          ) : null}
          {!isNote && onRequestDraft ? (
            <Pressable
              style={styles.iconButton}
              onPress={() => void applyDraft()}
              disabled={busy}
              accessibilityLabel={t('thread.draftReply')}
            >
              <Ionicons name="sparkles-outline" size={20} color={colors.accentInk} />
            </Pressable>
          ) : null}
        </View>
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          value={body}
          onChangeText={setBody}
          multiline
          editable={!busy}
        />
        <SendStopButton
          streaming={streaming}
          canSend={!!body.trim()}
          busy={busy}
          onSend={() => void submit('send')}
          onStop={() => onStop?.()}
        />
      </View>

      {!isNote && surface.showCloseActions ? (
        <View style={styles.secondaryActions}>
          <Pressable
            style={[styles.secondaryButton, runActive && styles.disabled]}
            onPress={() => void submit('send_and_pending')}
            disabled={!body.trim() || runActive}
          >
            <Text style={styles.secondaryText}>{t('thread.sendPending')}</Text>
          </Pressable>
          <Pressable
            style={[styles.secondaryButton, runActive && styles.disabled]}
            onPress={() => void submit('send_and_close')}
            disabled={!body.trim() || runActive}
          >
            <Text style={styles.secondaryText}>{t('thread.sendClose')}</Text>
          </Pressable>
        </View>
      ) : null}

      <Modal visible={repliesOpen} transparent animationType="fade" onRequestClose={() => setRepliesOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setRepliesOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('thread.savedReplies')}</Text>
            <ScrollView style={styles.sheetList}>
              {savedReplies.length === 0 ? (
                <Text style={styles.sheetEmpty}>{t('thread.noSavedReplies')}</Text>
              ) : (
                savedReplies.map((reply) => (
                  <Pressable
                    key={reply.id}
                    style={styles.sheetItem}
                    onPress={() => {
                      setTab('reply')
                      setBody(reply.body_text)
                      setRepliesOpen(false)
                    }}
                  >
                    <Text style={styles.sheetItemTitle}>{reply.title}</Text>
                    <Text style={styles.sheetItemBody} numberOfLines={2}>
                      {reply.body_text}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
            <Pressable style={styles.sheetItem} onPress={() => setRepliesOpen(false)}>
              <Text style={styles.sheetCancel}>{t('thread.cancel')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

function composerStyles(colors: ColorTokens) {
  return {
    root: {
      borderTopColor: colors.border,
      borderTopWidth: 1,
      backgroundColor: colors.surface,
      padding: spacing.md,
      gap: spacing.sm,
    },
    tabs: { flexDirection: 'row', gap: spacing.sm },
    tab: {
      borderRadius: 999,
      borderColor: colors.border,
      borderWidth: 1,
      paddingHorizontal: spacing.md,
      paddingVertical: 5,
    },
    tabActive: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
    tabActiveNote: { backgroundColor: 'rgba(251,191,36,0.12)', borderColor: colors.warning },
    tabText: { color: colors.textSecondary, fontSize: 12 },
    tabTextActive: { color: colors.accent, fontWeight: '600' },
    tabTextActiveNote: { color: colors.warning, fontWeight: '600' },
    recipient: { color: colors.textMuted, fontSize: 12 },
    attachments: { gap: spacing.xs },
    clearAttachments: { color: colors.textMuted, fontSize: 11 },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: spacing.sm,
      backgroundColor: colors.bg,
    },
    composerNote: { borderColor: 'rgba(251,191,36,0.35)' },
    attachButtons: { gap: 2 },
    iconButton: { padding: 4 },
    input: {
      flex: 1,
      maxHeight: 120,
      color: colors.textPrimary,
      fontSize: 15,
      paddingVertical: 4,
    },
    disabled: { opacity: 0.5 },
    secondaryActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
    secondaryButton: { paddingVertical: 4 },
    secondaryText: { color: colors.textMuted, fontSize: 12 },
    sheetBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingBottom: spacing.xl,
      maxHeight: '70%',
    },
    sheetTitle: {
      color: colors.textHeading,
      fontSize: 16,
      fontWeight: '600',
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    sheetList: { maxHeight: 280 },
    sheetEmpty: {
      color: colors.textMuted,
      fontSize: 13,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
    },
    sheetItem: {
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.xl,
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
    },
    sheetItemTitle: { color: colors.textHeading, fontSize: 15, fontWeight: '600' },
    sheetItemBody: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
    sheetCancel: { color: colors.textPrimary, fontSize: 16 },
  }
}
