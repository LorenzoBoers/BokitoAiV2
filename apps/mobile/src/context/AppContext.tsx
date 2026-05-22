import { createContext, useContext, useMemo, type ReactNode } from 'react'

type AppContextValue = {
  projectId: string | null
  setProjectId: (id: string | null) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({
  projectId,
  setProjectId,
  children,
}: {
  projectId: string | null
  setProjectId: (id: string | null) => void
  children: ReactNode
}) {
  const value = useMemo(() => ({ projectId, setProjectId }), [projectId, setProjectId])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used within AppProvider')
  return ctx
}
