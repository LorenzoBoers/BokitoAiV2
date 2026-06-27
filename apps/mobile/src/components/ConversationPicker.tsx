import { useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { ChatTarget, Conversation } from '../lib/api'
import { colors, spacing } from '../theme'

type Props = {
  visible: boolean
  onClose: () => void
  conversations: Conversation[]
  targets: ChatTarget[]
  selectedId: string | null
  selectedAgentId: string | null
  loading?: boolean
  onSelectConversation: (id: string) => void
  onCreateConversation: (agentId?: string) => void
  onDeleteConversation: (id: string) => void
  onRenameConversation: (id: string, title: string) => void
}

export default function ConversationPicker({
  visible,
  onClose,
  conversations,
  targets,
  selectedId,
  selectedAgentId,
  loading,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onRenameConversation,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const startRename = (conv: Conversation) => {
    setRenamingId(conv.id)
    setRenameDraft(conv.title)
  }

  const commitRename = () => {
    if (renamingId && renameDraft.trim()) {
      onRenameConversation(renamingId, renameDraft.trim())
    }
    setRenamingId(null)
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>Conversations</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>Agent</Text>
        <FlatList
          horizontal
          data={targets}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.agentRow}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => {
            const active = item.id === selectedAgentId
            return (
              <Pressable
                style={[styles.agentChip, active && styles.agentChipActive]}
                onPress={() => onCreateConversation(item.id)}
              >
                <Text style={[styles.agentChipText, active && styles.agentChipTextActive]}>
                  {item.name}
                </Text>
              </Pressable>
            )
          }}
        />

        <View style={styles.listHeader}>
          <Text style={styles.sectionLabel}>History</Text>
          <Pressable style={styles.newButton} onPress={() => onCreateConversation(selectedAgentId ?? undefined)}>
            <Ionicons name="add" size={16} color={colors.accent} />
            <Text style={styles.newButtonText}>New</Text>
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={styles.loader} />
        ) : (
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => {
              const selected = item.id === selectedId
              if (renamingId === item.id) {
                return (
                  <View style={styles.renameRow}>
                    <TextInput
                      style={styles.renameInput}
                      value={renameDraft}
                      onChangeText={setRenameDraft}
                      autoFocus
                      onSubmitEditing={commitRename}
                    />
                    <Pressable onPress={commitRename}>
                      <Ionicons name="checkmark" size={20} color={colors.accent} />
                    </Pressable>
                  </View>
                )
              }
              return (
                <Pressable
                  style={[styles.row, selected && styles.rowSelected]}
                  onPress={() => {
                    onSelectConversation(item.id)
                    onClose()
                  }}
                >
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowTitle, selected && styles.rowTitleSelected]} numberOfLines={1}>
                      {item.title || 'Untitled'}
                    </Text>
                    {item.agent_name ? (
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {item.agent_name}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable onPress={() => startRename(item)} hitSlop={8}>
                    <Ionicons name="pencil-outline" size={16} color={colors.textMuted} />
                  </Pressable>
                  <Pressable onPress={() => onDeleteConversation(item.id)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                  </Pressable>
                </Pressable>
              )
            }}
            ListEmptyComponent={<Text style={styles.empty}>No conversations yet.</Text>}
          />
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { color: colors.textHeading, fontSize: 18, fontWeight: '600' },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  agentRow: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.lg },
  agentChip: {
    borderRadius: 999,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  agentChipActive: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
  agentChipText: { color: colors.textSecondary, fontSize: 13 },
  agentChipTextActive: { color: colors.accent, fontWeight: '600' },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: spacing.lg,
    marginBottom: spacing.sm,
  },
  newButton: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  newButtonText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  loader: { marginTop: spacing.xl },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowSelected: { backgroundColor: colors.accentMuted, marginHorizontal: -spacing.sm, paddingHorizontal: spacing.sm, borderRadius: 8 },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { color: colors.textPrimary, fontSize: 15 },
  rowTitleSelected: { color: colors.textHeading, fontWeight: '600' },
  rowMeta: { color: colors.textMuted, fontSize: 12 },
  renameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  renameInput: {
    flex: 1,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
})
