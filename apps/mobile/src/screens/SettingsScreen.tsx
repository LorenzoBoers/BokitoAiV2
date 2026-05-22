import { useEffect, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { Button, TextInput, Text } from 'react-native-paper'
import { listProjects, patchProject } from '../api/client'
import { useAppContext } from '../context/AppContext'

export function SettingsScreen() {
  const { projectId } = useAppContext()
  const [scope, setScope] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    listProjects()
      .then((projects) => {
        const p = projects.find((row) => row.id === projectId)
        if (p?.autonomous_scope) setScope(p.autonomous_scope)
      })
      .catch(() => {})
  }, [projectId])

  async function handleSave() {
    if (!projectId) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await patchProject(projectId, { autonomous_scope: scope.trim() })
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.wrap}>
      <Text variant="titleMedium">What is this project about?</Text>
      <TextInput
        mode="outlined"
        multiline
        style={styles.input}
        placeholder="Describe your project in a few sentences..."
        value={scope}
        onChangeText={setScope}
      />
      {saved ? <Text style={styles.success}>Saved.</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        mode="contained"
        loading={busy}
        disabled={busy || !projectId || scope.replace(/\s/g, '').length < 30}
        onPress={() => void handleSave()}
      >
        Save
      </Button>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  input: { minHeight: 120 },
  success: { color: '#047857', fontSize: 14 },
  error: { color: '#b91c1c', fontSize: 14 },
})
