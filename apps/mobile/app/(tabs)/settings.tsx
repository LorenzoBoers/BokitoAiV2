import { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../src/context/AuthContext'
import { useCopy } from '../../src/context/LocaleContext'
import { useTheme, useThemedStyles } from '../../src/context/ThemeContext'
import { useGatewayStatus } from '../../src/hooks/useGatewayStatus'
import { messagingKeys, useNotificationPreferences, useWorkspaces } from '../../src/hooks/useMessagingQueries'
import {
  DEFAULT_NOTIFICATION_PREF_ROWS,
  patchNotificationPreferences,
  type NotificationPrefRow,
} from '../../src/lib/api'
import { API_URL, WEB_APP_URL } from '../../src/lib/config'
import { roleLabel } from '../../src/lib/format'
import { getPushStatus, registerForPush, type PushStatus } from '../../src/lib/push'
import { radius, spacing, type ColorTokens, type ThemePreference } from '../../src/theme'

const MOBILE_PREF_IDS = ['assigned-to-me', 'mentions', 'decisions', 'handoff'] as const

export default function SettingsScreen() {
  const { user, signOut, switchWorkspace } = useAuth()
  const { t, locale, setLocale } = useCopy()
  const { colors, preference, setPreference } = useTheme()
  const styles = useThemedStyles(settingsStyles)
  const status = useGatewayStatus()
  const queryClient = useQueryClient()
  const { data, isLoading } = useNotificationPreferences()
  const { data: workspaces = [] } = useWorkspaces()
  const [rows, setRows] = useState<NotificationPrefRow[]>([])
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null)

  useEffect(() => {
    if (data?.rows) setRows(data.rows)
  }, [data])

  useEffect(() => {
    void getPushStatus().then(setPushStatus)
  }, [])

  const logout = async () => {
    await signOut()
    router.replace('/login')
  }

  const togglePref = async (id: string, next: boolean) => {
    const updated = rows.map((row) =>
      row.id === id ? { ...row, channels: { ...row.channels, desktop: next } } : row,
    )
    setRows(updated)
    setSaving(true)
    setSaveState('idle')
    try {
      await patchNotificationPreferences(updated)
      await queryClient.invalidateQueries({ queryKey: messagingKeys.notificationPrefs })
      setSaveState('saved')
    } catch {
      setSaveState('error')
      if (data?.rows) setRows(data.rows)
    } finally {
      setSaving(false)
    }
  }

  const statusLabel =
    status === 'connected' ? t('home.connected') : status === 'connecting' ? t('home.connecting') : t('home.offline')

  const visiblePrefs = (rows.length ? rows : DEFAULT_NOTIFICATION_PREF_ROWS).filter((row) =>
    MOBILE_PREF_IDS.includes(row.id as (typeof MOBILE_PREF_IDS)[number]),
  )

  const changeWorkspace = async (tenantId: string) => {
    if (tenantId === user?.tenant?.id) return
    setSaving(true)
    try {
      await switchWorkspace(tenantId)
      queryClient.clear()
      router.replace('/(tabs)/home')
    } catch {
      setSaveState('error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.label}>{t('settings.signedIn')}</Text>
        <Text style={styles.value}>{user?.display_name || user?.email || '—'}</Text>
        <Text style={styles.sub}>{user?.email}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{t('settings.workspace')}</Text>
        <Text style={styles.value}>{user?.tenant?.name ?? '—'}</Text>
        {user?.role ? (
          <Text style={styles.sub}>
            {t('settings.role')}: {roleLabel(user.role, locale)}
          </Text>
        ) : null}
        {workspaces.length > 1 ? (
          <View style={styles.langRow}>
            <Text style={styles.hint}>{t('settings.switchWorkspace')}</Text>
            {workspaces.map((workspace) => (
              <Pressable
                key={workspace.id}
                style={[styles.langChip, workspace.id === user?.tenant?.id && styles.langChipOn]}
                onPress={() => void changeWorkspace(workspace.id)}
                disabled={saving}
              >
                <Text style={[styles.langText, workspace.id === user?.tenant?.id && styles.langTextOn]}>
                  {workspace.name}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{t('settings.connection')}</Text>
        <View style={styles.rowBetween}>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                status === 'connected' && styles.statusOn,
                status === 'connecting' && styles.statusWait,
              ]}
            />
            <Text style={styles.value}>{statusLabel}</Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{t('settings.appearance')}</Text>
        <Text style={styles.hint}>{t('settings.appearanceHint')}</Text>
        <View style={styles.langRow}>
          {(['light', 'dark', 'system'] as ThemePreference[]).map((item) => (
            <Pressable
              key={item}
              style={[styles.langChip, preference === item && styles.langChipOn]}
              onPress={() => setPreference(item)}
            >
              <Text style={[styles.langText, preference === item && styles.langTextOn]}>
                {item === 'light'
                  ? t('settings.appearanceLight')
                  : item === 'dark'
                    ? t('settings.appearanceDark')
                    : t('settings.appearanceSystem')}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{t('settings.language')}</Text>
        <View style={styles.langRow}>
          <Pressable
            style={[styles.langChip, locale === 'en' && styles.langChipOn]}
            onPress={() => setLocale('en')}
          >
            <Text style={[styles.langText, locale === 'en' && styles.langTextOn]}>{t('settings.languageEn')}</Text>
          </Pressable>
          <Pressable
            style={[styles.langChip, locale === 'nl' && styles.langChipOn]}
            onPress={() => setLocale('nl')}
          >
            <Text style={[styles.langText, locale === 'nl' && styles.langTextOn]}>{t('settings.languageNl')}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{t('settings.notifications')}</Text>
        <Text style={styles.hint}>{t('settings.notificationsHint')}</Text>
        {isLoading && rows.length === 0 ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <>
            {!data?.rows?.length ? <Text style={styles.hint}>{t('settings.emptyPrefs')}</Text> : null}
            {visiblePrefs.map((row) => (
              <View key={row.id} style={styles.prefRow}>
                <Text style={styles.prefLabel}>{t(`settings.pref.${row.id}`)}</Text>
                <Switch
                  value={Boolean(row.channels.desktop)}
                  onValueChange={(next) => void togglePref(row.id, next)}
                  disabled={saving}
                  trackColor={{ false: colors.border, true: colors.accent }}
                  thumbColor={colors.accentFg}
                />
              </View>
            ))}
            {saveState === 'saved' ? <Text style={styles.saved}>{t('settings.saved')}</Text> : null}
            {saveState === 'error' ? <Text style={styles.error}>{t('settings.saveFailed')}</Text> : null}
            {pushStatus === 'on' ? <Text style={styles.saved}>{t('settings.pushOn')}</Text> : null}
            {pushStatus === 'unavailable' ? <Text style={styles.hint}>{t('settings.pushOff')}</Text> : null}
            {pushStatus === 'off' ? (
              <Pressable
                onPress={() => {
                  void registerForPush().then((token) => setPushStatus(token ? 'on' : 'off'))
                }}
              >
                <Text style={styles.advanced}>{t('settings.pushRetry')}</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>

      <Pressable style={styles.card} onPress={() => router.push('/notifications')}>
        <Text style={styles.value}>{t('settings.notificationsInbox')}</Text>
        <Text style={styles.hint}>{t('settings.notificationsInboxHint')}</Text>
      </Pressable>

      <Pressable style={styles.card} onPress={() => void Linking.openURL(WEB_APP_URL)}>
        <Text style={styles.value}>{t('settings.openWeb')}</Text>
        <Text style={styles.hint}>{t('settings.openWebHint')}</Text>
      </Pressable>

      <Pressable onPress={() => setAdvancedOpen((v) => !v)}>
        <Text style={styles.advanced}>{t('settings.advanced')}</Text>
      </Pressable>
      {advancedOpen ? (
        <View style={styles.card}>
          <Text style={styles.label}>{t('settings.endpoint')}</Text>
          <Text style={styles.sub}>{API_URL}</Text>
        </View>
      ) : null}

      <Pressable style={styles.logout} onPress={() => void logout()}>
        <Text style={styles.logoutText}>{t('settings.signOut')}</Text>
      </Pressable>
    </ScrollView>
  )
}

function settingsStyles(colors: ColorTokens) {
  return {
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 6,
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  value: { color: colors.textHeading, fontSize: 16, fontWeight: '600' },
  sub: { color: colors.textSecondary, fontSize: 13 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textMuted },
  statusOn: { backgroundColor: colors.success },
  statusWait: { backgroundColor: colors.warning },
  langRow: { flexDirection: 'row', gap: spacing.sm, marginTop: 4 },
  langChip: {
    borderRadius: radius.pill,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  langChipOn: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
  langText: { color: colors.textSecondary, fontSize: 13 },
  langTextOn: { color: colors.accentInk, fontWeight: '600' },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 6,
  },
  prefLabel: { flex: 1, color: colors.textPrimary, fontSize: 14 },
  saved: { color: colors.success, fontSize: 12 },
  error: { color: colors.error, fontSize: 12 },
  advanced: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  logout: {
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    paddingVertical: 13,
    alignItems: 'center',
  },
  logoutText: { color: colors.error, fontWeight: '600', fontSize: 15 },
  }
}
