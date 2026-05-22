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
import { fetchMemberships, listProjects, setActiveProjectId } from './src/api/client'
import { AppProvider } from './src/context/AppContext'

const Stack = createNativeStackNavigator()
const Tabs = createBottomTabNavigator()

function MainTabs({ navigation }: { navigation: { navigate: (n: string) => void } }) {
  return (
    <Tabs.Navigator>
      <Tabs.Screen name="PKB" component={PkbScreen} />
      <Tabs.Screen
        name="Request"
        component={ChangeRequestScreen}
        options={{ title: 'Change request' }}
      />
      <Tabs.Screen name="Messages" component={MessagesScreen} />
      <Tabs.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault()
            navigation.navigate('Settings')
          },
        }}
      />
    </Tabs.Navigator>
  )
}

export default function App() {
  const [projectId, setProjectId] = useState<string | null>(null)

  useEffect(() => {
    fetchMemberships()
      .then(() => listProjects())
      .then((projects) => {
        if (projects[0]?.id) {
          setProjectId(projects[0].id)
          setActiveProjectId(projects[0].id)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    setActiveProjectId(projectId)
  }, [projectId])

  return (
    <PaperProvider theme={bokitoTheme}>
      <AppProvider projectId={projectId} setProjectId={setProjectId}>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Tabs">{({ navigation }) => <MainTabs navigation={navigation} />}</Stack.Screen>
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ headerShown: true, title: 'Project settings' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </AppProvider>
    </PaperProvider>
  )
}
