import { Link } from 'react-router-dom'
import { Folder, Folders, Pin, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { folderPinRef, pathPinRef, tagPinRef, useSidebarPrefs } from '../../context/SidebarPrefsContext'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { pinVirtualChild } from '../../lib/projects-api'
import type { NavRow } from '../../lib/signals-api'
import { HashtagMark } from '../ui/HashtagMark'
import { Tip } from '../ui/Tip'
import { SidebarFolder } from './QueueSublist'
import { NavSectionSkeleton } from '../ui/skeleton'
import type { HubLeaf, SubQueue } from '../../lib/messages-paths'

const FolderKanban = ENTITY_ICONS.folder ?? ENTITY_ICONS.project
const Workflow = ENTITY_ICONS.flow

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
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onClick()
        }}
        className={`inline-flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text-heading ${pinned ? 'text-accent' : ''}`}
        aria-pressed={pinned}
        aria-label={label}
      >
        <Pin size={11} />
      </button>
    </Tip>
  )
}

function CommunicationFolderRow({
  row,
  ancestors,
  activeLeaf,
  defaultQueueFor,
  t,
}: {
  row: NavRow
  ancestors: string[]
  activeLeaf: HubLeaf | null
  defaultQueueFor: (leaf: HubLeaf) => SubQueue
  t: TFn
}) {
  const { token } = useAuth()
  const { isPinned, toggleRailPin } = useSidebarPrefs()
  const children = row.children ?? []
  const leaf: HubLeaf = { type: 'project', projectId: row.id }
  const ref = folderRef(row)
  const pinned = isPinned(ref)

  const pinChild = async () => {
    if (!token || !row.virtual || !row.projectId || !row.tagId) return
    try {
      await pinVirtualChild(row.projectId, row.tagId)
      toast.success(t('support.folders.pinnedChild', { defaultValue: 'Folder pinned' }))
    } catch {
      toast.error(t('support.folders.pinChildFailed', { defaultValue: 'Could not pin this folder.' }))
    }
  }

  return (
    <SidebarFolder
      baseLeaf={leaf}
      label={row.virtual ? `#${row.name}` : row.name}
      icon={
        row.virtual ? (
          <HashtagMark className="w-3.5 shrink-0 text-center text-sm" />
        ) : row.groupId || children.some((child) => child.virtual) ? (
          <Folders size={14} className="shrink-0 text-text-muted" aria-hidden />
        ) : (
          <FolderKanban size={14} className="shrink-0 text-text-muted" aria-hidden />
        )
      }
      activeLeaf={activeLeaf}
      defaultQueue={defaultQueueFor(leaf)}
      badgeCount={row.count}
      retainOnExpand={ancestors}
      closeOnCollapse={children.flatMap(projectScopeKeys)}
      headerAction={
        <span className="inline-flex items-center gap-0.5">
          {row.virtual && row.projectId && row.tagId ? (
            <Tip label={t('support.folders.pinChild', { defaultValue: 'Pin as folder' })}>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void pinChild()
                }}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text-heading"
                aria-label={t('support.folders.pinChild', { defaultValue: 'Pin as folder' })}
              >
                <Folder size={11} />
              </button>
            </Tip>
          ) : null}
          <PinButton
            pinned={pinned}
            onClick={() => toggleRailPin(ref)}
            label={pinned ? t('support.folders.unpin', { defaultValue: 'Unpin from rail' }) : t('support.folders.pin', { defaultValue: 'Pin in rail' })}
          />
        </span>
      }
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
  defaultQueueFor,
  t,
}: {
  row: NavRow
  category?: boolean
  activeLeaf: HubLeaf | null
  defaultQueueFor: (leaf: HubLeaf) => SubQueue
  t: TFn
}) {
  const { isPinned, toggleRailPin } = useSidebarPrefs()
  const leaf: HubLeaf = { type: 'tag', tag: row.name }
  const ref = tagPinRef(row.name)
  const pinned = isPinned(ref)
  return (
    <SidebarFolder
      baseLeaf={leaf}
      label={row.name}
      icon={
        category ? (
          <span className="inline-flex items-center gap-0.5">
            <HashtagMark category className="w-3.5 shrink-0 text-center text-sm" />
            <Workflow size={10} className="text-text-muted" aria-hidden />
          </span>
        ) : (
          <HashtagMark className="w-3.5 shrink-0 text-center text-sm" />
        )
      }
      activeLeaf={activeLeaf}
      defaultQueue={defaultQueueFor(leaf)}
      badgeCount={row.count}
      headerAction={
        <PinButton
          pinned={pinned}
          onClick={() => toggleRailPin(ref)}
          label={pinned ? t('support.folders.unpin', { defaultValue: 'Unpin from rail' }) : t('support.folders.pin', { defaultValue: 'Pin in rail' })}
        />
      }
    />
  )
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
}) {
  const extraFolder =
    activeLeaf?.type === 'project' && !projectTreeHas(folders, activeLeaf.projectId)
      ? [{ id: activeLeaf.projectId, name: activeLeaf.projectId.slice(0, 8), count: 0 }]
      : []
  const extraTag =
    activeLeaf?.type === 'tag' &&
    !ticketTags.some((row) => row.name === activeLeaf.tag) &&
    !tags.some((row) => row.name === activeLeaf.tag)
      ? [{ id: activeLeaf.tag, name: activeLeaf.tag, count: 0 }]
      : []
  const empty = !loading && folders.length === 0 && ticketTags.length === 0 && tags.length === 0

  if (mode === 'agenda') {
    const clickFolder = (row: NavRow) => onSelect?.('folder', row.virtual ? row.projectId || row.id : row.id, row.name)
    const clickTag = (row: NavRow) => onSelect?.('tag', row.id, row.name)
    return (
      <div className="space-y-0.5" data-testid="folder-tag-tree">
        {loading ? <NavSectionSkeleton rows={2} /> : null}
        {empty ? <p className="px-1 text-xs text-text-muted">{t('support.folders.empty', { defaultValue: 'Create a folder or pin a tag' })}</p> : null}
        {[...folders, ...extraFolder].map((row) => (
          <AgendaFolderRow key={row.id} row={row} selectedId={selectedId} onSelect={clickFolder} />
        ))}
        {[...ticketTags, ...tags, ...extraTag].map((row) => (
          <button
            key={`tag-${row.id}`}
            type="button"
            onClick={() => clickTag(row)}
            data-active={selectedId === row.name || selectedId === row.id ? 'true' : undefined}
            className="nav-row h-7 w-full text-left text-xs"
          >
            <HashtagMark className="w-3.5 shrink-0 text-center text-sm" />
            <span className="min-w-0 flex-1 truncate-fade">#{row.name}</span>
          </button>
        ))}
      </div>
    )
  }

  if (!defaultQueueFor || activeLeaf === undefined) return null
  return (
    <div className="space-y-0.5" data-testid="folder-tag-tree">
      {loading ? <NavSectionSkeleton rows={2} /> : null}
      {empty ? (
        <Link to="/folders" className="nav-row border border-dashed border-border/80 text-xs">
          <Plus aria-hidden />
          <span className="min-w-0 flex-1 truncate-fade">{t('support.folders.empty', { defaultValue: 'Create a folder or pin a tag' })}</span>
        </Link>
      ) : null}
      {[...folders, ...extraFolder].map((row) => (
        <CommunicationFolderRow
          key={row.id}
          row={row}
          ancestors={[]}
          activeLeaf={activeLeaf}
          defaultQueueFor={defaultQueueFor}
          t={t}
        />
      ))}
      {ticketTags.map((row) => (
        <CommunicationTagRow
          key={`cat-${row.id}`}
          row={row}
          category
          activeLeaf={activeLeaf}
          defaultQueueFor={defaultQueueFor}
          t={t}
        />
      ))}
      {[...tags, ...extraTag].map((row) => (
        <CommunicationTagRow
          key={`tag-${row.id}`}
          row={row}
          activeLeaf={activeLeaf}
          defaultQueueFor={defaultQueueFor}
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
}: {
  row: NavRow
  selectedId?: string
  onSelect: (row: NavRow) => void
}) {
  const children = row.children ?? []
  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(row)}
        data-active={selectedId === row.id ? 'true' : undefined}
        className="nav-row h-7 w-full text-left text-xs"
      >
        {row.virtual ? (
          <HashtagMark className="w-3.5 shrink-0 text-center text-sm" />
        ) : (
          <Folder size={13} className="shrink-0 text-text-muted" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate-fade">{row.virtual ? `#${row.name}` : row.name}</span>
      </button>
      {children.length > 0 ? (
        <div className="ml-[15px] space-y-px border-l border-border/70 pl-2">
          {children.map((child) => (
            <AgendaFolderRow key={child.id} row={child} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
