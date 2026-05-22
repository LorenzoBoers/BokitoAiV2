import { useCallback, useEffect, useState } from 'react'
import { ScrollView, Text, StyleSheet, View, RefreshControl } from 'react-native'
import { SegmentedButtons } from 'react-native-paper'
import { listPkbSections, stripCodeBlocks, type PkbSectionRow } from '../api/client'
import { useAppContext } from '../context/AppContext'

type Tab = 'today' | 'going' | 'changing'

export function PkbScreen() {
  const { projectId } = useAppContext()
  const [tab, setTab] = useState<Tab>('today')
  const [sections, setSections] = useState<PkbSectionRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!projectId) {
      setSections([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const rows = await listPkbSections(projectId)
      setSections(rows)
    } catch {
      setSections([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  const layer =
    tab === 'today' ? 'current_state' : tab === 'going' ? 'intended_state' : 'change_queue'
  const filtered = sections.filter((s) => s.layer === layer)

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
    >
      <SegmentedButtons
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        buttons={[
          { value: 'today', label: 'Today' },
          { value: 'going', label: 'Going' },
          { value: 'changing', label: 'Changing' },
        ]}
      />
      {!projectId ? (
        <Text style={styles.body}>No project selected.</Text>
      ) : loading && !filtered.length ? (
        <Text style={styles.body}>Loading...</Text>
      ) : !filtered.length ? (
        <Text style={styles.body}>Nothing here yet. Your team will fill this in shortly.</Text>
      ) : (
        filtered.map((row) => (
          <View key={row.id} style={styles.card}>
            {row.title ? <Text style={styles.h2}>{row.title}</Text> : null}
            {row.domain ? <Text style={styles.chip}>{row.domain}</Text> : null}
            <Text style={styles.body}>{stripCodeBlocks(row.content)}</Text>
          </View>
        ))
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 16, gap: 12 },
  h2: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  chip: {
    alignSelf: 'flex-start',
    fontSize: 12,
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginBottom: 6,
    overflow: 'hidden',
  },
  body: { fontSize: 16, lineHeight: 24 },
  card: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
})
