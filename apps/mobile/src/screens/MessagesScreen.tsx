import { useCallback, useEffect, useState } from 'react'
import { FlatList, Text, StyleSheet, View, RefreshControl } from 'react-native'
import { Button } from 'react-native-paper'
import {
  approveAutonomousProposal,
  deferAutonomousProposal,
  listMessages,
  rejectAutonomousProposal,
  type MessageRow,
} from '../api/client'

function DecisionCard({
  message,
  onResolved,
}: {
  message: MessageRow
  onResolved: () => void
}) {
  const [busy, setBusy] = useState(false)
  const payload = message.payload ?? {}
  const isProposal =
    payload.kind === 'autonomous_proposal' ||
    payload.kind === 'high_risk_autonomous_proposal'

  async function act(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
      onResolved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.card}>
      {isProposal ? (
        <Text style={styles.pill}>Suggested by your team</Text>
      ) : null}
      <Text style={styles.subject}>{message.subject || 'Decision needed'}</Text>
      <Text style={styles.body}>{message.body}</Text>
      {isProposal ? (
        <View style={styles.actions}>
          <Button
            mode="contained"
            compact
            disabled={busy}
            onPress={() => act(() => approveAutonomousProposal(message.id))}
          >
            Approve
          </Button>
          <Button
            mode="outlined"
            compact
            disabled={busy}
            onPress={() => act(() => deferAutonomousProposal(message.id))}
          >
            Defer 7d
          </Button>
          <Button
            mode="outlined"
            compact
            disabled={busy}
            onPress={() => act(() => rejectAutonomousProposal(message.id))}
          >
            Reject
          </Button>
        </View>
      ) : null}
    </View>
  )
}

export function MessagesScreen() {
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await listMessages({
        message_type: 'decision_request',
        status: 'awaiting_human',
      })
      setMessages(rows)
    } catch {
      setMessages([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <FlatList
      data={messages}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
      ListEmptyComponent={
        loading ? null : (
          <Text style={styles.empty}>No open decisions. Your team will notify you here.</Text>
        )
      }
      renderItem={({ item }) => <DecisionCard message={item} onResolved={() => void load()} />}
    />
  )
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  card: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  pill: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 6,
  },
  subject: { fontWeight: '600', fontSize: 16 },
  body: { marginTop: 4, fontSize: 15, lineHeight: 22 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  empty: { fontSize: 15, color: '#6b7280', padding: 8 },
})
