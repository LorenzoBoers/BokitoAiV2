import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { useEffect, useState } from 'react'
import { Provider as PaperProvider } from 'react-native-paper'
import { PkbScreen } from './src/screens/PkbScreen'
import { ChangeRequestScreen } from './src/screens/ChangeRequestScreen'
import { MessagesScreen } from './src/screens/MessagesScreen'
import { LoginScreen } from './src/screens/LoginScreen'
import { SettingsScreen } from './src/screens/SettingsScreen'
import { bokitoTheme } from './src/theme'
import { fetchMemberships, type Membership } from './src/api/client'

const Stack = createNativeStackNavigator()
const Tabs = createBottomTabNavigator()

function MainTabs() {
  return (
    <Tabs.Navigator>
      <Tabs.Screen name="PKB" component={PkbScreen} />
      <Tabs.Screen name="Request" component={ChangeRequestScreen} options={{ title: 'Change request' }} />
      <Tabs.Screen name="Messages" component={MessagesScreen} />
    </Tabs.Navigator>
  )
}

export default function App() {
  const [memberships, setMemberships] = useState<Membership[] | null>(null)

  useEffect(() => {
    fetchMemberships().then(setMemberships).catch(() => setMemberships([]))
  }, [])

  const singleTenant = memberships?.length === 1

  return (
    <PaperProvider theme={bokitoTheme}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login" component={LoginScreen} />
          {singleTenant ? (
            <Stack.Screen name="Tabs" component={MainTabs} />
          ) : (
            <>
              <Stack.Screen name="TenantSelect" component={LoginScreen} />
              <Stack.Screen name="Tabs" component={MainTabs} />
            </>
          )}
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: true }} />
        </Stack.Navigator>
      </NavigationContainer>
    </PaperProvider>
  )
}
