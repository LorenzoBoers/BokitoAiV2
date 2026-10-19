import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSidebarPrefs } from '../../context/SidebarPrefsContext'
import { folderScopeKey } from '../../lib/inbox-folder-prefs'
import { useNavFlashKey } from '../../hooks/useNavReveal'
import {
  leafKey,
  leafPath,
  sameLeafScope,
  SUB_QUEUES,
  type HubLeaf,
  type SubQueue,
} from '../../lib/messages-paths'
import {
  dataTransferHasThreads,
  readThreadDragIds,
} from '../../lib/thread-folder-drag'
import NavCountBadge from '../layout/NavCountBadge'
import { Tip } from '../ui/Tip'
import { cn } from '../../lib/utils'

export const SUB_QUEUE_LABEL_KEYS: Record<SubQueue, string> = {
  for_you: 'support.inbox.forYou',
  open: 'support.inbox.open',
  unassigned: 'support.inbox.unassigned',
  closed: 'support.inbox.closed',
}

type QueueSublistProps = {
  /** Folder leaf without a queue; sub-rows derive from it. */
  baseLeaf: HubLeaf
  activeLeaf: HubLeaf | null
  /** Badge per sub-queue. */
  counts?: Partial<Record<SubQueue, number>>
  /** Rows above the standard For you / Open / Unassigned / Closed list. */
  leading?: ReactNode
  /** Extra rows under the standard For you / Open / Unassigned / Closed list. */
  children?: ReactNode
  /** Sub-views to list. Defaults to every queue. */
  queues?: readonly SubQueue[]
}

/** The uniform For you / Open / Unassigned / Closed rows under a folder. */
export function QueueSublist({
  baseLeaf,
  activeLeaf,
  counts,
  leading,
  children,
  queues = SUB_QUEUES,
}: QueueSublistProps) {
  const { t } = useTranslation('nav')
  return (
    <div className="nav-tree-children">
      {leading}
      {queues.map((queue) => {
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
            <NavCountBadge count={counts?.[queue] ?? 0} placement="inline" />
          </NavLink>
        )
      })}
      {children}
    </div>
  )
}

type SidebarFolderProps = {
  /** Inbox or team leaf without a queue. */
  baseLeaf: HubLeaf
  label: string
  /** Replaces the text label. `label` stays the tooltip. */
  labelNode?: ReactNode
  icon?: ReactNode
  activeLeaf: HubLeaf | null
  /** The sub-view a first expand opens (from folder prefs). */
  defaultQueue: SubQueue
  badgeCount?: number
  queueCounts?: Partial<Record<SubQueue, number>>
  title?: string
  /** Rows above the standard For you / Open / Unassigned / Closed list. */
  leading?: ReactNode
  /** Extra rows under the standard For you / Open / Unassigned / Closed list. */
  extra?: ReactNode
  /** Sub-views under this folder. An empty list means no queue children. */
  queues?: readonly SubQueue[]
  /** Queue the header opens. `null` opens the folder's own open list. */
  headerQueue?: SubQueue | null
  /** Optional trailing control on the folder header (e.g. compose +). */
  headerAction?: ReactNode
  /** Project scope keys that stay open when this folder opens (its parents). */
  retainOnExpand?: string[]
  /** Project scope keys closed together with this folder (the folders inside it). */
  closeOnCollapse?: string[]
  /** Drop conversations here (Communication rail file-into-folder / flow). */
  onFileThreads?: (threadIds: string[]) => void | Promise<void>
}

/**
 * Expandable sidebar folder for All communication and pinned teams.
 *
 * - Sub-queues stay hidden until the folder is clicked (clutter-free default).
 * - Clicking the row toggles expand; expanding also opens the default sub-view.
 * - Only one folder stays expanded at a time (accordion via sidebar prefs).
 * - Deep links into a sub-queue still auto-expand that folder once.
 */
export function SidebarFolder({
  baseLeaf,
  label,
  labelNode,
  icon,
  activeLeaf,
  defaultQueue,
  badgeCount = 0,
  queueCounts,
  title,
  leading,
  extra,
  queues,
  headerQueue,
  headerAction,
  retainOnExpand,
  closeOnCollapse,
  onFileThreads,
}: SidebarFolderProps) {
  const navigate = useNavigate()
  const { prefs, setLeafExpanded } = useSidebarPrefs()
  const flashKey = useNavFlashKey()
  const [dropLit, setDropLit] = useState(false)

  const scopeKey = folderScopeKey(baseLeaf)
  const revealed = flashKey === scopeKey
  const scopeActive = sameLeafScope(activeLeaf, baseLeaf)
  const expanded = prefs.expandedLeaves.includes(scopeKey)
  const queueList = queues ?? SUB_QUEUES
  const hasQueueRows = queueList.length > 0
  const hasNested = hasQueueRows || leading != null || extra != null
  const headerActive =
    activeLeaf != null &&
    (leafKey(activeLeaf) === leafKey(baseLeaf) || (!hasQueueRows && scopeActive))

  // Auto-expand once when the folder becomes active (deep link), so the
  // highlighted sub-row is visible — accordion keeps others collapsed.
  const wasScopeActive = useRef(false)
  useEffect(() => {
    if (!hasNested) return
    if (scopeActive && !wasScopeActive.current) {
      setLeafExpanded(scopeKey, true, { retain: retainOnExpand })
    }
    wasScopeActive.current = scopeActive
  }, [hasNested, scopeActive, scopeKey, setLeafExpanded, retainOnExpand])

  const openHeader = () => {
    if (headerQueue === null || !hasQueueRows) {
      navigate(leafPath(baseLeaf))
      return
    }
    navigate(leafPath({ ...baseLeaf, queue: headerQueue ?? defaultQueue } as HubLeaf))
  }

  const toggleFolder = () => {
    if (!hasNested) {
      openHeader()
      return
    }
    if (expanded) {
      setLeafExpanded(scopeKey, false, { close: closeOnCollapse })
      return
    }
    setLeafExpanded(scopeKey, true, { retain: retainOnExpand })
    openHeader()
  }

  const onDragOver = (event: DragEvent) => {
    if (!onFileThreads || !dataTransferHasThreads(event.dataTransfer.types)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDropLit(true)
  }
  const onDragLeave = (event: DragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDropLit(false)
  }
  const onDrop = (event: DragEvent) => {
    if (!onFileThreads) return
    const ids = readThreadDragIds(event.dataTransfer)
    setDropLit(false)
    if (!ids.length) return
    event.preventDefault()
    event.stopPropagation()
    void onFileThreads(ids)
  }

  return (
    <div className="space-y-px">
      <Tip label={title || label} side="right" className="max-w-56 font-normal">
        <button
          type="button"
          onClick={toggleFolder}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          aria-expanded={hasNested ? expanded : undefined}
          data-nav-folder={scopeKey}
          data-active={headerActive || (scopeActive && !expanded) ? 'true' : undefined}
          data-nav-reveal={revealed ? 'true' : undefined}
          className={cn(
            'nav-row group h-[26px] text-left text-xs',
            dropLit && 'bg-accent/15 ring-1 ring-inset ring-accent/40',
          )}
        >
          {icon ? (
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-text-muted">
              {icon}
            </span>
          ) : null}
          <span className={cn('min-w-0 flex-1', labelNode ? 'flex items-center' : 'truncate-fade')}>
            {labelNode ?? label}
          </span>
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
      </Tip>
      {hasNested ? (
      <div className="nav-fold" data-open={expanded ? 'true' : undefined} aria-hidden={!expanded}>
        <div className="nav-fold-inner">
          <QueueSublist
            baseLeaf={baseLeaf}
            activeLeaf={activeLeaf}
            counts={queueCounts}
            leading={leading}
            queues={queueList}
          >
            {extra}
          </QueueSublist>
        </div>
      </div>
      ) : null}
    </div>
  )
}
