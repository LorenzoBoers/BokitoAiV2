import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useEntityRefresh } from '../lib/live-store'
import { listInboxFolders, type InboxFolder } from '../lib/signals-api'

/** Saved and project folders with open counts, kept fresh by live pushes. */
export function useInboxFolders(enabled = true) {
  const { token } = useAuth()
  const [folders, setFolders] = useState<InboxFolder[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    if (!token || !enabled) return
    try {
      setFolders(await listInboxFolders(token))
    } catch {
      /* keep the last list */
    } finally {
      setLoaded(true)
    }
  }, [token, enabled])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEntityRefresh(['case', 'project'], () => void refresh(), {
    debounceMs: 1500,
    topic: 'threads',
    enabled: enabled && Boolean(token),
  })

  return { folders, loaded, refresh }
}
