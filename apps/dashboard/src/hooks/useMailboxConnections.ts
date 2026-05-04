import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { disconnectEmailConnection, listEmailConnections, type EmailConnection } from '../lib/email-api'

export function useMailboxConnections() {
  const { token, user, isLoading: authLoading } = useAuth()
  const [connections, setConnections] = useState<EmailConnection[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!token) {
      setConnections([])
      return
    }
    if (authLoading) return
    if (!user?.organisationId) {
      setConnections([])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const rows = await listEmailConnections(token)
      setConnections(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kon mailboxen niet laden.')
      setConnections([])
    } finally {
      setLoading(false)
    }
  }, [token, user?.organisationId, authLoading])

  const removeConnection = useCallback(
    async (connectionId: number) => {
      if (!token) return
      await disconnectEmailConnection(token, connectionId)
      setConnections((prev) => prev.filter((item) => item.id !== connectionId))
    },
    [token],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  const activeConnections = useMemo(() => connections.filter((item) => item.status === 'active'), [connections])
  const loadingState = loading || (Boolean(token) && authLoading)

  const needsOrganisation =
    !authLoading && Boolean(token) && Boolean(user) && user.organisationId == null

  return {
    connections,
    activeConnections,
    loading: loadingState,
    error,
    refresh,
    removeConnection,
    needsOrganisation,
  }
}
