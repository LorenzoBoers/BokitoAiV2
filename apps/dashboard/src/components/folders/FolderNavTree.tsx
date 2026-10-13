import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  defaultAnimateLayoutChanges,
  useSortable,
  verticalListSortingStrategy,
  type AnimateLayoutChanges,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronRight, CornerDownRight } from 'lucide-react'
import { toast } from 'sonner'
import {
  deriveFolderTree,
  filtersetLabel,
  filtersetLocalNames,
  filtersetPlainLabel,
  folderFilterSiblings,
  previewNestMerge,
  type FolderFilterNode,
  type FolderFilterSource,
} from '../../lib/folder-filter-tree'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { useConfirm } from '../ui/confirm-dialog'
import { HashtagMark } from '../ui/HashtagMark'
import { TagPill } from '../ui/TagPill'
import {
  clearFolderMoveUndo,
  hasFolderMoveUndo,
  isEditableKeyboardTarget,
  runFolderMoveUndo,
  setFolderMoveUndo,
  takeFolderMoveUndoToastId,
} from '../../lib/folder-move-undo'
import { nestFolder, patchProject } from '../../lib/projects-api'
import { cn } from '../../lib/utils'

export type FolderNavSource = FolderFilterSource & {
  open_count?: number
}

const UNDO_TOAST_MS = 12_000

/** Skip post-drop layout tween — order is already optimistic in React state. */
const animateLayoutChanges: AnimateLayoutChanges = (args) =>
  args.isSorting || args.wasDragging ? false : defaultAnimateLayoutChanges(args)

function bareTag(name: string): string {
  return name.replace(/^#/, '').trim()
}

function applySiblingOrder(sources: FolderNavSource[], siblingIds: string[]): FolderNavSource[] {
  const order = new Map(siblingIds.map((id, index) => [id, index]))
  let changed = false
  const next = sources.map((source) => {
    const sortOrder = order.get(source.id)
    if (sortOrder == null || source.sort_order === sortOrder) return source
    changed = true
    return { ...source, sort_order: sortOrder }
  })
  return changed ? next : sources
}

/** Reorder same-parent siblings in a flat source list; returns null if unchanged. */
function reorderSiblingSources(
  sources: FolderNavSource[],
  activeId: string,
  overId: string,
): { sources: FolderNavSource[]; siblingIds: string[] } | null {
  if (activeId === overId) return null
  const tree = deriveFolderTree(sources)
  const activeSiblings = folderFilterSiblings(tree, activeId)
  const overSiblings = folderFilterSiblings(tree, overId)
  if (
    !activeSiblings ||
    !overSiblings ||
    activeSiblings.parentId !== overSiblings.parentId ||
    !activeSiblings.siblings.some((sibling) => sibling.id === overId)
  ) {
    return null
  }
  const ids = activeSiblings.siblings.map((sibling) => sibling.id)
  const oldIndex = ids.indexOf(activeId)
  const newIndex = ids.indexOf(overId)
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return null
  const siblingIds = arrayMove(ids, oldIndex, newIndex)
  return { sources: applySiblingOrder(sources, siblingIds), siblingIds }
}

/** Merge parent tags into the child so `deriveFolderTree` nests it immediately. */
function optimisticNestSources(
  sources: FolderNavSource[],
  activeId: string,
  parentId: string,
): FolderNavSource[] | null {
  const parent = sources.find((source) => source.id === parentId)
  const child = sources.find((source) => source.id === activeId)
  if (!parent || !child) return null
  const parentNames = (parent.tag_names ?? []).map(bareTag).filter(Boolean)
  const childNames = (child.tag_names ?? []).map(bareTag).filter(Boolean)
  const parentNameSet = new Set(parentNames.map((name) => name.toLowerCase()))
  const mergedNames = [
    ...parentNames,
    ...childNames.filter((name) => !parentNameSet.has(name.toLowerCase())),
  ]
  const parentIds = parent.tag_ids ?? []
  const childIds = child.tag_ids ?? []
  const parentIdSet = new Set(parentIds)
  const mergedIds = [...parentIds, ...childIds.filter((id) => !parentIdSet.has(id))]
  if (
    mergedNames.length === childNames.length &&
    mergedNames.every((name, index) => name.toLowerCase() === (childNames[index] ?? '').toLowerCase())
  ) {
    return null
  }
  return sources.map((source) =>
    source.id === activeId
      ? {
          ...source,
          tag_ids: mergedIds.length ? mergedIds : source.tag_ids,
          tag_names: mergedNames,
          name: filtersetPlainLabel(mergedNames) || source.name,
        }
      : source,
  )
}

const NEST_PREFIX = 'nest:'

function nestDropId(folderId: string): string {
  return `${NEST_PREFIX}${folderId}`
}

function parseNestDropId(id: UniqueIdentifier | null | undefined): string | null {
  const raw = id == null ? '' : String(id)
  return raw.startsWith(NEST_PREFIX) ? raw.slice(NEST_PREFIX.length) : null
}

function findNode(nodes: FolderFilterNode[], id: string): FolderFilterNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const nested = findNode(node.children, id)
    if (nested) return nested
  }
  return null
}

function collectIds(node: FolderFilterNode, into: Set<string>) {
  into.add(node.id)
  for (const child of node.children) collectIds(child, into)
}

/** Active folder + everything under it — illegal nest-into targets. */
function blockedNestTargets(tree: FolderFilterNode[], activeId: string | null): Set<string> {
  const blocked = new Set<string>()
  if (!activeId) return blocked
  const active = findNode(tree, activeId)
  if (active) collectIds(active, blocked)
  else blocked.add(activeId)
  return blocked
}

function labelFor(node: FolderFilterNode, parentTagNames?: string[] | null): string {
  if (node.tag_names.length) {
    return filtersetPlainLabel(filtersetLocalNames(node.tag_names, parentTagNames))
  }
  return node.name.replace(/^#/, '')
}

/** Prefer the right-side nest zone when the pointer is in it; else reorder. */
const folderCollision: CollisionDetection = (args) => {
  const nestContainers = args.droppableContainers.filter((container) =>
    String(container.id).startsWith(NEST_PREFIX),
  )
  const nestHits = pointerWithin({ ...args, droppableContainers: nestContainers })
  if (nestHits.length > 0) return nestHits
  const reorderContainers = args.droppableContainers.filter(
    (container) => !String(container.id).startsWith(NEST_PREFIX),
  )
  return closestCenter({ ...args, droppableContainers: reorderContainers })
}

/**
 * Shared folder tree chrome: typographic `#` labels, optional whole-row
 * drag (no grip). Used on /folders; rail surfaces reuse the same row look.
 *
 * Drag: drop on a row to reorder among siblings; drop on the right nest
 * zone to make it a subfolder of that map.
 */
export function FolderNavTree({
  sources,
  open,
  onToggle,
  activeId,
  enableDrag = false,
  onChanged,
  className,
  linkTo,
  empty,
}: {
  sources: FolderNavSource[]
  open: Set<string>
  onToggle: (id: string) => void
  activeId?: string | null
  enableDrag?: boolean
  onChanged?: () => void
  className?: string
  linkTo?: (id: string) => string
  empty?: ReactNode
}) {
  const { t } = useTranslation('nav')
  const confirm = useConfirm()
  // Optimistic tree order — updates while dragging so drop does not snap back.
  const [localSources, setLocalSources] = useState(sources)
  const localSourcesRef = useRef(sources)
  const draggingRef = useRef(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [nestOverId, setNestOverId] = useState<string | null>(null)

  useEffect(() => {
    if (draggingRef.current) return
    localSourcesRef.current = sources
    setLocalSources(sources)
  }, [sources])

  const tree = useMemo(() => deriveFolderTree(localSources), [localSources])
  const nestBlocked = useMemo(() => blockedNestTargets(tree, draggingId), [tree, draggingId])
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Whole-row drag: small move before grab so clicks still navigate.
      activationConstraint: { distance: 6 },
    }),
  )

  const href = linkTo ?? ((id: string) => `/folders/${id}`)

  const setSourcesOptimistic = (next: FolderNavSource[]) => {
    localSourcesRef.current = next
    setLocalSources(next)
  }

  const clearDrag = () => {
    draggingRef.current = false
    setDraggingId(null)
    setNestOverId(null)
  }

  const offerUndo = (label: string, run: () => Promise<void>) => {
    const undoLabel = t('projects.detail.undoMove', { defaultValue: 'Undo' })
    const executeUndo = async () => {
      try {
        const ran = await runFolderMoveUndo()
        if (ran) {
          toast.success(t('projects.detail.undoDone', { defaultValue: 'Move undone' }))
        }
      } catch (err) {
        toast.error(formatApiErrorMessage(err, t('projects.detail.saveError')))
      }
    }
    const id = toast.success(label, {
      duration: UNDO_TOAST_MS,
      action: {
        label: undoLabel,
        onClick: () => {
          void executeUndo()
        },
      },
    })
    setFolderMoveUndo({ label, run }, id)
  }

  useEffect(() => {
    if (!enableDrag) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      if (event.key !== 'z' && event.key !== 'Z') return
      if (isEditableKeyboardTarget(event.target)) return
      if (!hasFolderMoveUndo()) return
      event.preventDefault()
      const toastId = takeFolderMoveUndoToastId()
      if (toastId != null) toast.dismiss(toastId)
      void (async () => {
        try {
          const ran = await runFolderMoveUndo()
          if (ran) {
            toast.success(t('projects.detail.undoDone', { defaultValue: 'Move undone' }))
          }
        } catch (err) {
          toast.error(formatApiErrorMessage(err, t('projects.detail.saveError')))
        }
      })()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enableDrag, onChanged, t])

  useEffect(() => () => clearFolderMoveUndo(), [])

  const persistSiblingOrder = async (siblingIds: string[], snapshot: FolderNavSource[]) => {
    const previousOrders = siblingIds.map((id) => {
      const row = snapshot.find((source) => source.id === id)
      return { id, sort_order: row?.sort_order ?? 0 }
    })
    try {
      await Promise.all(siblingIds.map((id, index) => patchProject(id, { sort_order: index })))
      offerUndo(t('projects.detail.reordered', { defaultValue: 'Folder order updated' }), async () => {
        await Promise.all(previousOrders.map((row) => patchProject(row.id, { sort_order: row.sort_order })))
        onChanged?.()
      })
      onChanged?.()
    } catch (err) {
      setSourcesOptimistic(snapshot)
      toast.error(formatApiErrorMessage(err, t('projects.detail.saveError')))
    }
  }

  const onDragStart = (event: DragStartEvent) => {
    draggingRef.current = true
    setDraggingId(String(event.active.id))
    setNestOverId(null)
  }

  const onDragOver = (event: DragOverEvent) => {
    const nestId = parseNestDropId(event.over?.id)
    if (nestId && !nestBlocked.has(nestId)) {
      setNestOverId(nestId)
      return
    }
    setNestOverId(null)

    const overRaw = event.over ? String(event.over.id) : null
    if (!overRaw || parseNestDropId(overRaw)) return
    const activeId = String(event.active.id)
    // While over a nest-eligible non-sibling, preview nest highlight on the row.
    const treeNow = deriveFolderTree(localSourcesRef.current)
    const activeSibs = folderFilterSiblings(treeNow, activeId)
    const overSibs = folderFilterSiblings(treeNow, overRaw)
    if (
      overSibs &&
      activeSibs &&
      overSibs.parentId !== activeSibs.parentId &&
      !nestBlocked.has(overRaw)
    ) {
      setNestOverId(overRaw)
      return
    }
    const moved = reorderSiblingSources(localSourcesRef.current, activeId, overRaw)
    if (moved) setSourcesOptimistic(moved.sources)
  }

  const runNest = async (activeId: string, parentId: string, blocked: Set<string>) => {
    if (blocked.has(parentId) || activeId === parentId) return
    const before = localSourcesRef.current.find((source) => source.id === activeId)
    const parent = localSourcesRef.current.find((source) => source.id === parentId)
    if (!before || !parent) return
    const previousTags = (before.tag_names ?? []).map(bareTag).filter(Boolean)
    const parentTags = (parent.tag_names ?? []).map(bareTag).filter(Boolean)
    const preview = previewNestMerge(previousTags, parentTags)

    // Confirm when nest adds tags — especially unrelated sets.
    if (preview.addedNames.length > 0) {
      const description = preview.unrelated
        ? t('projects.detail.nestConfirmUnrelated', {
            defaultValue:
              'These maps shared no tags. After nesting, matching conversations must also carry {{parent}}. Result: {{merged}} — sits under {{parent}}.',
            parent: preview.parentLabel,
            merged: preview.mergedLabel,
          })
        : t('projects.detail.nestConfirmBody', {
            defaultValue:
              'Becomes {{merged}} and sits under {{parent}}. Nesting adds the broader map\'s tags to this filterset.',
            merged: preview.mergedLabel,
            parent: preview.parentLabel,
          })
      const ok = await confirm({
        title: t('projects.detail.nestConfirmTitle', {
          defaultValue: 'Nest under broader map?',
        }),
        description,
        confirmLabel: t('projects.detail.nestConfirm', { defaultValue: 'Nest' }),
        destructive: preview.unrelated,
      })
      if (!ok) return
    }

    const snapshot = localSourcesRef.current
    const optimistic = optimisticNestSources(snapshot, activeId, parentId)
    if (optimistic) setSourcesOptimistic(optimistic)
    if (!open.has(parentId)) onToggle(parentId)
    try {
      await nestFolder(activeId, parentId)
      offerUndo(
        t('projects.detail.nested', {
          defaultValue: 'Folder nested — it now requires the broader tags too.',
        }),
        async () => {
          if (!previousTags.length) return
          await patchProject(activeId, { tags: previousTags })
          onChanged?.()
        },
      )
      onChanged?.()
    } catch (err) {
      setSourcesOptimistic(snapshot)
      toast.error(formatApiErrorMessage(err, t('projects.detail.saveError')))
    }
  }

  const onDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id)
    const overRaw = event.over ? String(event.over.id) : null
    const nestParentId = parseNestDropId(overRaw) ?? (nestOverId && overRaw === nestOverId ? nestOverId : null)
    const blocked = blockedNestTargets(deriveFolderTree(localSourcesRef.current), activeId)
    const snapshot = sources

    if (!enableDrag || !overRaw) {
      clearDrag()
      return
    }

    if (nestParentId && !blocked.has(nestParentId)) {
      clearDrag()
      void runNest(activeId, nestParentId, blocked)
      return
    }

    const overId = overRaw
    // Finalise sibling order (dragOver usually already did this).
    const moved = reorderSiblingSources(localSourcesRef.current, activeId, overId)
    if (moved) {
      setSourcesOptimistic(moved.sources)
      clearDrag()
      void persistSiblingOrder(moved.siblingIds, snapshot)
      return
    }

    clearDrag()
    if (activeId === overId) return

    // Already in place from dragOver — still persist current sibling order.
    const treeNow = deriveFolderTree(localSourcesRef.current)
    const sibs = folderFilterSiblings(treeNow, activeId)
    if (sibs?.siblings.some((sibling) => sibling.id === overId)) {
      void persistSiblingOrder(
        sibs.siblings.map((sibling) => sibling.id),
        snapshot,
      )
      return
    }

    // Non-sibling row body (not the nest zone): still nest into that map.
    if (!findNode(treeNow, overId) || blocked.has(overId)) return
    void runNest(activeId, overId, blocked)
  }

  const draggingTagNames = useMemo(() => {
    if (!draggingId) return null
    const row = localSources.find((source) => source.id === draggingId)
    return (row?.tag_names ?? []).map(bareTag).filter(Boolean)
  }, [draggingId, localSources])

  if (tree.length === 0) {
    return <>{empty ?? null}</>
  }

  const rows = (
    <div className={cn('space-y-px', className)}>
      {tree.map((node) => (
        <FolderNavRow
          key={node.id}
          node={node}
          open={open}
          onToggle={onToggle}
          activeId={activeId}
          enableDrag={enableDrag}
          href={href}
          parentTagNames={null}
          draggingId={draggingId}
          draggingTagNames={draggingTagNames}
          nestOverId={nestOverId}
          nestBlocked={nestBlocked}
        />
      ))}
    </div>
  )
  const body = enableDrag ? (
    <SortableContext items={tree.map((node) => node.id)} strategy={verticalListSortingStrategy}>
      {rows}
    </SortableContext>
  ) : (
    rows
  )

  if (!enableDrag) return body

  const dragNode = draggingId ? findNode(tree, draggingId) : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={folderCollision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={(e) => void onDragEnd(e)}
      onDragCancel={() => {
        clearDrag()
        setSourcesOptimistic(sources)
      }}
    >
      {body}
      <DragOverlay dropAnimation={null}>
        {dragNode ? (
          <div className="pointer-events-none flex h-[26px] items-center gap-2 rounded-md border border-accent/35 bg-bg-surface/95 px-2 text-xs shadow-overlay backdrop-blur-sm">
            <FolderRowChrome node={dragNode} parentTagNames={null} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

/** Same chrome as Communication: `#` + plain truncate label. */
function FolderRowChrome({
  node,
  parentTagNames,
  trailing,
}: {
  node: FolderFilterNode
  parentTagNames?: string[] | null
  trailing?: ReactNode
}) {
  const label = labelFor(node, parentTagNames)
  return (
    <>
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-text-muted">
        <HashtagMark className="text-xs" />
      </span>
      <span className="min-w-0 flex-1 truncate-fade">{label}</span>
      {trailing}
    </>
  )
}

function FolderNavRow({
  node,
  open,
  onToggle,
  activeId,
  enableDrag,
  href,
  parentTagNames,
  draggingId,
  draggingTagNames,
  nestOverId,
  nestBlocked,
}: {
  node: FolderFilterNode
  open: Set<string>
  onToggle: (id: string) => void
  activeId?: string | null
  enableDrag: boolean
  href: (id: string) => string
  parentTagNames?: string[] | null
  draggingId: string | null
  draggingTagNames: string[] | null
  nestOverId: string | null
  nestBlocked: Set<string>
}) {
  const { t } = useTranslation('nav')
  const expanded = open.has(node.id)
  const hasChildren = node.children.length > 0
  const isActive = activeId === node.id
  const rowLabel = labelFor(node, parentTagNames)
  const fullSet = node.tag_names.length ? filtersetLabel(node.tag_names) : rowLabel
  const underLabel = parentTagNames?.length ? filtersetLabel(parentTagNames) : null
  const rowTitle = underLabel
    ? t('projects.detail.folderRowTooltip', {
        defaultValue: '{{set}} · Under: {{under}}',
        set: fullSet,
        under: underLabel,
      })
    : fullSet

  const sortable = useSortable({
    id: node.id,
    disabled: !enableDrag,
    animateLayoutChanges,
  })
  const showNestZone = Boolean(enableDrag && draggingId && !nestBlocked.has(node.id))
  const nestHighlight = nestOverId === node.id
  const nestPreview =
    showNestZone && draggingTagNames
      ? previewNestMerge(draggingTagNames, node.tag_names)
      : null

  const { setNodeRef: nestRef, isOver: nestIsOver } = useDroppable({
    id: nestDropId(node.id),
    disabled: !showNestZone,
  })

  const style: CSSProperties = enableDrag
    ? {
        transform: CSS.Transform.toString(sortable.transform),
        // No transition on the dragged row — overlay is the motion; others may ease aside.
        transition: sortable.isDragging ? undefined : sortable.transition,
      }
    : {}

  // Nest under the label column (past the chevron gutter) so children read as
  // a tree, not a flat list that lines up with the parent hashtag.
  const childList = (
    <div className="ml-2 space-y-px border-l border-border/40 pl-1">
      {node.children.map((child) => (
        <FolderNavRow
          key={child.id}
          node={child}
          open={open}
          onToggle={onToggle}
          activeId={activeId}
          enableDrag={enableDrag}
          href={href}
          parentTagNames={node.tag_names}
          draggingId={draggingId}
          draggingTagNames={draggingTagNames}
          nestOverId={nestOverId}
          nestBlocked={nestBlocked}
        />
      ))}
    </div>
  )

  const nestLit = nestHighlight || nestIsOver
  const nestHint = nestPreview
    ? nestPreview.unrelated
      ? t('projects.detail.nestDropPreviewUnrelated', {
          defaultValue: 'Nest → {{merged}} (no shared tags)',
          merged: nestPreview.mergedLabel,
        })
      : t('projects.detail.nestDropPreview', {
          defaultValue: 'Nest → {{merged}}',
          merged: nestPreview.mergedLabel,
        })
    : t('projects.detail.nestDropHint', { defaultValue: 'Drop here to nest as a more specific map' })

  return (
    <div className="relative block shrink-0 space-y-px">
      <div
        ref={sortable.setNodeRef}
        style={style}
        className={cn(
          'group/row relative flex h-[26px] items-center gap-0.5 rounded-md transition-[background-color,box-shadow,opacity] duration-150',
          nestLit && 'bg-accent/12 ring-1 ring-inset ring-accent/40',
          nestLit && nestPreview?.unrelated && 'ring-amber-400/50 bg-amber-500/10',
          sortable.isDragging && 'opacity-35',
          enableDrag && 'cursor-grab active:cursor-grabbing',
        )}
        {...(enableDrag ? { ...sortable.attributes, ...sortable.listeners } : {})}
      >
        {/* Fixed gutter so leaf rows stay aligned with parents that have a chevron. */}
        {hasChildren ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={t(expanded ? 'projects.detail.collapseFolder' : 'projects.detail.expandFolder', {
              name: rowLabel,
            })}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onToggle(node.id)
            }}
            className="inline-flex h-[26px] w-4 shrink-0 items-center justify-center rounded text-text-muted hover:bg-bg-hover/80 hover:text-text-secondary"
          >
            <ChevronRight
              size={12}
              className={cn('transition-transform duration-150', expanded && 'rotate-90')}
              aria-hidden
            />
          </button>
        ) : (
          <span className="inline-flex h-[26px] w-4 shrink-0" aria-hidden />
        )}
        <NavLink
          to={href(node.id)}
          className={cn(
            'nav-row group h-[26px] min-w-0 flex-1 overflow-hidden pr-8 text-left text-xs',
            isActive && 'text-accent',
          )}
          title={rowTitle}
          data-active={isActive ? 'true' : undefined}
        >
          <FolderRowChrome node={node} parentTagNames={parentTagNames} />
        </NavLink>

        {showNestZone ? (
          <div
            ref={nestRef}
            title={nestHint}
            className={cn(
              'absolute inset-y-0.5 right-0.5 z-10 flex items-center justify-end rounded-md px-1.5 transition-[background-color,box-shadow,width,opacity] duration-150',
              nestLit
                ? 'w-[78%] min-w-[6rem] bg-accent/25 shadow-[-8px_0_14px_-10px_rgba(52,211,153,0.65)]'
                : 'w-[48%] min-w-[4.5rem] bg-gradient-to-l from-accent/[0.14] via-accent/[0.05] to-transparent',
              nestLit && nestPreview?.unrelated && 'bg-amber-500/20',
            )}
            aria-label={nestHint}
          >
            <span
              className={cn(
                'inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium transition-opacity',
                nestPreview?.unrelated && nestLit ? 'text-amber-700 dark:text-amber-300' : 'text-accent',
                nestLit ? 'opacity-100' : 'opacity-60',
              )}
            >
              <CornerDownRight size={12} className="shrink-0" aria-hidden />
              <span className="truncate">
                {nestLit && nestPreview
                  ? nestPreview.unrelated
                    ? t('projects.detail.nestDropLabelUnrelated', { defaultValue: 'Nest (warn)' })
                    : t('projects.detail.nestDropLabel', { defaultValue: 'Nest' })
                  : t('projects.detail.nestDropLabel', { defaultValue: 'Nest' })}
              </span>
            </span>
          </div>
        ) : null}
      </div>
      {hasChildren && expanded ? (
        enableDrag ? (
          <SortableContext items={node.children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {childList}
          </SortableContext>
        ) : (
          childList
        )
      ) : null}
    </div>
  )
}

/** Compact pill used when a map is shown as a chip (cards, trays). */
export function FolderFilterChip({
  tagNames,
  name,
  size = 'sm',
}: {
  tagNames?: string[]
  name?: string
  size?: 'sm' | 'md'
}) {
  const names = tagNames?.length ? tagNames : name ? [name] : []
  if (!names.length) return null
  return <TagPill names={names} tone="set" size={size} />
}
