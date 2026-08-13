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
  /** Visible middle sections in render order (Settings excluded — anchored separately). */
  visibleSections: SidebarSection[]
  /** Whether the anchored Settings block should render. */
  settingsVisible: boolean
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
    (order: SidebarSection[]) =>
      update((prev) => {
        // Settings stays anchored at the bottom of the rail.
        const middle = order.filter((s) => s !== 'settings')
        return { ...prev, order: [...middle, 'settings'] }
      }),
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

  /** Visible middle sections (excludes anchored Settings). */
  const visibleSections = useMemo(
    () => prefs.order.filter((s) => s !== 'settings' && !prefs.hidden.includes(s)),
    [prefs.order, prefs.hidden],
  )

  const settingsVisible = useMemo(() => !prefs.hidden.includes('settings'), [prefs.hidden])

  const value = useMemo(
    () => ({
      prefs,
      visibleSections,
      settingsVisible,
      setOrder,
      setSectionHidden,
      setSectionCollapsed,
      resetPrefs,
    }),
    [
      prefs,
      visibleSections,
      settingsVisible,
      setOrder,
      setSectionHidden,
      setSectionCollapsed,
      resetPrefs,
    ],
  )

  return <SidebarPrefsContext.Provider value={value}>{children}</SidebarPrefsContext.Provider>
}

export function useSidebarPrefs(): SidebarPrefsContextValue {
  const ctx = useContext(SidebarPrefsContext)
  if (!ctx) throw new Error('useSidebarPrefs must be used within SidebarPrefsProvider')
  return ctx
}
