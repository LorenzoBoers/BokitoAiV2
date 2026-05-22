import { View, Text, StyleSheet } from 'react-native'
import { Button } from 'react-native-paper'

export function LoginScreen({ navigation }: { navigation?: { replace: (n: string) => void } }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Bokito</Text>
      <Button mode="contained" onPress={() => navigation?.replace('Tabs')}>
        Continue
      </Button>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 24, marginBottom: 24, fontWeight: '600' },
})
