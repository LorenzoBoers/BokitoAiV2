import { FlatList, Text, StyleSheet } from 'react-native'

const PLACEHOLDER = [
  { id: '1', subject: 'Messages', body: 'Decision requests and agent updates appear here.' },
]

export function MessagesScreen() {
  return (
    <FlatList
      data={PLACEHOLDER}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <>
          <Text style={styles.subject}>{item.subject}</Text>
          <Text style={styles.body}>{item.body}</Text>
        </>
      )}
    />
  )
}

const styles = StyleSheet.create({
  list: { padding: 16 },
  subject: { fontWeight: '600', fontSize: 16 },
  body: { marginTop: 4, fontSize: 15, lineHeight: 22 },
})
