import { useMemo } from 'react'
import { FloatingMessenger } from '@bokito/messenger-ui'
import '@bokito/messenger-ui/src/styles.css'
import { useAuth } from '../context/AuthContext'

const BOKITO_API_URL = import.meta.env.VITE_BOKITO_API_URL || 'http://127.0.0.1:8000'

export function FloatingMessengerHost() {
  const { token } = useAuth()

  const config = useMemo(
    () => ({
      baseUrl: BOKITO_API_URL,
      getToken: () => token,
    }),
    [token],
  )

  if (!token) return null

  return <FloatingMessenger config={config} />
}
