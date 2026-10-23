import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable } from '../ui/pressable'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Pin, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import {
  folderPinRef,
  pathPinRef,
  tagPinRef,
  useOptionalSidebarPrefs,
  useSidebarPrefs,
} from '../../context/SidebarPrefsContext'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { filtersetLocalNames, filtersetPlainLabel } from '../../lib/folder-filter-tree'
import {
  bulkUpdateSignalThreads,
  listSignalTags,
  patchSignalThread,
} from '../../lib/signals-api'
import type { NavRow } from '../../lib/signals-api'
import { fileTicket } from '../../lib/tickets-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { HashtagMark } from '../ui/HashtagMark'
import { TagPill } from '../ui/TagPill'
import { Tip } from '../ui/Tip'
import { SidebarFolder } from './QueueSublist'
import { RailEyeButton } from './RailEditButtons'
import { useHideSidebarRow } from '../../hooks/useHideSidebarRow'
import { applyOrder, flowItemId, folderItemId, tagItemId } from '../../lib/sidebar-catalog'
import { NavSectionSkeleton } from '../ui/skeleton'
import { type HubLeaf, type SubQueue } from '../../lib/messages-paths'

function useFileThreadsOntoRail() {
  const { token } = useAuth()
  const { t } = useTranslation('nav')

  const fileThreadsIntoFolder = useCallback(
    async (threadIds: string[], projectId: string, folderLabel: string) => {
      if (!token || !threadIds.length) return
      try {
        if (threadIds.length === 1) {
          await patchSignalThread(token, threadIds[0]!, { projectId })
        } else {
          await bulkUpdateSignalThreads(token, threadIds, 'file', undefined, projectId)
        }
        toast.success(
          t('support.folders.filedToast', {
            defaultValue: 'Filed in {{name}}',
            name: folderLabel,
          }),
        )
      } catch (err) {
        toast.error(
          formatApiErrorMessage(
            err,
            t('support.folders.fileError', { defaultValue: 'Could not file conversation' }),
          ),
        )
      }
    },
    [token, t],
  )

  const fileThreadsIntoFlow = useCallback(
    async (threadIds: string[], tagId: string, flowLabel: string) => {
      if (!token || !threadIds.length || !tagId) return
      try {
        await Promise.all(threadIds.map((id) => fileTicket(id, tagId)))
        toast.success(
          t('support.flows.filedToast', {
            defaultValue: 'Filed on {{name}}',
            name: flowLabel,
          }),
        )
      } catch (err) {
        toast.error(
          formatApiErrorMessage(
            err,
            t('support.flows.fileError', { defaultValue: 'Could not file on flow' }),
          ),
        )
      }
    },
    [token, t],
  )

  return { fileThreadsIntoFolder, fileThreadsIntoFlow }
}

const FolderIcon = ENTITY_ICONS.project

type TFn = (key: string, opts?: { defaultValue?: string }) => string

function folderRef(row: NavRow): string {
  if (row.virtual && row.projectId && row.tagId) return pathPinRef(row.projectId, row.tagId)
  return folderPinRef(row.id)
}

function projectTreeHas(rows: NavRow[], id: string): boolean {
  return rows.some((row) => row.id === id || projectTreeHas(row.children ?? [], id))
}

function projectScopeKeys(row: NavRow): string[] {
  return [`project:${row.id}`, ...(row.children ?? []).flatMap(projectScopeKeys)]
}

function folderTagNames(row: NavRow, nameById: Map<string, string>): string[] {
  if (row.tag_names?.length) return row.tag_names.map((n) => n.replace(/^#/, ''))
  if (row.tag_ids?.length) {
    return row.tag_ids.map((id) => nameById.get(id)).filter(Boolean) as string[]
  }
  return []
}

function folderTooltip(
  row: NavRow,
  nameById: Map<string, string>,
  parentTagNames?: string[] | null,
  underPrefix = 'Under',
): string | undefined {
  const names = folderTagNames(row, nameById)
  if (!names.length) return undefined
  const set = filtersetPlainLabel(names)
  if (!parentTagNames?.length) return set
  return `${set} · ${underPrefix}: ${filtersetPlainLabel(parentTagNames)}`
}

function folderRowLabel(row: NavRow, nameById: Map<string, string>, parentTagNames?: string[] | null): string {
  const named = (row.name ?? '').replace(/^#/, '').trim()
  if (named) return named
  const names = folderTagNames(row, nameById)
  if (names.length) return filtersetPlainLabel(filtersetLocalNames(names, parentTagNames))
  return named || 'Folder'
}

function rowVisible(
  row: NavRow,
  opts: {
    hideEmpty: boolean
    isPinned: (ref: string) => boolean
    activeProjectId?: string
    pathIds: Set<string>
  },
): boolean {
  if (!opts.hideEmpty) return true
  if (row.count > 0) return true
  if (opts.pathIds.has(row.id)) return true
  if (row.projectId && opts.pathIds.has(row.projectId)) return true
  if (opts.activeProjectId && (row.id === opts.activeProjectId || row.projectId === opts.activeProjectId)) {
    return true
  }
  if (opts.isPinned(folderRef(row))) return true
  return false
}

function PinButton({
  pinned,
  onClick,
  label,
}: {
  pinned: boolean
  onClick: () => void
  label: string
}) {
  return (
    <Tip label={label}>
      <Pressable
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onClick()
        }}
        className={`inline-flex h-4 w-4 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text-heading ${pinned ? 'text-accent' : ''}`}
        aria-pressed={pinned}
        aria-label={label}
      >
        <Pin size={14} />
      </Pressable>
    </Tip>
  )
}

function CommunicationFolderRow({
  row,
  ancestors,
  activeLeaf,
  defaultQueueFor,
  t,
  nameById,
  hideEmpty,
  isPinned,
  pathIds,
  parentTagNames,
}: {
  row: NavRow
  ancestors: string[]
  activeLeaf: HubLeaf | null
  defaultQueueFor: (leaf: HubLeaf) => SubQueue
  t: TFn
  nameById: Map<string, string>
  hideEmpty: boolean
  isPinned: (ref: string) => boolean
  pathIds: Set<string>
  parentTagNames?: string[] | null
}) {
  const { toggleRailPin } = useSidebarPrefs()
  const { hideItem } = useHideSidebarRow()
  const children = (row.children ?? []).filter((child) =>
    rowVisible(child, { hideEmpty, isPinned, activeProjectId: activeLeaf?.type === 'project' ? activeLeaf.projectId : undefined, pathIds }),
  )
  const visible = rowVisible(row, {
    hideEmpty,
    isPinned,
    activeProjectId: activeLeaf?.type === 'project' ? activeLeaf.projectId : undefined,
    pathIds,
  })
  if (!visible) return null

  const leaf: HubLeaf = { type: 'project', projectId: row.projectId ?? row.id }
  const ref = folderRef(row)
  const pinned = isPinned(ref)
  const tip = folderTooltip(
    row,
    nameById,
    parentTagNames,
    t('support.folders.under', { defaultValue: 'Under' }),
  )
  const label = folderRowLabel(row, nameById, parentTagNames)
  const ownTags = folderTagNames(row, nameById)
  const { fileThreadsIntoFolder } = useFileThreadsOntoRail()

  return (
    <SidebarFolder
      baseLeaf={leaf}
      label={label}
      icon={<FolderIcon size={12} className="text-text-muted" aria-hidden />}
      activeLeaf={activeLeaf}
      defaultQueue="open"
      headerQueue={null}
      queues={[]}
      badgeCount={row.count}
      retainOnExpand={ancestors}
      closeOnCollapse={children.flatMap(projectScopeKeys)}
      onFileThreads={(ids) =>
        fileThreadsIntoFolder(ids, row.projectId ?? row.id, label)
      }
      headerAction={
        <>
          <RailEyeButton label={t('support.customize.hide')} onClick={() => hideItem(folderItemId(row.id), label)} />
          <PinButton
            pinned={pinned}
            onClick={() => toggleRailPin(ref)}
            label={
              pinned
                ? t('support.folders.unpin', { defaultValue: 'Unpin from rail' })
                : t('support.folders.pin', { defaultValue: 'Pin in rail' })
            }
          />
        </>
      }
      title={tip}
      leading={
        children.length > 0
          ? children.map((child) => (
              <CommunicationFolderRow
                key={child.id}
                row={child}
                ancestors={[...ancestors, `project:${row.id}`]}
                activeLeaf={activeLeaf}
                defaultQueueFor={defaultQueueFor}
                t={t}
                nameById={nameById}
                hideEmpty={hideEmpty}
                isPinned={isPinned}
                pathIds={pathIds}
                parentTagNames={ownTags}
              />
            ))
          : null
      }
    />
  )
}

function CommunicationTagRow({
  row,
  category,
  activeLeaf,
  t,
}: {
  row: NavRow
  category?: boolean
  activeLeaf: HubLeaf | null
  t: TFn
}) {
  const { isPinned, toggleRailPin, prefs } = useSidebarPrefs()
  const { hideItem } = useHideSidebarRow()
  const { fileThreadsIntoFlow } = useFileThreadsOntoRail()
  const leaf: HubLeaf = { type: 'tag', tag: row.name }
  const ref = tagPinRef(row.name)
  const pinned = isPinned(ref)
  const bare = row.name.replace(/^#/, '')
  const itemId = category ? flowItemId(row.id) : tagItemId(row.id)
  if (prefs.hiddenItems.includes(itemId)) return null
  return (
    <SidebarFolder
      baseLeaf={leaf}
      label={bare}
      labelNode={category ? <TagPill names={bare} tone="action" size="sm" /> : undefined}
      icon={category ? undefined : <HashtagMark />}
      activeLeaf={activeLeaf}
      defaultQueue="open"
      headerQueue={null}
      queues={[]}
      badgeCount={row.count}
      onFileThreads={
        category ? (ids) => fileThreadsIntoFlow(ids, row.id, bare) : undefined
      }
      headerAction={
        <>
          <RailEyeButton label={t('support.customize.hide')} onClick={() => hideItem(itemId, bare)} />
          <PinButton
            pinned={pinned}
            onClick={() => toggleRailPin(ref)}
            label={
              pinned
                ? t('support.folders.unpin', { defaultValue: 'Unpin from rail' })
                : t('support.folders.pin', { defaultValue: 'Pin in rail' })
            }
          />
        </>
      }
    />
  )
}

/** Action-tag / flow rows for the Communication Flows section. */
export function CommunicationFlowsTree({
  ticketTags,
  loading,
  activeLeaf,
  t,
}: {
  ticketTags: NavRow[]
  loading: boolean
  activeLeaf: HubLeaf | null
  t: TFn
}) {
  const extra =
    activeLeaf?.type === 'tag' && !ticketTags.some((row) => row.name === activeLeaf.tag)
      ? [{ id: activeLeaf.tag, name: activeLeaf.tag, count: 0 }]
      : []
  const rows = [...ticketTags, ...extra]
  return (
    <div className="space-y-px" data-testid="communication-flows-tree">
      {loading ? <NavSectionSkeleton rows={2} /> : null}
      {!loading && rows.length === 0 ? (
        <Link to="/flows" className="nav-row border border-dashed border-border text-xs">
          <Plus aria-hidden />
          <span className="min-w-0 flex-1 truncate-fade">
            {t('support.flows.empty', { defaultValue: 'Create a flow from an action tag' })}
          </span>
        </Link>
      ) : null}
      {rows.map((row) => (
        <CommunicationTagRow
          key={`flow-${row.id}`}
          row={row}
          category
          activeLeaf={activeLeaf}
          t={t}
        />
      ))}
    </div>
  )
}

function collectPathIds(rows: NavRow[], targetId: string, prefix: string[] = []): Set<string> {
  for (const row of rows) {
    const chain = [...prefix, row.id]
    if (row.id === targetId || row.projectId === targetId) return new Set(chain)
    const nested = collectPathIds(row.children ?? [], targetId, chain)
    if (nested.size) return nested
  }
  return new Set()
}

export function FolderTagTree({
  folders,
  tags,
  ticketTags,
  loading,
  activeLeaf,
  defaultQueueFor,
  t,
  mode = 'communication',
  selectedId,
  onSelect,
  hideEmpty = false,
}: {
  folders: NavRow[]
  tags: NavRow[]
  ticketTags: NavRow[]
  loading: boolean
  activeLeaf?: HubLeaf | null
  defaultQueueFor?: (leaf: HubLeaf) => SubQueue
  t: TFn
  mode?: 'communication' | 'agenda'
  selectedId?: string
  onSelect?: (kind: 'folder' | 'tag', id: string, name: string) => void
  hideEmpty?: boolean
}) {
  const { token } = useAuth()
  // Agenda mounts this tree outside SidebarPrefsProvider; pins are Communication-only.
  const sidebarPrefs = useOptionalSidebarPrefs()
  const isPinned = sidebarPrefs?.isPinned ?? (() => false)
  const [nameById, setNameById] = useState<Map<string, string>>(() => new Map())

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void listSignalTags(token)
      .then((rows) => {
        if (cancelled) return
        setNameById(new Map(rows.map((row) => [row.id, row.name])))
      })
      .catch(() => {
        if (!cancelled) setNameById(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const pathIds = useMemo(() => {
    if (activeLeaf?.type !== 'project') return new Set<string>()
    return collectPathIds(folders, activeLeaf.projectId)
  }, [activeLeaf, folders])

  const extraFolder =
    activeLeaf?.type === 'project' && !projectTreeHas(folders, activeLeaf.projectId)
      ? [{ id: activeLeaf.projectId, name: activeLeaf.projectId.slice(0, 8), count: 0 }]
      : []
  // Communication: only pinned free tags live under Mappen (flows have their own section).
  const pinnedFreeTags = applyOrder(
    tags.filter((row) => isPinned(tagPinRef(row.name))),
    'folders:tags',
    (row) => tagItemId(row.id),
    sidebarPrefs?.prefs ?? { itemOrder: {}, hiddenItems: [] },
  )
  const activeTagName = activeLeaf?.type === 'tag' ? activeLeaf.tag : null
  const extraPinnedTag =
    mode === 'communication' &&
    activeTagName &&
    !pinnedFreeTags.some((row) => row.name === activeTagName) &&
    !ticketTags.some((row) => row.name === activeTagName) &&
    isPinned(tagPinRef(activeTagName))
      ? [{ id: activeTagName, name: activeTagName, count: 0 }]
      : []

  const visibleFolders = useMemo(() => {
    const list = [...folders, ...extraFolder]
    if (!hideEmpty) return list
    return list.filter((row) =>
      rowVisible(row, {
        hideEmpty,
        isPinned,
        activeProjectId: activeLeaf?.type === 'project' ? activeLeaf.projectId : undefined,
        pathIds,
      }),
    )
  }, [activeLeaf, extraFolder, folders, hideEmpty, isPinned, pathIds])

  if (mode === 'agenda') {
    const clickFolder = (row: NavRow) => onSelect?.('folder', row.virtual ? row.projectId || row.id : row.id, row.name)
    const clickTag = (row: NavRow) => onSelect?.('tag', row.id, row.name)
    const agendaExtraTag =
      activeLeaf?.type === 'tag' &&
      !ticketTags.some((row) => row.name === activeLeaf.tag) &&
      !tags.some((row) => row.name === activeLeaf.tag)
        ? [{ id: activeLeaf.tag, name: activeLeaf.tag, count: 0 }]
        : []
    return (
      <div className="space-y-px" data-testid="folder-tag-tree">
        {loading ? <NavSectionSkeleton rows={4} /> : null}
        {[...folders, ...extraFolder].map((row) => (
          <AgendaFolderRow key={row.id} row={row} selectedId={selectedId} onSelect={clickFolder} nameById={nameById} />
        ))}
        {[...tags, ...ticketTags, ...agendaExtraTag].map((row) => (
          <Pressable
            key={`tag-${row.id}`}
            type="button"
            onClick={() => clickTag(row)}
            data-active={selectedId === row.name || selectedId === row.id ? 'true' : undefined}
            className="nav-row h-7 w-full text-left text-xs"
          >
            <HashtagMark className="text-xs" />
            <span className="min-w-0 flex-1 truncate-fade">{row.name.replace(/^#/, '')}</span>
          </Pressable>
        ))}
      </div>
    )
  }

  if (!defaultQueueFor || activeLeaf === undefined) return null

  return (
    <div className="space-y-px" data-testid="folder-tag-tree">
      {loading ? <NavSectionSkeleton rows={2} /> : null}
      {visibleFolders.map((row) => (
        <CommunicationFolderRow
          key={row.id}
          row={row}
          ancestors={[]}
          activeLeaf={activeLeaf}
          defaultQueueFor={defaultQueueFor}
          t={t}
          nameById={nameById}
          hideEmpty={hideEmpty}
          isPinned={isPinned}
          pathIds={pathIds}
        />
      ))}
      {[...pinnedFreeTags, ...extraPinnedTag].map((row) => (
        <CommunicationTagRow
          key={`tag-${row.id}`}
          row={row}
          activeLeaf={activeLeaf}
          t={t}
        />
      ))}
    </div>
  )
}

function AgendaFolderRow({
  row,
  selectedId,
  onSelect,
  nameById,
  parentTagNames,
}: {
  row: NavRow
  selectedId?: string
  onSelect: (row: NavRow) => void
  nameById: Map<string, string>
  parentTagNames?: string[] | null
}) {
  const children = row.children ?? []
  const tip = folderTooltip(row, nameById, parentTagNames)
  const label = folderRowLabel(row, nameById, parentTagNames)
  const ownTags = folderTagNames(row, nameById)
  return (
    <div className="space-y-px">
      <Pressable
        type="button"
        onClick={() => onSelect(row)}
        data-active={selectedId === row.id ? 'true' : undefined}
        title={tip}
        className="nav-row h-7 w-full text-left text-xs"
      >
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-text-muted" aria-hidden>
          <FolderIcon size={12} />
        </span>
        <span className="min-w-0 flex-1 truncate-fade">{label}</span>
      </Pressable>
      {children.length > 0 ? (
        <div className="nav-tree-children">
          {children.map((child) => (
            <AgendaFolderRow
              key={child.id}
              row={child}
              selectedId={selectedId}
              onSelect={onSelect}
              nameById={nameById}
              parentTagNames={ownTags}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
