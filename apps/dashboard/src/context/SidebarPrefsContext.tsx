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
  /** Expand/collapse a folder's sub-view. Project folders can keep their parents open. */
  setLeafExpanded: (
    scopeKey: string,
    expanded: boolean,
    extra?: { retain?: string[]; close?: string[] },
  ) => void
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

  const setLeafExpanded = useCallback(
    (scopeKey: string, expanded: boolean, extra?: { retain?: string[]; close?: string[] }) =>
      update((prev) => {
        if (!expanded) {
          const drop = new Set([scopeKey, ...(extra?.close ?? [])])
          return {
            ...prev,
            expandedLeaves: prev.expandedLeaves.filter((key) => !drop.has(key)),
          }
        }
        // Channels, tags and agents stay one-at-a-time. A project keeps the
        // folders above it open, so a nested folder does not hide its parent.
        if (scopeKey.startsWith('project:')) {
          const retain = extra?.retain ?? prev.expandedLeaves.filter((key) => key.startsWith('project:'))
          const chain = [...retain.filter((key) => key.startsWith('project:') && key !== scopeKey), scopeKey]
          return { ...prev, expandedLeaves: chain }
        }
        return { ...prev, expandedLeaves: [scopeKey] }
      }),
    [update],
  )

  const resetPrefs = useCallback(
    () => update(() => ({ order: [...DEFAULT_SECTION_ORDER], hidden: [], collapsed: [], expandedLeaves: [] })),
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
      setLeafExpanded,
      resetPrefs,
    }),
    [
      prefs,
      visibleSections,
      settingsVisible,
      setOrder,
      setSectionHidden,
      setSectionCollapsed,
      setLeafExpanded,
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
