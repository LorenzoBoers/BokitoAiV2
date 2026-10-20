import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ComposerBar, IntentLinks, TargetCarousel, type IconName } from '@bokito/ui'
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

const ACTIONS: { id: LaterAction; icon: IconName; labelKey: string }[] = [
  { id: 'email', icon: 'mail', labelKey: 'home.email' },
  { id: 'ticket', icon: 'ticket', labelKey: 'home.ticket' },
  { id: 'plan', icon: 'calendar', labelKey: 'home.plan' },
  { id: 'transcript', icon: 'mic', labelKey: 'home.transcript' },
  { id: 'note', icon: 'note', labelKey: 'home.note' },
  { id: 'contacts', icon: 'user', labelKey: 'home.contacts' },
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
    ? [...ACTIONS, { id: 'whatsapp' as const, icon: 'send' as const, labelKey: 'home.whatsapp' }]
    : ACTIONS

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
        {targetsQuery.isLoading ? (
          <ActivityIndicator color={colors.accent} style={styles.loader} />
        ) : agents.length === 0 ? (
          <Text style={styles.empty}>{t('home.noAgents')}</Text>
        ) : (
          <TargetCarousel
            leadLabel={t('home.lead')}
            previousLabel={t('home.previous')}
            nextLabel={t('home.next')}
            selectedId={agent?.id}
            onSelect={(id) => {
              const next = agents.findIndex((row) => row.id === id)
              if (next >= 0) setIndex(next)
            }}
            items={agents.map((row) => ({
              id: row.id,
              name: row.name,
              subtitle: row.role_name || row.role || undefined,
              lead: row.is_lead,
            }))}
          />
        )}

        <ComposerBar
          value={draft}
          onChangeText={setDraft}
          placeholder={t('home.composerPlaceholder', { name: agent?.name ?? '' })}
          canSend={Boolean(draft.trim() && agent && !sending)}
          onSend={() => void send()}
          ai
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <IntentLinks
          items={cards.map((card) => ({
            id: card.id,
            icon: card.icon,
            label: t(card.labelKey),
            onPress: () => setLater(t(card.labelKey)),
          }))}
        />
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
    content: {
      flexGrow: 1,
      padding: spacing.lg,
      gap: spacing.lg,
      justifyContent: 'center' as const,
    },
    loader: { marginVertical: spacing.xl },
    empty: { color: colors.textMuted, textAlign: 'center' as const, fontSize: 14 },
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
