import { useState } from 'react'
import { View, StyleSheet, Text } from 'react-native'
import { Button, TextInput, SegmentedButtons } from 'react-native-paper'
import { submitChangeRequest } from '../api/client'
import { useAppContext } from '../context/AppContext'

export function ChangeRequestScreen() {
  const { projectId } = useAppContext()
  const [text, setText] = useState('')
  const [priority, setPriority] = useState('5')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!projectId) return
    setBusy(true)
    setError(null)
    try {
      await submitChangeRequest({
        project_id: projectId,
        content: text.trim(),
        priority: Number(priority),
      })
      setText('')
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.wrap}>
      <TextInput
        mode="outlined"
        multiline
        numberOfLines={6}
        placeholder="What would you like to change or add?"
        value={text}
        onChangeText={(v) => {
          setText(v)
          setDone(false)
        }}
      />
      <SegmentedButtons
        value={priority}
        onValueChange={setPriority}
        buttons={[
          { value: '3', label: 'Whenever' },
          { value: '5', label: 'Soon' },
          { value: '8', label: 'Urgent' },
        ]}
      />
      {done ? (
        <Text style={styles.success}>Your request was submitted. Check the Changing tab in PKB.</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        mode="contained"
        style={styles.btn}
        loading={busy}
        disabled={busy || !projectId || text.trim().length < 10}
        onPress={() => void handleSubmit()}
      >
        Submit request
      </Button>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  btn: { marginTop: 4 },
  success: { color: '#047857', fontSize: 14 },
  error: { color: '#b91c1c', fontSize: 14 },
})
