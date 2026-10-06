import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSidebarPrefs } from '../context/SidebarPrefsContext'
import { folderScopeKey } from '../lib/inbox-folder-prefs'
import {
  hasNavReveal,
  NAV_REVEAL_MS,
  scrollNavFolderIntoView,
  sidebarSectionForLeaf,
  stripNavReveal,
} from '../lib/nav-reveal'
import { leafFromPath, type HubLeaf } from '../lib/messages-paths'

const NavFlashContext = createContext<string | null>(null)

export function useNavFlashKey(): string | null {
  return useContext(NavFlashContext)
}

export function NavFlashProvider({
  activeLeaf,
  children,
}: {
  activeLeaf: HubLeaf | null
  children: ReactNode
}) {
  const { flashKey } = useNavReveal(activeLeaf)
  return <NavFlashContext.Provider value={flashKey}>{children}</NavFlashContext.Provider>
}

/**
 * When a Communication URL carries `?reveal=1`, unhide and expand the folder's
 * sidebar section, scroll the row into view, and flash it for two seconds.
 */
export function useNavReveal(activeLeaf: HubLeaf | null): { flashKey: string | null } {
  const location = useLocation()
  const navigate = useNavigate()
  const { setSectionHidden, setSectionCollapsed, setLeafExpanded } = useSidebarPrefs()
  const [flashKey, setFlashKey] = useState<string | null>(null)
  const leaf = activeLeaf ?? leafFromPath(location.pathname)
  const leafRef = useRef(leaf)
  leafRef.current = leaf
  const scope = leaf ? folderScopeKey(leaf) : ''
  const pending = hasNavReveal(location.search)

  useEffect(() => {
    if (!pending || !leafRef.current) return
    const current = leafRef.current
    const key = folderScopeKey(current)
    const section = sidebarSectionForLeaf(current)
    if (section) {
      setSectionHidden(section, false)
      setSectionCollapsed(section, false)
    }
    setLeafExpanded(key, true)
    setFlashKey(key)
    const nextSearch = stripNavReveal(location.search)
    navigate(`${location.pathname}${nextSearch}${location.hash}`, { replace: true })
  }, [
    pending,
    scope,
    location.hash,
    location.pathname,
    location.search,
    navigate,
    setLeafExpanded,
    setSectionCollapsed,
    setSectionHidden,
  ])

  useEffect(() => {
    if (!flashKey) return
    const current = leafRef.current
    if (!current || folderScopeKey(current) !== flashKey) return
    const stopScroll = scrollNavFolderIntoView(current)
    const clearFlash = window.setTimeout(() => setFlashKey(null), NAV_REVEAL_MS)
    return () => {
      stopScroll()
      window.clearTimeout(clearFlash)
    }
  }, [flashKey])

  return { flashKey }
}
