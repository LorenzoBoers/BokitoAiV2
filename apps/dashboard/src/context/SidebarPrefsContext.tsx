import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_SECTION_ORDER,
  loadSidebarPrefs,
  saveSidebarPrefs,
  type SidebarPrefs,
  type SidebarSection,
} from '../lib/communication-sidebar-prefs'

type SidebarPrefsContextValue = {
  prefs: SidebarPrefs
  /** Visible sections in render order. */
  visibleSections: SidebarSection[]
  setOrder: (order: SidebarSection[]) => void
  setSectionHidden: (section: SidebarSection, hidden: boolean) => void
  setSectionCollapsed: (section: SidebarSection, collapsed: boolean) => void
  resetPrefs: () => void
}

const SidebarPrefsContext = createContext<SidebarPrefsContextValue | null>(null)

export function SidebarPrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<SidebarPrefs>(loadSidebarPrefs)

  const update = useCallback((updater: (prev: SidebarPrefs) => SidebarPrefs) => {
    setPrefs((prev) => {
      const next = updater(prev)
      saveSidebarPrefs(next)
      return next
    })
  }, [])

  const setOrder = useCallback(
    (order: SidebarSection[]) => update((prev) => ({ ...prev, order })),
    [update],
  )

  const setSectionHidden = useCallback(
    (section: SidebarSection, hidden: boolean) =>
      update((prev) => ({
        ...prev,
        hidden: hidden
          ? [...prev.hidden.filter((s) => s !== section), section]
          : prev.hidden.filter((s) => s !== section),
      })),
    [update],
  )

  const setSectionCollapsed = useCallback(
    (section: SidebarSection, collapsed: boolean) =>
      update((prev) => ({
        ...prev,
        collapsed: collapsed
          ? [...prev.collapsed.filter((s) => s !== section), section]
          : prev.collapsed.filter((s) => s !== section),
      })),
    [update],
  )

  const resetPrefs = useCallback(
    () => update(() => ({ order: [...DEFAULT_SECTION_ORDER], hidden: [], collapsed: [] })),
    [update],
  )

  const visibleSections = useMemo(
    () => prefs.order.filter((s) => !prefs.hidden.includes(s)),
    [prefs.order, prefs.hidden],
  )

  const value = useMemo(
    () => ({ prefs, visibleSections, setOrder, setSectionHidden, setSectionCollapsed, resetPrefs }),
    [prefs, visibleSections, setOrder, setSectionHidden, setSectionCollapsed, resetPrefs],
  )

  return <SidebarPrefsContext.Provider value={value}>{children}</SidebarPrefsContext.Provider>
}

export function useSidebarPrefs(): SidebarPrefsContextValue {
  const ctx = useContext(SidebarPrefsContext)
  if (!ctx) throw new Error('useSidebarPrefs must be used within SidebarPrefsProvider')
  return ctx
}
