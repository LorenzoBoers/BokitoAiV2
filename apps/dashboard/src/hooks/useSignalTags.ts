import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  listSignalTags,
  SIGNAL_TAGS_CHANGED_EVENT,
  type SignalTagRow,
} from '../lib/signals-api'

/**
 * The tenant tag registry, shared by every tag surface (sidebar folders, the
 * thread tag picker, settings). The last response is cached module-wide so
 * opening a thread does not refetch, and every consumer refreshes together on
 * `SIGNAL_TAGS_CHANGED_EVENT`.
 */
let cachedRows: SignalTagRow[] | null = null

export function useSignalTags() {
  const { token } = useAuth()
  const [rows, setRows] = useState<SignalTagRow[] | null>(cachedRows)
  const [loading, setLoading] = useState(cachedRows == null)

  const reload = useCallback(async () => {
    if (!token) return
    try {
      const next = await listSignalTags(token)
      cachedRows = next
      setRows(next)
    } catch {
      setRows((prev) => prev ?? [])
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void reload()
    const onChanged = () => {
      void reload()
    }
    window.addEventListener(SIGNAL_TAGS_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(SIGNAL_TAGS_CHANGED_EVENT, onChanged)
  }, [reload])

  return { rows, tags: rows ?? [], loading, reload }
}
