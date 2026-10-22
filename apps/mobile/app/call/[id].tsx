import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useCopy } from '../../src/context/LocaleContext'
import { useTheme, useThemedStyles } from '../../src/context/ThemeContext'
import {
  approveDecision,
  declineCall,
  listRingingCalls,
  rejectDecision,
  type AgentCall,
} from '../../src/lib/api'
import { WEB_APP_URL } from '../../src/lib/config'
import { radius, spacing, type ColorTokens } from '../../src/theme'

const POLL_MS = 3000

/** An agent rings about one decision card. Voice runs on the web; here the person decides or picks up there. */
export default function CallScreen() {
  const { id, signal } = useLocalSearchParams<{ id: string; signal?: string }>()
  const { t } = useCopy()
  const { colors } = useTheme()
  const styles = useThemedStyles(callStyles)
  const [call, setCall] = useState<AgentCall | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const rows = await listRingingCalls()
        if (cancelled) return
        setCall(rows.find((row) => row.call_id === id) ?? null)
      } catch {
        if (!cancelled) setCall(null)
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [id])

  const signalId = call?.signal_id || signal || ''

  const decide = async (fn: (decisionId: string) => Promise<unknown>) => {
    if (!call) return
    setBusy(true)
    try {
      await fn(call.decision_id)
      await declineCall(call.call_id).catch(() => undefined)
      router.back()
    } catch {
      Alert.alert(t('decisions.error'))
    } finally {
      setBusy(false)
    }
  }

  const decline = async () => {
    if (call) await declineCall(call.call_id).catch(() => undefined)
    router.back()
  }

  const talkOnWeb = () => {
    const path = signalId ? `/communication/inbox/all/t/${signalId}` : '/'
    void Linking.openURL(`${WEB_APP_URL}${path}`)
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: t('call.title') }} />
      {!loaded ? (
        <ActivityIndicator color={colors.accent} />
      ) : call ? (
        <View style={styles.card} testID="call-ringing">
          <Text style={styles.kicker}>{t('call.ringing', { name: call.agent_name || t('call.agent') })}</Text>
          <Text style={styles.title}>{call.title}</Text>
          {call.summary ? <Text style={styles.body}>{call.summary}</Text> : null}
          <View style={styles.row}>
            <Pressable
              style={[styles.button, styles.primary]}
              disabled={busy}
              onPress={() => void decide(approveDecision)}
            >
              <Text style={styles.primaryText}>{t('decisions.approve')}</Text>
            </Pressable>
            <Pressable style={styles.button} disabled={busy} onPress={() => void decide(rejectDecision)}>
              <Text style={styles.buttonText}>{t('decisions.reject')}</Text>
            </Pressable>
          </View>
          <Pressable style={styles.button} onPress={talkOnWeb}>
            <Text style={styles.buttonText}>{t('call.talkOnWeb')}</Text>
          </Pressable>
          <Text style={styles.hint}>{t('call.voiceHint')}</Text>
          <Pressable style={styles.link} disabled={busy} onPress={() => void decline()}>
            <Text style={styles.linkText}>{t('call.decline')}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.card} testID="call-ended">
          <Text style={styles.title}>{t('call.ended')}</Text>
          {signalId ? (
            <Pressable style={styles.button} onPress={() => router.replace(`/thread/${signalId}`)}>
              <Text style={styles.buttonText}>{t('decisions.openThread')}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  )
}

function callStyles(colors: ColorTokens) {
  return {
    root: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, justifyContent: 'center' },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.md,
    },
    kicker: { color: colors.textMuted, fontSize: 13 },
    title: { color: colors.textHeading, fontSize: 18, fontWeight: '700' },
    body: { color: colors.textPrimary, fontSize: 14, lineHeight: 20 },
    row: { flexDirection: 'row', gap: spacing.sm },
    button: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing.md,
      borderRadius: radius.lg,
      borderColor: colors.border,
      borderWidth: 1,
    },
    primary: { backgroundColor: colors.accent, borderColor: colors.accent },
    primaryText: { color: colors.accentFg, fontWeight: '600' },
    buttonText: { color: colors.textHeading, fontWeight: '600' },
    hint: { color: colors.textMuted, fontSize: 12 },
    link: { alignItems: 'center', paddingVertical: spacing.sm },
    linkText: { color: colors.textMuted, fontSize: 13 },
  } as const
}
