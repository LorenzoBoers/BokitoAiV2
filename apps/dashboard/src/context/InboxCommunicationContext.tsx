import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  readQuickFilter,
  writeQuickFilter,
  type InboxListQuickFilter,
} from '../lib/inbox-prefs'
import { leafFromPath } from '../lib/messages-paths'

export type { InboxListQuickFilter }

type InboxCommunicationContextValue = {
  search: string
  setSearch: (value: string) => void
  /** Debounced copy of `search` used for list fetches. */
  listSearch: string
  quickFilter: InboxListQuickFilter
  setQuickFilter: (value: InboxListQuickFilter) => void
  resetQuickFilter: () => void
}

const InboxCommunicationContext = createContext<InboxCommunicationContextValue | null>(null)

export function isInboxCommunicationRoute(pathname: string): boolean {
  return leafFromPath(pathname) !== null
}

export function InboxCommunicationProvider({ children }: { children: ReactNode }) {
  const [search, setSearchState] = useState('')
  const [listSearch, setListSearch] = useState('')
  const [quickFilter, setQuickFilterState] = useState<InboxListQuickFilter>(readQuickFilter)

  useEffect(() => {
    if (!search.trim()) {
      setListSearch('')
      return
    }
    const timer = window.setTimeout(() => setListSearch(search), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const setSearch = useCallback((value: string) => {
    setSearchState(value)
    if (!value.trim()) setListSearch('')
  }, [])

  const setQuickFilter = useCallback((value: InboxListQuickFilter) => {
    setQuickFilterState(value)
    writeQuickFilter(value)
  }, [])

  const resetQuickFilter = useCallback(() => {
    setQuickFilterState('all')
    writeQuickFilter('all')
  }, [])

  const value = useMemo(
    () => ({
      search,
      setSearch,
      listSearch,
      quickFilter,
      setQuickFilter,
      resetQuickFilter,
    }),
    [search, setSearch, listSearch, quickFilter, setQuickFilter, resetQuickFilter],
  )

  return (
    <InboxCommunicationContext.Provider value={value}>{children}</InboxCommunicationContext.Provider>
  )
}

export function useInboxCommunication() {
  const ctx = useContext(InboxCommunicationContext)
  if (!ctx) {
    throw new Error('useInboxCommunication must be used within InboxCommunicationProvider')
  }
  return ctx
}

export function useOptionalInboxCommunication() {
  return useContext(InboxCommunicationContext)
}
