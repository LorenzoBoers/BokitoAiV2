import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import {
  DEFAULT_SECTION_ORDER,
  folderPinRef,
  loadSidebarPrefs,
  pathPinRef,
  saveSidebarPrefs,
  tagPinRef,
  type RailPin,
  type SidebarPrefs,
  type SidebarSection,
} from '../lib/communication-sidebar-prefs'
import { canHideItem } from '../lib/sidebar-catalog'
import { fetchRailPrefs, saveRailPrefs, togglePin } from '../lib/rail-prefs'

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
  /** Reorder views inside one parent. Returns false when the guard blocks a hide. */
  setParentOrder: (parentId: string, ids: string[]) => void
  setItemHidden: (id: string, hidden: boolean) => boolean
  isPinned: (ref: string) => boolean
  toggleRailPin: (ref: string) => void
  hideDefaultRow: (ref: string, hidden: boolean) => void
}

const SidebarPrefsContext = createContext<SidebarPrefsContextValue | null>(null)

export function SidebarPrefsProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const [prefs, setPrefs] = useState<SidebarPrefs>(loadSidebarPrefs)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void fetchRailPrefs(token)
      .then((remote) => {
        if (cancelled) return
        setPrefs((prev) => {
          const next = {
            ...remote,
            expandedLeaves: prev.expandedLeaves.length ? prev.expandedLeaves : remote.expandedLeaves,
          }
          saveSidebarPrefs(next)
          return next
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [token])

  const persist = useCallback(
    (next: SidebarPrefs) => {
      saveSidebarPrefs(next)
      if (token) void saveRailPrefs(token, next).catch(() => undefined)
    },
    [token],
  )

  const update = useCallback(
    (updater: (prev: SidebarPrefs) => SidebarPrefs) => {
      setPrefs((prev) => {
        const next = updater(prev)
        persist(next)
        return next
      })
    },
    [persist],
  )

  const setOrder = useCallback(
    (order: SidebarSection[]) =>
      update((prev) => {
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
    () =>
      update((prev) => ({
        ...prev,
        order: [...DEFAULT_SECTION_ORDER],
        hidden: [],
        itemOrder: {},
        hiddenItems: [],
      })),
    [update],
  )

  const setParentOrder = useCallback(
    (parentId: string, ids: string[]) =>
      update((prev) => ({
        ...prev,
        itemOrder: { ...prev.itemOrder, [parentId]: ids },
      })),
    [update],
  )

  const setItemHidden = useCallback(
    (id: string, hidden: boolean) => {
      if (hidden && !canHideItem(id, prefs.hiddenItems)) return false
      update((prev) => ({
        ...prev,
        hiddenItems: hidden
          ? [...prev.hiddenItems.filter((item) => item !== id), id]
          : prev.hiddenItems.filter((item) => item !== id),
      }))
      return true
    },
    [prefs.hiddenItems, update],
  )

  const isPinned = useCallback((ref: string) => prefs.railPins.some((pin) => pin.ref === ref), [prefs.railPins])

  const toggleRailPin = useCallback(
    (ref: string) =>
      update((prev) => ({
        ...prev,
        railPins: togglePin(prev.railPins, ref).map((pin, index) => ({ ...pin, position: index })),
      })),
    [update],
  )

  const hideDefaultRow = useCallback(
    (ref: string, hidden: boolean) =>
      update((prev) => ({
        ...prev,
        railHiddenDefaults: hidden
          ? [...prev.railHiddenDefaults.filter((item) => item !== ref), ref]
          : prev.railHiddenDefaults.filter((item) => item !== ref),
      })),
    [update],
  )

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
      setParentOrder,
      setItemHidden,
      isPinned,
      toggleRailPin,
      hideDefaultRow,
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
      setParentOrder,
      setItemHidden,
      isPinned,
      toggleRailPin,
      hideDefaultRow,
    ],
  )

  return <SidebarPrefsContext.Provider value={value}>{children}</SidebarPrefsContext.Provider>
}

export function useSidebarPrefs(): SidebarPrefsContextValue {
  const ctx = useContext(SidebarPrefsContext)
  if (!ctx) throw new Error('useSidebarPrefs must be used within SidebarPrefsProvider')
  return ctx
}

/** For surfaces that share folder trees outside Communication (e.g. Agenda). */
export function useOptionalSidebarPrefs(): SidebarPrefsContextValue | null {
  return useContext(SidebarPrefsContext)
}

export { folderPinRef, pathPinRef, tagPinRef }
export type { RailPin }
