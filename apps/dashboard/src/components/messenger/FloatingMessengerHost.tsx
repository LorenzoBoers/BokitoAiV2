import { useEffect, useMemo, useState } from 'react'
import { FloatingMessenger, type TenantAppearance } from '@bokito/messenger-ui'
import '@bokito/messenger-ui/src/styles.css'
import { useAuth } from '../../context/AuthContext'
import { bokitoTenantAppearance, createBokitoApiConfig } from '../../lib/bokito-api'

export function FloatingMessengerHost() {
  const { token } = useAuth()
  const [appearance, setAppearance] = useState<TenantAppearance | undefined>()

  const config = useMemo(() => createBokitoApiConfig(() => token), [token])

  useEffect(() => {
    if (!token) {
      setAppearance(undefined)
      return
    }
    bokitoTenantAppearance(token)
      .then(setAppearance)
      .catch(() => setAppearance(undefined))
  }, [token])

  if (!token) return null

  return <FloatingMessenger config={config} appearance={appearance} />
}
