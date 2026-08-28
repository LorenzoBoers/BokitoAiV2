import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  DEFAULT_INBOX_FOLDER_PREFS,
  fetchInboxFolderPrefs,
  resolveDefaultQueue,
  saveInboxFolderPrefs,
  type InboxFolderPrefs,
} from '../lib/inbox-folder-prefs'
import type { HubLeaf, SubQueue } from '../lib/messages-paths'

// Session cache so the sidebar does not refetch on every remount.
let cached: InboxFolderPrefs | null = null

/**
 * Roaming default sub-view (Open / Mine / ...) for channel and tag folders.
 * Reads `/me/preferences` once per session; writes update the cache so the
 * sidebar and settings stay in sync within a tab.
 */
export function useInboxFolderPrefs() {
  const { token } = useAuth()
  const [prefs, setPrefs] = useState<InboxFolderPrefs>(() => {
    const base = cached ?? DEFAULT_INBOX_FOLDER_PREFS
    return {
      defaultQueue: base.defaultQueue,
      channelDefaults: base.channelDefaults ?? {},
      sidebarTags: Array.isArray(base.sidebarTags) ? base.sidebarTags : [],
    }
  })
  const [loaded, setLoaded] = useState(cached != null)

  useEffect(() => {
    if (!token || cached != null) return
    let cancelled = false
    void fetchInboxFolderPrefs(token)
      .then((data) => {
        cached = data
        if (!cancelled) {
          setPrefs(data)
          setLoaded(true)
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const update = useCallback(
    async (next: InboxFolderPrefs) => {
      cached = next
      setPrefs(next)
      if (token) await saveInboxFolderPrefs(token, next)
    },
    [token],
  )

  const defaultQueueFor = useCallback((leaf: HubLeaf): SubQueue => resolveDefaultQueue(prefs, leaf), [prefs])

  return { prefs, loaded, update, defaultQueueFor }
}

/** Test/logout hook: drop the session cache. */
export function clearInboxFolderPrefsCache(): void {
  cached = null
}
