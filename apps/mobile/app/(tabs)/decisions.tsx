import { useCallback, useEffect, useState } from 'react'
import { router } from 'expo-router'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { approveDecision, listDecisions, rejectDecision, type Decision } from '../../src/lib/api'
import { onGatewayEvent } from '../../src/lib/gateway'
import { colors, spacing } from '../../src/theme'

export default function DecisionsScreen() {
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const rows = await listDecisions('awaiting_human')
    setDecisions(rows)
  }, [])

  useEffect(() => {
    let cancelled = false
    load()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load])

  useEffect(() => {
    return onGatewayEvent('decisions', () => {
      void load()
    })
  }, [load])

  const act = async (decision: Decision, action: 'approve' | 'reject') => {
    if (busyId) return
    setBusyId(decision.id)
    try {
      const optionId =
        decision.options.find((o) => o.id === action)?.id ??
        decision.options[action === 'approve' ? 0 : decision.options.length - 1]?.id ??
        action
      if (action === 'approve') {
        await approveDecision(decision.id, optionId)
      } else {
        await rejectDecision(decision.id, optionId)
      }
      setDecisions((prev) => prev.filter((d) => d.id !== decision.id))
    } catch {
      // keep row; user can retry
    } finally {
      setBusyId(null)
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <FlatList
      style={styles.root}
      data={decisions}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.title}>{item.title}</Text>
          {item.summary ? <Text style={styles.summary}>{item.summary}</Text> : null}
          {item.signal_id ? (
            <Pressable onPress={() => router.push(`/thread/${item.signal_id}`)}>
              <Text style={styles.threadLink}>Open thread</Text>
            </Pressable>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              style={[styles.button, styles.approve, busyId === item.id && styles.buttonDisabled]}
              onPress={() => void act(item, 'approve')}
            >
              <Text style={styles.buttonText}>Approve</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.reject, busyId === item.id && styles.buttonDisabled]}
              onPress={() => void act(item, 'reject')}
            >
              <Text style={styles.buttonText}>Reject</Text>
            </Pressable>
          </View>
        </View>
      )}
      ListEmptyComponent={
        <Text style={styles.empty}>No decisions waiting on you. Agents are running within policy.</Text>
      }
    />
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { color: colors.textHeading, fontSize: 15, fontWeight: '600' },
  summary: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  threadLink: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  button: {
    flex: 1,
    borderRadius: 9,
    paddingVertical: 10,
    alignItems: 'center',
  },
  approve: { backgroundColor: colors.accent },
  reject: { backgroundColor: colors.elevated, borderColor: colors.border, borderWidth: 1 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.textHeading, fontWeight: '600', fontSize: 14 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl * 2 },
})
