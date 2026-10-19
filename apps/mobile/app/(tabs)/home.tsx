import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useCopy } from '../../src/context/LocaleContext'
import { useTheme, useThemedStyles } from '../../src/context/ThemeContext'
import {
  createConversation,
  hasSendableWhatsapp,
  listChatTargets,
  type ChatTarget,
} from '../../src/lib/api'
import { radius, spacing, type ColorTokens } from '../../src/theme'

type LaterAction = 'email' | 'ticket' | 'plan' | 'transcript' | 'note' | 'contacts' | 'whatsapp'

const ACTIONS: { id: LaterAction; icon: keyof typeof Ionicons.glyphMap; labelKey: string }[] = [
  { id: 'email', icon: 'mail-outline', labelKey: 'home.email' },
  { id: 'ticket', icon: 'pricetag-outline', labelKey: 'home.ticket' },
  { id: 'plan', icon: 'calendar-outline', labelKey: 'home.plan' },
  { id: 'transcript', icon: 'mic-outline', labelKey: 'home.transcript' },
  { id: 'note', icon: 'document-text-outline', labelKey: 'home.note' },
  { id: 'contacts', icon: 'people-outline', labelKey: 'home.contacts' },
]

function leadFirst(items: ChatTarget[]): ChatTarget[] {
  return [...items].sort((a, b) => Number(Boolean(b.is_lead)) - Number(Boolean(a.is_lead)))
}

export default function HomeScreen() {
  const { t } = useCopy()
  const { colors } = useTheme()
  const styles = useThemedStyles(homeStyles)
  const insets = useSafeAreaInsets()
  const [index, setIndex] = useState(0)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [later, setLater] = useState<string | null>(null)

  const targetsQuery = useQuery({
    queryKey: ['chat-targets'],
    queryFn: listChatTargets,
  })
  const whatsappQuery = useQuery({
    queryKey: ['whatsapp-ready'],
    queryFn: hasSendableWhatsapp,
  })

  const agents = useMemo(() => leadFirst(targetsQuery.data?.items ?? []), [targetsQuery.data?.items])
  const agent = agents[Math.min(index, Math.max(agents.length - 1, 0))] ?? null
  const cards = whatsappQuery.data
    ? [...ACTIONS, { id: 'whatsapp' as const, icon: 'logo-whatsapp' as const, labelKey: 'home.whatsapp' }]
    : ACTIONS

  const step = (delta: number) => {
    if (agents.length < 2) return
    setIndex((current) => (current + delta + agents.length) % agents.length)
  }

  const send = async () => {
    const text = draft.trim()
    if (!text || !agent || sending) return
    setSending(true)
    setError(null)
    try {
      const created = await createConversation('New conversation', agent.id, undefined, text)
      setDraft('')
      router.push({ pathname: '/thread/[id]', params: { id: created.id, continue: '1' } })
    } catch {
      setError(t('home.startError'))
    } finally {
      setSending(false)
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{t('home.title')}</Text>
        <View style={styles.grid}>
          {cards.map((card) => (
            <Pressable key={card.id} style={styles.card} onPress={() => setLater(t(card.labelKey))}>
              <Ionicons name={card.icon} size={18} color={colors.accentInk} />
              <Text style={styles.cardLabel}>{t(card.labelKey)}</Text>
            </Pressable>
          ))}
        </View>

        {targetsQuery.isLoading ? (
          <ActivityIndicator color={colors.accent} style={styles.loader} />
        ) : agents.length === 0 ? (
          <Text style={styles.empty}>{t('home.noAgents')}</Text>
        ) : (
          <View style={styles.carousel}>
            <View style={styles.carouselRow}>
              {agents.length > 1 ? (
                <Pressable accessibilityLabel={t('home.previous')} onPress={() => step(-1)} style={styles.step}>
                  <Ionicons name="chevron-back" size={22} color={colors.textMuted} />
                </Pressable>
              ) : (
                <View style={styles.step} />
              )}
              <View style={styles.mark}>
                <Text style={styles.markText}>{(agent?.name ?? '?').slice(0, 1).toUpperCase()}</Text>
              </View>
              {agents.length > 1 ? (
                <Pressable accessibilityLabel={t('home.next')} onPress={() => step(1)} style={styles.step}>
                  <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
                </Pressable>
              ) : (
                <View style={styles.step} />
              )}
            </View>
            <Text style={styles.agentName}>{agent?.name}</Text>
            {agent?.role_name || agent?.role ? (
              <Text style={styles.agentRole}>{agent.role_name || agent.role}</Text>
            ) : null}
          </View>
        )}

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('home.composerPlaceholder', { name: agent?.name ?? '' })}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            multiline
            editable={Boolean(agent) && !sending}
          />
          <Pressable
            style={[styles.send, (!draft.trim() || !agent || sending) && styles.sendOff]}
            onPress={() => void send()}
            disabled={!draft.trim() || !agent || sending}
          >
            {sending ? (
              <ActivityIndicator color={colors.accentFg} />
            ) : (
              <Text style={styles.sendLabel}>{t('home.send')}</Text>
            )}
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <Modal visible={later != null} transparent animationType="fade" onRequestClose={() => setLater(null)}>
        <Pressable style={styles.scrim} onPress={() => setLater(null)}>
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.sheetTitle}>{later}</Text>
            <Text style={styles.sheetBody}>{t('home.laterBody')}</Text>
            <Pressable style={styles.sheetButton} onPress={() => setLater(null)}>
              <Text style={styles.sheetButtonLabel}>{t('common.cancel')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  )
}

function homeStyles(colors: ColorTokens) {
  return {
    root: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.lg, gap: spacing.lg },
    title: { color: colors.textHeading, fontSize: 22, fontWeight: '600' as const, textAlign: 'center' as const },
    grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    card: {
      width: '48%' as const,
      flexGrow: 1,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.sm,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    cardLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' as const, flexShrink: 1 },
    loader: { marginVertical: spacing.xl },
    empty: { color: colors.textMuted, textAlign: 'center' as const, fontSize: 14 },
    carousel: { alignItems: 'center' as const, gap: spacing.xs },
    carouselRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    step: { width: 44, height: 44, alignItems: 'center' as const, justifyContent: 'center' as const },
    mark: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: colors.accentMuted,
    },
    markText: { color: colors.accentInk, fontSize: 28, fontWeight: '600' as const },
    agentName: { color: colors.textHeading, fontSize: 16, fontWeight: '600' as const },
    agentRole: { color: colors.accentInk, fontSize: 13 },
    composer: { gap: spacing.sm },
    input: {
      minHeight: 88,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      color: colors.textPrimary,
      padding: spacing.md,
      fontSize: 16,
      textAlignVertical: 'top' as const,
    },
    send: {
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderRadius: radius.lg,
      backgroundColor: colors.accent,
      paddingVertical: spacing.md,
    },
    sendOff: { opacity: 0.45 },
    sendLabel: { color: colors.accentFg, fontWeight: '600' as const, fontSize: 15 },
    error: { color: colors.error, textAlign: 'center' as const, fontSize: 13 },
    scrim: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      padding: spacing.lg,
    },
    sheet: {
      width: '100%' as const,
      maxWidth: 360,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    sheetTitle: { color: colors.textHeading, fontSize: 16, fontWeight: '600' as const },
    sheetBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
    sheetButton: { alignSelf: 'flex-end' as const, paddingVertical: spacing.sm },
    sheetButtonLabel: { color: colors.accentInk, fontWeight: '600' as const },
  }
}
