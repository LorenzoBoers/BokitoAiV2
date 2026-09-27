import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getChannelStatus, type ChannelStatusSnapshot } from '../lib/channels-api'

const EMPTY: ChannelStatusSnapshot = {
  channels: [],
  readyCount: 0,
  emailReady: false,
  sendReady: false,
}

/** Shared ChannelStatus truth for Setup, Connections, and composer banners. */
export function useChannelStatus() {
  const { token, user, isLoading: authLoading } = useAuth()
  const [snapshot, setSnapshot] = useState<ChannelStatusSnapshot>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!token || authLoading) {
      if (!token) setSnapshot(EMPTY)
      return
    }
    if (!user?.organisationId) {
      setSnapshot(EMPTY)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await getChannelStatus(token))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load channel status.')
      setSnapshot(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [token, user?.organisationId, authLoading])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    ...snapshot,
    loading: loading || (Boolean(token) && authLoading),
    error,
    refresh,
  }
}
