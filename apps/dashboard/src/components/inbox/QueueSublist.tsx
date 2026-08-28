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
    <div className="space-y-0.5 border-l border-border/40 pl-2 ml-4">
      {SUB_QUEUES.map((queue) => {
        const leaf = { ...baseLeaf, queue } as HubLeaf
        const isActive = activeLeaf != null && leafKey(activeLeaf) === leafKey(leaf)
        return (
          <NavLink
            key={queue}
            to={leafPath(leaf)}
            className={() =>
              cn(
                'nav-row nav-sub-row flex items-center gap-2 rounded-lg border px-3 py-1 text-[12px] font-medium',
                isActive
                  ? 'border-border/60 bg-bg-hover/85 text-text-heading'
                  : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary',
              )
            }
          >
            <span className="min-w-0 flex-1 truncate">{t(SUB_QUEUE_LABEL_KEYS[queue])}</span>
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
    <div className="space-y-0.5">
      <button
        type="button"
        title={title || label}
        onClick={toggleFolder}
        aria-expanded={expanded}
        className={cn(
          'nav-row group flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-[13px] font-medium',
          headerActive || (scopeActive && !expanded)
            ? 'border-border/60 bg-bg-hover/85 text-text-heading shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_18px_-14px_rgba(15,23,42,0.4)]'
            : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary',
        )}
      >
        <span
          className={cn(
            'shrink-0 transition-transform duration-150 ease-out',
            expanded && 'scale-[1.04]',
          )}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
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
