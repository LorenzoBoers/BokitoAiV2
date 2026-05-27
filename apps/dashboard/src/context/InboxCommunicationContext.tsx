import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type InboxListQuickFilter = 'all' | 'unread' | 'pinned'

type InboxCommunicationContextValue = {
  search: string
  setSearch: (value: string) => void
  quickFilter: InboxListQuickFilter
  setQuickFilter: (value: InboxListQuickFilter) => void
  resetQuickFilter: () => void
}

const InboxCommunicationContext = createContext<InboxCommunicationContextValue | null>(null)

export function isInboxCommunicationRoute(pathname: string): boolean {
  return pathname.startsWith('/support/inbox/')
}

export function InboxCommunicationProvider({ children }: { children: ReactNode }) {
  const [search, setSearch] = useState('')
  const [quickFilter, setQuickFilter] = useState<InboxListQuickFilter>('all')

  const resetQuickFilter = useCallback(() => {
    setQuickFilter('all')
  }, [])

  const value = useMemo(
    () => ({
      search,
      setSearch,
      quickFilter,
      setQuickFilter,
      resetQuickFilter,
    }),
    [search, quickFilter, resetQuickFilter],
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
