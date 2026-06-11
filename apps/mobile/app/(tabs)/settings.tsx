import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useAuth } from '../../src/context/AuthContext'
import { API_URL } from '../../src/lib/config'
import { colors, spacing } from '../../src/theme'

export default function SettingsScreen() {
  const { user, signOut } = useAuth()

  const logout = async () => {
    await signOut()
    router.replace('/login')
  }

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.label}>Signed in as</Text>
        <Text style={styles.value}>{user?.display_name || user?.email || 'Unknown'}</Text>
        <Text style={styles.sub}>{user?.email}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Workspace</Text>
        <Text style={styles.value}>{user?.tenant?.name ?? 'Unknown'}</Text>
        <Text style={styles.sub}>{user?.tenant?.slug}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>API endpoint</Text>
        <Text style={styles.sub}>{API_URL}</Text>
      </View>

      <Pressable style={styles.logout} onPress={() => void logout()}>
        <Text style={styles.logoutText}>Sign out</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.lg,
    gap: 2,
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  value: { color: colors.textHeading, fontSize: 16, fontWeight: '600' },
  sub: { color: colors.textSecondary, fontSize: 13 },
  logout: {
    marginTop: 'auto',
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    paddingVertical: 13,
    alignItems: 'center',
  },
  logoutText: { color: colors.error, fontWeight: '600', fontSize: 15 },
})
