import { useEffect, useRef, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSidebarPrefs } from '../../context/SidebarPrefsContext'
import { folderScopeKey } from '../../lib/inbox-folder-prefs'
import {
  leafKey,
  leafPath,
  sameLeafScope,
  SUB_QUEUES,
  type HubLeaf,
  type SubQueue,
} from '../../lib/messages-paths'
import NavCountBadge from '../layout/NavCountBadge'
import { cn } from '../../lib/utils'

export const SUB_QUEUE_LABEL_KEYS: Record<SubQueue, string> = {
  open: 'support.inbox.open',
  mine: 'support.inbox.mine',
  unassigned: 'support.inbox.unassigned',
  closed: 'support.inbox.closed',
}

type QueueSublistProps = {
  /** Folder leaf without a queue; sub-rows derive from it. */
  baseLeaf: HubLeaf
  activeLeaf: HubLeaf | null
  /** Extra rows under the standard Open / Mine / Unassigned / Closed list. */
  children?: ReactNode
}

/** The uniform Open / Mine / Unassigned / Closed rows under a folder. */
export function QueueSublist({ baseLeaf, activeLeaf, children }: QueueSublistProps) {
  const { t } = useTranslation('nav')
  return (
    <div className="ml-[15px] space-y-px border-l border-border/70 pl-2">
      {SUB_QUEUES.map((queue) => {
        const leaf = { ...baseLeaf, queue } as HubLeaf
        const isActive = activeLeaf != null && leafKey(activeLeaf) === leafKey(leaf)
        return (
          <NavLink
            key={queue}
            to={leafPath(leaf)}
            data-active={isActive ? 'true' : undefined}
            className={cn('nav-row nav-sub-row h-[26px] text-xs')}
          >
            <span className="min-w-0 flex-1 truncate-fade">{t(SUB_QUEUE_LABEL_KEYS[queue])}</span>
          </NavLink>
        )
      })}
      {children}
    </div>
  )
}

type SidebarFolderProps = {
  /** Channel, tag, agent, or inbox leaf without a queue. */
  baseLeaf: HubLeaf
  label: string
  icon: ReactNode
  activeLeaf: HubLeaf | null
  /** The sub-view a first expand opens (from folder prefs). */
  defaultQueue: SubQueue
  badgeCount?: number
  title?: string
  /** Extra rows under the standard Open / Mine / Unassigned / Closed list. */
  extra?: ReactNode
  /** Optional trailing control on the folder header (e.g. compose +). */
  headerAction?: ReactNode
}

/**
 * Expandable sidebar folder for channels, tags, and agents.
 *
 * - Sub-queues stay hidden until the folder is clicked (clutter-free default).
 * - Clicking the row toggles expand; expanding also opens the default sub-view.
 * - Only one folder stays expanded at a time (accordion via sidebar prefs).
 * - Deep links into a sub-queue still auto-expand that folder once.
 */
export function SidebarFolder({
  baseLeaf,
  label,
  icon,
  activeLeaf,
  defaultQueue,
  badgeCount = 0,
  title,
  extra,
  headerAction,
}: SidebarFolderProps) {
  const navigate = useNavigate()
  const { prefs, setLeafExpanded } = useSidebarPrefs()

  const scopeKey = folderScopeKey(baseLeaf)
  const scopeActive = sameLeafScope(activeLeaf, baseLeaf)
  const expanded = prefs.expandedLeaves.includes(scopeKey)
  const headerActive =
    activeLeaf != null && leafKey(activeLeaf) === leafKey(baseLeaf)

  // Auto-expand once when the folder becomes active (deep link), so the
  // highlighted sub-row is visible — accordion keeps others collapsed.
  const wasScopeActive = useRef(false)
  useEffect(() => {
    if (scopeActive && !wasScopeActive.current) setLeafExpanded(scopeKey, true)
    wasScopeActive.current = scopeActive
  }, [scopeActive, scopeKey, setLeafExpanded])

  const toggleFolder = () => {
    if (expanded) {
      setLeafExpanded(scopeKey, false)
      return
    }
    setLeafExpanded(scopeKey, true)
    navigate(leafPath({ ...baseLeaf, queue: defaultQueue } as HubLeaf))
  }

  return (
    <div className="space-y-px">
      <button
        type="button"
        title={title || label}
        onClick={toggleFolder}
        aria-expanded={expanded}
        data-active={headerActive || (scopeActive && !expanded) ? 'true' : undefined}
        className={cn('nav-row group text-left')}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-muted">{icon}</span>
        <span className="min-w-0 flex-1 truncate-fade">{label}</span>
        {headerAction ? (
          <span
            className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {headerAction}
          </span>
        ) : null}
        <NavCountBadge count={badgeCount} placement="inline" />
      </button>
      <div className="nav-fold" data-open={expanded ? 'true' : undefined} aria-hidden={!expanded}>
        <div className="nav-fold-inner">
          <QueueSublist baseLeaf={baseLeaf} activeLeaf={activeLeaf}>
            {extra}
          </QueueSublist>
        </div>
      </div>
    </div>
  )
}
