import { useState } from 'react'
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import MessageAttachments from './MessageAttachments'
import SendStopButton from './SendStopButton'
import { uploadFile, type Attachment, type ReplyAction } from '../lib/api'
import { colors, spacing } from '../theme'

type Tab = 'reply' | 'note'

type Props = {
  onReply: (bodyText: string, action: ReplyAction, attachments: Attachment[]) => Promise<void>
  onNote: (bodyText: string, attachments: Attachment[]) => Promise<void>
  saving?: boolean
  showNoteTab?: boolean
  streaming?: boolean
  onStop?: () => void
}

export default function ThreadComposer({
  onReply,
  onNote,
  saving,
  showNoteTab = true,
  streaming = false,
  onStop,
}: Props) {
  const [tab, setTab] = useState<Tab>('reply')
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)

  const busy = saving || uploading
  const runActive = streaming || busy

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
      Alert.alert('Upload failed', 'Could not upload the selected image.')
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
      Alert.alert('Upload failed', 'Could not upload the selected file.')
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
    try {
      if (tab === 'note') {
        await onNote(text, currentAttachments)
      } else {
        await onReply(text, action, currentAttachments)
      }
    } catch {
      setBody(text)
      setAttachments(currentAttachments)
    }
  }

  const isNote = tab === 'note'

  return (
    <View style={styles.root}>
      {showNoteTab ? (
        <View style={styles.tabs}>
          <Pressable
            style={[styles.tab, !isNote && styles.tabActive]}
            onPress={() => setTab('reply')}
          >
            <Text style={[styles.tabText, !isNote && styles.tabTextActive]}>Reply</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, isNote && styles.tabActiveNote]}
            onPress={() => setTab('note')}
          >
            <Text style={[styles.tabText, isNote && styles.tabTextActiveNote]}>Note</Text>
          </Pressable>
        </View>
      ) : null}

      {attachments.length > 0 ? (
        <View style={styles.attachments}>
          <MessageAttachments attachments={attachments} />
          <Pressable onPress={() => setAttachments([])}>
            <Text style={styles.clearAttachments}>Clear attachments</Text>
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
        </View>
        <TextInput
          style={styles.input}
          placeholder={isNote ? 'Internal note' : 'Write a reply'}
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

      {!isNote ? (
        <View style={styles.secondaryActions}>
          <Pressable
            style={[styles.secondaryButton, runActive && styles.disabled]}
            onPress={() => void submit('send_and_pending')}
            disabled={!body.trim() || runActive}
          >
            <Text style={styles.secondaryText}>Send and pending</Text>
          </Pressable>
          <Pressable
            style={[styles.secondaryButton, runActive && styles.disabled]}
            onPress={() => void submit('send_and_close')}
            disabled={!body.trim() || runActive}
          >
            <Text style={styles.secondaryText}>Send and close</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
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
})
