import { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { Button, TextInput, Text } from 'react-native-paper'

export function SettingsScreen() {
  const [scope, setScope] = useState('')
  return (
    <View style={styles.wrap}>
      <Text variant="titleMedium">What is this project about?</Text>
      <TextInput
        mode="outlined"
        multiline
        style={styles.input}
        placeholder="Describe your project in a few sentences…"
        value={scope}
        onChangeText={setScope}
      />
      <Button mode="contained" disabled={scope.replace(/\s/g, '').length < 30}>
        Save
      </Button>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  input: { minHeight: 120 },
})
