import { ScrollView, Text, StyleSheet } from 'react-native'

export function PkbScreen() {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>What this project is today</Text>
      <Text style={styles.body}>PKB content loads from the workforce API when connected.</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 16 },
  h1: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  body: { fontSize: 16, lineHeight: 24 },
})
