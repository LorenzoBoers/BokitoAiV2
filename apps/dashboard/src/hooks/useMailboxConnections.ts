import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { disconnectEmailConnection, isSendableMailbox, listEmailConnections, type EmailConnection } from '../lib/email-api'

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
      setError(err instanceof Error ? err.message : 'Could not load mailboxes.')
      setConnections([])
    } finally {
      setLoading(false)
    }
  }, [token, user?.organisationId, authLoading])

  const removeConnection = useCallback(
    async (connectionId: number) => {
      if (!token) {
        throw new Error('Not signed in.')
      }
      await disconnectEmailConnection(token, connectionId)
      setConnections((prev) => prev.filter((item) => item.id !== connectionId))
    },
    [token],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  const activeConnections = useMemo(
    () => connections.filter(isSendableMailbox),
    [connections],
  )
  const loadingState = loading || (Boolean(token) && authLoading)

  const needsOrganisation =
    !authLoading && Boolean(token) && user != null && user.organisationId == null

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
