import { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { Button, TextInput } from 'react-native-paper'

export function ChangeRequestScreen() {
  const [text, setText] = useState('')
  return (
    <View style={styles.wrap}>
      <TextInput
        mode="outlined"
        multiline
        numberOfLines={6}
        placeholder="What would you like to change or add?"
        value={text}
        onChangeText={setText}
      />
      <Button mode="contained" style={styles.btn} disabled={text.trim().length < 10}>
        Submit request
      </Button>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  btn: { marginTop: 16 },
})
