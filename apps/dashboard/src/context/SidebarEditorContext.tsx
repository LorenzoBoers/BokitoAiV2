import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { CatalogNode } from '../lib/sidebar-catalog'

type SidebarEditorValue = {
  open: boolean
  focusId: string | null
  catalog: CatalogNode[]
  setCatalog: (nodes: CatalogNode[]) => void
  openEditor: (focusId?: string) => void
  closeEditor: () => void
}

const SidebarEditorContext = createContext<SidebarEditorValue | null>(null)

export function SidebarEditorProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<CatalogNode[]>([])

  const openEditor = useCallback((id?: string) => {
    setFocusId(id ?? null)
    setOpen(true)
  }, [])

  const closeEditor = useCallback(() => {
    setOpen(false)
    setFocusId(null)
  }, [])

  const value = useMemo(
    () => ({ open, focusId, catalog, setCatalog, openEditor, closeEditor }),
    [open, focusId, catalog, openEditor, closeEditor],
  )

  return <SidebarEditorContext.Provider value={value}>{children}</SidebarEditorContext.Provider>
}

export function useSidebarEditor(): SidebarEditorValue {
  const ctx = useContext(SidebarEditorContext)
  if (!ctx) throw new Error('useSidebarEditor must be used within SidebarEditorProvider')
  return ctx
}
