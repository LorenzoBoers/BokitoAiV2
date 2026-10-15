import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
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
import { ArrowUpToLine, ChevronRight, CornerDownRight } from 'lucide-react'
import { toast } from 'sonner'
import {
  deriveFolderTree,
  filtersetLocalNames,
  filtersetPlainLabel,
  folderAncestorChain,
  folderFilterSiblings,
  optimisticNestSources,
  optimisticUnnestToRootAt,
  resolveSiblingReorderTarget,
  rootFolderIdFor,
  type FolderFilterNode,
  type FolderFilterSource,
  type RootPlace,
} from '../../lib/folder-filter-tree'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { TagPill } from '../ui/TagPill'
import {
  clearFolderMoveUndo,
  hasFolderMoveUndo,
  isEditableKeyboardTarget,
  runFolderMoveUndo,
  setFolderMoveUndo,
  takeFolderMoveUndoToastId,
} from '../../lib/folder-move-undo'
import {
  findExactTagFolder,
  isTagDragId,
  optimisticMoveTag,
  optimisticRemoveTag,
  parseTagDragId,
  tagDragId,
} from '../../lib/folder-tag-move'
import { createProject, deleteProject, nestFolder, patchProject } from '../../lib/projects-api'
import { cn } from '../../lib/utils'

export type FolderNavSource = FolderFilterSource & {
  open_count?: number
}

const UNDO_TOAST_MS = 12_000

/** Animate siblings sliding aside while sorting; skip only the post-drop tween. */
const animateLayoutChanges: AnimateLayoutChanges = (args) =>
  args.wasDragging ? false : defaultAnimateLayoutChanges(args)

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

const NEST_PREFIX = 'nest:'
/** Droppable ids for unnest / tag-to-root (top and bottom of the tree). */
const ROOT_DROP_ID = 'folder-root-drop'
const ROOT_DROP_END_ID = 'folder-root-drop-end'

/** Active tree rail while dragging — collision uses its midpoint (left=reorder, right=nest). */
let activeFolderTreeRail: HTMLElement | null = null
/** Last half under the pointer; collision detection updates this each move. */
let lastFolderDragHalf: 'left' | 'right' = 'left'
/** Last pointer Y — used to place before/after a root while unnesting. */
let lastFolderPointerY = 0

function nestDropId(folderId: string): string {
  return `${NEST_PREFIX}${folderId}`
}

function parseNestDropId(id: UniqueIdentifier | null | undefined): string | null {
  const raw = id == null ? '' : String(id)
  return raw.startsWith(NEST_PREFIX) ? raw.slice(NEST_PREFIX.length) : null
}

function isRootDropId(id: UniqueIdentifier | null | undefined): boolean {
  if (id == null) return false
  const raw = String(id)
  return raw === ROOT_DROP_ID || raw === ROOT_DROP_END_ID
}

function rootPlaceFromDropId(id: UniqueIdentifier | null | undefined): RootPlace | null {
  if (id == null) return null
  const raw = String(id)
  if (raw === ROOT_DROP_ID) return { at: 'start' }
  if (raw === ROOT_DROP_END_ID) return { at: 'end' }
  return null
}

function pointerDragHalf(pointer: { x: number; y: number } | null | undefined): 'left' | 'right' {
  if (!pointer || !activeFolderTreeRail) return 'left'
  const rect = activeFolderTreeRail.getBoundingClientRect()
  if (rect.width <= 0) return 'left'
  return pointer.x >= rect.left + rect.width / 2 ? 'right' : 'left'
}

function resolveFolderDropTarget(overId: string | null, nestOverId: string | null): string | null {
  if (!overId) return null
  const nest = parseNestDropId(overId)
  if (nest) return nest
  const overTag = parseTagDragId(overId)
  if (overTag) return overTag.folderId
  if (nestOverId && overId === nestOverId) return nestOverId
  return overId
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

function labelFor(node: FolderFilterNode, _parentTagNames?: string[] | null): string {
  const named = node.name.replace(/^#/, '').trim()
  if (named) return named
  if (node.tag_names.length) {
    return filtersetPlainLabel(filtersetLocalNames(node.tag_names, _parentTagNames))
  }
  return 'Folder'
}

/**
 * Nest = drop on the right strip of a row (nest: droppables win when the
 * pointer is in that strip). Left / rest of the rail = sibling reorder.
 * Rail-half is a fallback when the pointer is not inside a nest strip.
 */
const folderCollision: CollisionDetection = (args) => {
  const rootContainers = args.droppableContainers.filter((container) =>
    isRootDropId(container.id),
  )
  // Prefer end zone when both could hit; otherwise any root zone.
  const rootHits = pointerWithin({ ...args, droppableContainers: rootContainers })
  if (rootHits.length > 0) {
    const endHit = rootHits.find((hit) => String(hit.id) === ROOT_DROP_END_ID)
    return endHit ? [endHit] : rootHits
  }

  const folderContainers = args.droppableContainers.filter((container) => {
    const id = String(container.id)
    return !id.startsWith(NEST_PREFIX) && !isTagDragId(id) && !isRootDropId(id)
  })
  const nestContainers = args.droppableContainers.filter((container) =>
    String(container.id).startsWith(NEST_PREFIX),
  )

  if (args.pointerCoordinates) lastFolderPointerY = args.pointerCoordinates.y

  // Nest strips win whenever the pointer is actually over them (drag right onto a row).
  const nestHits = pointerWithin({ ...args, droppableContainers: nestContainers })
  if (nestHits.length > 0) {
    lastFolderDragHalf = 'right'
    return nestHits
  }

  if (isTagDragId(String(args.active.id))) {
    lastFolderDragHalf = 'right'
    const pointerHits = pointerWithin({ ...args, droppableContainers: folderContainers })
    if (pointerHits.length > 0) return pointerHits
    return closestCenter({ ...args, droppableContainers: folderContainers })
  }

  const half = pointerDragHalf(args.pointerCoordinates)
  lastFolderDragHalf = half

  if (half === 'right') {
    // Pointer on the right side of the rail but not exactly on a nest strip —
    // map the closest folder row to its nest target.
    const folderPointerHits = pointerWithin({ ...args, droppableContainers: folderContainers })
    const folderHits =
      folderPointerHits.length > 0
        ? folderPointerHits
        : closestCenter({ ...args, droppableContainers: folderContainers })
    if (folderHits.length > 0) {
      const folderId = String(folderHits[0]!.id)
      const nestHit = nestContainers.find((container) => String(container.id) === nestDropId(folderId))
      if (nestHit) return [{ id: nestHit.id }]
      return folderHits
    }
    return closestCenter({ ...args, droppableContainers: nestContainers })
  }

  // Left half: reorder only.
  const folderPointerHits = pointerWithin({ ...args, droppableContainers: folderContainers })
  if (folderPointerHits.length > 0) return folderPointerHits
  return closestCenter({ ...args, droppableContainers: folderContainers })
}

/**
 * Shared folder tree chrome: typographic `#` labels, optional whole-row
 * drag (no grip). Used on /folders; rail surfaces reuse the same row look.
 *
 * Drag: left half of the rail reorders siblings; right half nests under the
 * map under the pointer. Multi-tag rows can drag a tag chip onto another map.
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
  // Optimistic tree order — updates while dragging so drop does not snap back.
  const [localSources, setLocalSources] = useState(sources)
  const localSourcesRef = useRef(sources)
  const draggingRef = useRef(false)
  const treeRailRef = useRef<HTMLDivElement | null>(null)
  /** Snapshot at drag start — restore when leaving a root-unnest preview. */
  const dragSnapshotRef = useRef<FolderNavSource[] | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [nestOverId, setNestOverId] = useState<string | null>(null)
  /** Auto-expand nest targets while dragging so the live nest preview is visible. */
  const [dragExpandIds, setDragExpandIds] = useState<Set<string>>(() => new Set())
  /** Sibling insert line while reordering (before / after the hovered row). */
  const [dropLine, setDropLine] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)

  useEffect(() => {
    if (draggingRef.current) return
    localSourcesRef.current = sources
    setLocalSources(sources)
  }, [sources])

  const tree = useMemo(() => deriveFolderTree(localSources), [localSources])
  const viewOpen = useMemo(() => {
    if (dragExpandIds.size === 0) return open
    const next = new Set(open)
    for (const id of dragExpandIds) next.add(id)
    return next
  }, [open, dragExpandIds])
  const draggingTag = useMemo(() => parseTagDragId(draggingId), [draggingId])
  const draggingFolderId = draggingTag || !draggingId ? null : draggingId
  const nestBlocked = useMemo(() => {
    if (draggingTag) return new Set([draggingTag.folderId])
    return blockedNestTargets(tree, draggingFolderId)
  }, [tree, draggingTag, draggingFolderId])
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Whole-row drag: short move before grab so clicks still navigate.
      activationConstraint: { distance: 4 },
    }),
  )

  const href = linkTo ?? ((id: string) => `/folders/${id}`)

  const setSourcesOptimistic = (next: FolderNavSource[]) => {
    localSourcesRef.current = next
    setLocalSources(next)
  }

  const clearDrag = () => {
    draggingRef.current = false
    activeFolderTreeRail = null
    lastFolderDragHalf = 'left'
    dragSnapshotRef.current = null
    setDraggingId(null)
    setNestOverId(null)
    setDragExpandIds(new Set())
    setDropLine(null)
  }

  const previewUnnestToRoot = (folderId: string, place: RootPlace) => {
    const base = dragSnapshotRef.current ?? localSourcesRef.current
    const next = optimisticUnnestToRootAt(base, folderId, place)
    if (next) setSourcesOptimistic(next)
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
    activeFolderTreeRail = treeRailRef.current
    lastFolderDragHalf = 'left'
    dragSnapshotRef.current = localSourcesRef.current
    setDraggingId(String(event.active.id))
    setNestOverId(null)
    setDragExpandIds(new Set())
    setDropLine(null)
  }

  const expandWhileDragging = (folderId: string) => {
    setDragExpandIds((prev) => {
      if (prev.has(folderId)) return prev
      const next = new Set(prev)
      next.add(folderId)
      return next
    })
  }

  const onDragOver = (event: DragOverEvent) => {
    const activeId = String(event.active.id)
    const activeTagDrag = parseTagDragId(activeId)
    const overId = event.over?.id
    const rootPlace = rootPlaceFromDropId(overId)
    if (rootPlace) {
      setNestOverId(String(overId))
      setDropLine(null)
      if (!activeTagDrag) previewUnnestToRoot(activeId, rootPlace)
      return
    }

    const overRaw = event.over ? String(event.over.id) : null
    const nestId = parseNestDropId(event.over?.id)
    const half = lastFolderDragHalf

    // Tag chip → highlight the folder under the pointer (move target).
    if (activeTagDrag) {
      setDropLine(null)
      if (!overRaw) {
        setNestOverId(null)
        return
      }
      const targetId = resolveFolderDropTarget(overRaw, null)
      if (targetId && !nestBlocked.has(targetId)) {
        setNestOverId(targetId)
        expandWhileDragging(targetId)
      } else {
        setNestOverId(null)
      }
      return
    }

    // Right half of the rail: live nest preview (indent under target).
    if (half === 'right') {
      setDropLine(null)
      const nestTarget =
        nestId ??
        (overRaw && !isRootDropId(overRaw) && !parseTagDragId(overRaw) ? overRaw : null) ??
        null
      if (nestTarget && !nestBlocked.has(nestTarget)) {
        setNestOverId(nestTarget)
        expandWhileDragging(nestTarget)
        const base = dragSnapshotRef.current ?? localSourcesRef.current
        const preview = optimisticNestSources(base, activeId, nestTarget)
        if (preview) setSourcesOptimistic(preview)
        return
      }
      if (dragSnapshotRef.current) setSourcesOptimistic(dragSnapshotRef.current)
      setNestOverId(null)
      return
    }

    // Left half: leave nest preview, then reorder or unnest-to-root.
    setNestOverId(null)
    if (!overRaw || nestId || isRootDropId(overRaw) || parseTagDragId(overRaw)) {
      setDropLine(null)
      return
    }

    const snap = dragSnapshotRef.current
    if (snap) {
      const live = localSourcesRef.current.find((source) => source.id === activeId)
      const orig = snap.find((source) => source.id === activeId)
      if (live && orig && live.parent_id !== orig.parent_id) {
        setSourcesOptimistic(snap)
      }
    }

    const base = dragSnapshotRef.current ?? localSourcesRef.current
    const treeBase = deriveFolderTree(base)
    const nested = folderAncestorChain(treeBase, activeId).length > 0
    if (nested) {
      const hitRoot = rootFolderIdFor(treeBase, overRaw)
      if (hitRoot && hitRoot !== activeId) {
        const rootEl = activeFolderTreeRail?.querySelector(
          `[data-folder-id="${hitRoot.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`,
        )
        const rect = rootEl?.getBoundingClientRect()
        const place: RootPlace =
          rect && lastFolderPointerY < rect.top + rect.height / 2
            ? { at: 'before', rootId: hitRoot }
            : { at: 'after', rootId: hitRoot }
        setDropLine(null)
        previewUnnestToRoot(activeId, place)
        return
      }
    }

    // Same-parent sibling reorder from the live tree (or snapshot if still nested).
    const treeNow = deriveFolderTree(localSourcesRef.current)
    const reorderOverId = resolveSiblingReorderTarget(treeNow, activeId, overRaw)
    if (reorderOverId) {
      const overEl = activeFolderTreeRail?.querySelector(
        `[data-folder-id="${reorderOverId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`,
      )
      const rect = overEl?.getBoundingClientRect()
      const edge: 'before' | 'after' =
        rect && lastFolderPointerY < rect.top + rect.height / 2 ? 'before' : 'after'
      setDropLine({ id: reorderOverId, edge })
      const moved = reorderSiblingSources(localSourcesRef.current, activeId, reorderOverId)
      if (moved) setSourcesOptimistic(moved.sources)
      return
    }
    setDropLine(null)
    // Left over a non-sibling without a root lift — restore snapshot.
    if (dragSnapshotRef.current && nested) {
      setSourcesOptimistic(dragSnapshotRef.current)
    }
  }

  const runMoveTag = async (fromId: string, toId: string, tag: string) => {
    if (fromId === toId) return
    const snapshot = localSourcesRef.current
    const from = snapshot.find((source) => source.id === fromId)
    const to = snapshot.find((source) => source.id === toId)
    if (!from || !to) return
    const previousFrom = (from.tag_names ?? []).map(bareTag).filter(Boolean)
    const previousTo = (to.tag_names ?? []).map(bareTag).filter(Boolean)
    const fromNames = (from.tag_names ?? []).map(bareTag).filter(Boolean)
    // Single-tag maps are moved as a whole row — never strip their only tag.
    if (fromNames.length <= 1) return
    const optimistic = optimisticMoveTag(snapshot, fromId, toId, tag)
    if (!optimistic) return
    const nextFrom = optimistic.find((source) => source.id === fromId)
    const nextTo = optimistic.find((source) => source.id === toId)
    if (!nextFrom || !nextTo) return
    setSourcesOptimistic(optimistic)
    try {
      await Promise.all([
        patchProject(fromId, { tags: (nextFrom.tag_names ?? []).map(bareTag).filter(Boolean) }),
        patchProject(toId, { tags: (nextTo.tag_names ?? []).map(bareTag).filter(Boolean) }),
      ])
      offerUndo(
        t('projects.detail.tagMoved', {
          defaultValue: 'Tag moved',
          tag: bareTag(tag),
        }),
        async () => {
          await Promise.all([
            patchProject(fromId, { tags: previousFrom }),
            patchProject(toId, { tags: previousTo }),
          ])
          onChanged?.()
        },
      )
      onChanged?.()
    } catch (err) {
      setSourcesOptimistic(snapshot)
      toast.error(formatApiErrorMessage(err, t('projects.detail.saveError')))
    }
  }

  const runUnnestToRoot = async (folderId: string, place: RootPlace = { at: 'end' }) => {
    const snapshot = dragSnapshotRef.current ?? localSourcesRef.current
    const before = snapshot.find((source) => source.id === folderId)
    if (!before) return
    const previousParent = before.parent_id ?? null
    const previousOrders = snapshot.map((source) => ({
      id: source.id,
      sort_order: source.sort_order ?? 0,
    }))
    const optimistic = optimisticUnnestToRootAt(snapshot, folderId, place)
    if (!optimistic) {
      toast.error(
        t('projects.detail.unnestBlocked', {
          defaultValue: 'This map is already at the top level',
        }),
      )
      return
    }
    setSourcesOptimistic(optimistic)
    const rootIds = deriveFolderTree(optimistic).map((node) => node.id)
    try {
      await nestFolder(folderId, null)
      await Promise.all(rootIds.map((id, index) => patchProject(id, { sort_order: index })))
      offerUndo(
        t('projects.detail.unnested', {
          defaultValue: 'Map moved to the top level',
        }),
        async () => {
          await nestFolder(folderId, previousParent)
          await Promise.all(
            previousOrders.map((row) => patchProject(row.id, { sort_order: row.sort_order })),
          )
          onChanged?.()
        },
      )
      onChanged?.()
    } catch (err) {
      setSourcesOptimistic(snapshot)
      toast.error(formatApiErrorMessage(err, t('projects.detail.saveError')))
    }
  }

  const runMoveTagToRoot = async (fromId: string, tag: string) => {
    const snapshot = localSourcesRef.current
    const from = snapshot.find((source) => source.id === fromId)
    if (!from) return
    const previousFrom = (from.tag_names ?? []).map(bareTag).filter(Boolean)
    const bare = bareTag(tag)
    const existing = findExactTagFolder(snapshot, bare)
    // Already the single-tag root map for this tag — nothing to do.
    if (existing?.id === fromId || previousFrom.length <= 1) return
    const stripped = optimisticRemoveTag(snapshot, fromId, bare)
    if (!stripped) return
    const nextFrom = stripped.find((source) => source.id === fromId)
    if (!nextFrom) return
    const pendingId = existing?.id ?? `__pending_root_${bare}`
    const maxOrder = Math.max(0, ...stripped.map((source) => source.sort_order ?? 0))
    const withRoot = existing
      ? stripped
      : [
          ...stripped,
          {
            id: pendingId,
            name: bare,
            tag_ids: [`__pending_${bare}`],
            tag_names: [bare],
            sort_order: maxOrder + 1,
          } satisfies FolderNavSource,
        ]
    setSourcesOptimistic(withRoot)
    try {
      await patchProject(fromId, { tags: (nextFrom.tag_names ?? []).map(bareTag).filter(Boolean) })
      let createdId: string | null = existing?.id ?? null
      let createdName: string | null = existing?.name ?? null
      if (!existing) {
        const created = await createProject({ tags: [bare] })
        createdId = created.id
        createdName = created.name
        // Swap pending row for the real folder so the tree keeps the root slot.
        setSourcesOptimistic(
          withRoot.map((source) =>
            source.id === pendingId
              ? {
                  ...source,
                  id: created.id,
                  name: created.name,
                  tag_ids: created.tag_ids ?? source.tag_ids,
                  tag_names: created.tag_names ?? [bare],
                }
              : source,
          ),
        )
      }
      offerUndo(
        t('projects.detail.tagMovedToRoot', {
          defaultValue: 'Moved #{{tag}} to the top level',
          tag: bare,
        }),
        async () => {
          await patchProject(fromId, { tags: previousFrom })
          if (createdId && createdName && !existing) {
            await deleteProject(createdId, createdName)
          }
          onChanged?.()
        },
      )
      onChanged?.()
    } catch (err) {
      setSourcesOptimistic(snapshot)
      toast.error(formatApiErrorMessage(err, t('projects.detail.saveError')))
    }
  }

  const runNest = async (activeId: string, parentId: string, blocked: Set<string>) => {
    if (blocked.has(parentId) || activeId === parentId) return
    const before = localSourcesRef.current.find((source) => source.id === activeId)
    const parent = localSourcesRef.current.find((source) => source.id === parentId)
    if (!before || !parent) return
    if (before.parent_id === parentId) return
    const previousParent = before.parent_id ?? null

    const snapshot = localSourcesRef.current
    const optimistic = optimisticNestSources(snapshot, activeId, parentId)
    if (optimistic) setSourcesOptimistic(optimistic)
    if (!open.has(parentId)) onToggle(parentId)
    try {
      await nestFolder(activeId, parentId)
      offerUndo(
        t('projects.detail.nested', {
          defaultValue: 'Folder nested',
        }),
        async () => {
          await nestFolder(activeId, previousParent)
          onChanged?.()
        },
      )
      onChanged?.()
    } catch (err) {
      setSourcesOptimistic(snapshot)
      toast.error(formatApiErrorMessage(err, t('projects.detail.saveError')))
    }
  }

  const persistUnnestPreview = async (folderId: string, preDrag: FolderNavSource[]) => {
    const before = preDrag.find((source) => source.id === folderId)
    const current = localSourcesRef.current.find((source) => source.id === folderId)
    if (!before || !current) return
    if ((before.parent_id ?? null) === (current.parent_id ?? null)) return
    const previousParent = before.parent_id ?? null
    const previousOrders = preDrag.map((source) => ({
      id: source.id,
      sort_order: source.sort_order ?? 0,
    }))
    const rootIds = deriveFolderTree(localSourcesRef.current).map((node) => node.id)
    try {
      await nestFolder(folderId, null)
      await Promise.all(rootIds.map((id, index) => patchProject(id, { sort_order: index })))
      offerUndo(
        t('projects.detail.unnested', {
          defaultValue: 'Map moved to the top level',
        }),
        async () => {
          await nestFolder(folderId, previousParent)
          await Promise.all(
            previousOrders.map((row) => patchProject(row.id, { sort_order: row.sort_order })),
          )
          onChanged?.()
        },
      )
      onChanged?.()
    } catch (err) {
      setSourcesOptimistic(preDrag)
      toast.error(formatApiErrorMessage(err, t('projects.detail.saveError')))
    }
  }

  const onDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id)
    const overRaw = event.over ? String(event.over.id) : null
    const tagDrag = parseTagDragId(activeId)
    const rootPlace =
      rootPlaceFromDropId(overRaw) ??
      rootPlaceFromDropId(nestOverId) ??
      (isRootDropId(nestOverId) ? { at: 'end' as const } : null)
    const dropOnRoot = rootPlace != null
    const dropFolderId = dropOnRoot ? null : resolveFolderDropTarget(overRaw, nestOverId)
    const preDrag = dragSnapshotRef.current ?? sources

    if (!enableDrag || !overRaw) {
      if (preDrag) setSourcesOptimistic(preDrag)
      clearDrag()
      return
    }

    if (dropOnRoot) {
      if (tagDrag) {
        clearDrag()
        void runMoveTagToRoot(tagDrag.folderId, tagDrag.tag)
        return
      }
      void runUnnestToRoot(activeId, rootPlace ?? { at: 'end' })
      clearDrag()
      return
    }

    if (tagDrag) {
      clearDrag()
      if (!dropFolderId || dropFolderId === tagDrag.folderId) return
      void runMoveTag(tagDrag.folderId, dropFolderId, tagDrag.tag)
      return
    }

    const treeAtDrop = deriveFolderTree(localSourcesRef.current)
    const half = lastFolderDragHalf
    const wasNested = folderAncestorChain(deriveFolderTree(preDrag), activeId).length > 0
    const nowRoot = treeAtDrop.some((node) => node.id === activeId)
    const nestParentId =
      parseNestDropId(overRaw) ??
      (nestOverId && !isRootDropId(nestOverId) ? nestOverId : null) ??
      (half === 'right' && overRaw && !parseTagDragId(overRaw) && !isRootDropId(overRaw)
        ? overRaw
        : null)
    const nestBlockedAtDrop = blockedNestTargets(deriveFolderTree(preDrag), activeId)

    // Nest when the pointer hit a nest strip, a sticky nest highlight, or the right rail half.
    if (
      nestParentId &&
      nestParentId !== activeId &&
      !nestBlockedAtDrop.has(nestParentId) &&
      (half === 'right' || Boolean(parseNestDropId(overRaw)) || nestOverId === nestParentId)
    ) {
      if (preDrag) setSourcesOptimistic(preDrag)
      clearDrag()
      void runNest(activeId, nestParentId, nestBlockedAtDrop)
      return
    }

    // Left half after a live unnest preview: persist tags + root order.
    if (wasNested && nowRoot) {
      clearDrag()
      void persistUnnestPreview(activeId, preDrag)
      return
    }

    // Left half: reorder siblings only.
    const overId = overRaw
    const reorderOverId = resolveSiblingReorderTarget(treeAtDrop, activeId, overId)
    const moved = reorderOverId
      ? reorderSiblingSources(localSourcesRef.current, activeId, reorderOverId)
      : null
    if (moved) {
      setSourcesOptimistic(moved.sources)
      clearDrag()
      void persistSiblingOrder(moved.siblingIds, preDrag)
      return
    }

    clearDrag()
    if (reorderOverId) {
      const sibs = folderFilterSiblings(treeAtDrop, activeId)
      if (sibs) {
        void persistSiblingOrder(
          sibs.siblings.map((sibling) => sibling.id),
          preDrag,
        )
      }
    }
  }

  const draggingTagNames = useMemo(() => {
    if (!draggingFolderId) return null
    const row = localSources.find((source) => source.id === draggingFolderId)
    return (row?.tag_names ?? []).map(bareTag).filter(Boolean)
  }, [draggingFolderId, localSources])

  if (tree.length === 0) {
    return <>{empty ?? null}</>
  }

  const nestedDragFolder =
    Boolean(draggingFolderId) &&
    folderAncestorChain(tree, draggingFolderId!).length > 0
  const showRootDrop = Boolean(draggingId && (draggingTag || nestedDragFolder))

  const rows = (
    <div ref={treeRailRef} className={cn('space-y-px', className)}>
      {enableDrag ? (
        <RootDropZone
          id={ROOT_DROP_ID}
          active={showRootDrop}
          highlight={nestOverId === ROOT_DROP_ID}
          movingTag={Boolean(draggingTag)}
          tagName={draggingTag?.tag ?? null}
          placement="start"
        />
      ) : null}
      {tree.map((node) => (
        <FolderNavRow
          key={node.id}
          node={node}
          open={viewOpen}
          onToggle={onToggle}
          activeId={activeId}
          enableDrag={enableDrag}
          href={href}
          parentTagNames={null}
          draggingId={draggingId}
          draggingTag={draggingTag}
          draggingTagNames={draggingTagNames}
          nestOverId={nestOverId}
          nestBlocked={nestBlocked}
          dropLine={dropLine}
        />
      ))}
      {enableDrag ? (
        <RootDropZone
          id={ROOT_DROP_END_ID}
          active={showRootDrop}
          highlight={nestOverId === ROOT_DROP_END_ID}
          movingTag={Boolean(draggingTag)}
          tagName={draggingTag?.tag ?? null}
          placement="end"
        />
      ) : null}
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

  const dragNode = draggingFolderId ? findNode(tree, draggingFolderId) : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={folderCollision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={(e) => void onDragEnd(e)}
      onDragCancel={() => {
        const snap = dragSnapshotRef.current ?? sources
        clearDrag()
        setSourcesOptimistic(snap)
      }}
    >
      {body}
      <DragOverlay
        dropAnimation={{
          duration: 160,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        {draggingTag ? (
          <div className="pointer-events-none scale-[1.03] shadow-overlay">
            <TagPill names={draggingTag.tag} tone="free" size="sm" selected />
          </div>
        ) : dragNode ? (
          <div className="pointer-events-none flex h-[28px] items-center gap-2 rounded-lg border border-accent/40 bg-bg-surface/95 px-2.5 text-xs shadow-overlay ring-1 ring-accent/20 backdrop-blur-sm">
            <FolderRowChrome node={dragNode} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function RootDropZone({
  id,
  active,
  highlight,
  movingTag,
  tagName,
  placement,
}: {
  id: string
  active: boolean
  highlight: boolean
  movingTag: boolean
  tagName: string | null
  placement: 'start' | 'end'
}) {
  const { t } = useTranslation('nav')
  const { setNodeRef, isOver } = useDroppable({
    id,
    disabled: !active,
  })
  if (!active) return null
  const lit = highlight || isOver
  const hint = movingTag
    ? t('projects.detail.rootDropTagHint', {
        defaultValue: 'Drop to place #{{tag}} at the top level',
        tag: tagName ?? '',
      })
    : placement === 'end'
      ? t('projects.detail.rootDropEndHint', {
          defaultValue: 'Drop to move this map to the top level (end of list)',
        })
      : t('projects.detail.rootDropHint', {
          defaultValue: 'Drop to move this map to the top level',
        })
  const label = t('projects.detail.rootDropLabel', { defaultValue: 'Top level' })
  return (
    <div
      ref={setNodeRef}
      title={hint}
      aria-label={hint}
      className={cn(
        'flex h-[26px] items-center gap-1.5 rounded-md border border-dashed px-2 text-2xs font-medium transition-[background-color,border-color,color] duration-150',
        placement === 'start' ? 'mb-0.5' : 'mt-0.5',
        lit
          ? 'border-accent/55 bg-accent/16 text-accent shadow-[0_0_0_1px_rgb(var(--color-accent)/0.2)]'
          : 'border-border/55 bg-bg-hover/30 text-text-muted',
      )}
    >
      <ArrowUpToLine size={12} className="shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </div>
  )
}

/** Folder tree row: plain folder name (labels live on the folder detail / cards). */
function FolderRowChrome({
  node,
  isActive = false,
  trailing,
}: {
  node: FolderFilterNode
  isActive?: boolean
  trailing?: ReactNode
}) {
  const name = node.name.replace(/^#/, '').trim() || labelFor(node)
  return (
    <>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-xs',
          isActive ? 'font-medium text-accent' : 'text-text-heading',
        )}
      >
        {name}
      </span>
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
  draggingTag,
  draggingTagNames,
  nestOverId,
  nestBlocked,
  dropLine,
}: {
  node: FolderFilterNode
  open: Set<string>
  onToggle: (id: string) => void
  activeId?: string | null
  enableDrag: boolean
  href: (id: string) => string
  parentTagNames?: string[] | null
  draggingId: string | null
  draggingTag: { folderId: string; tag: string } | null
  draggingTagNames: string[] | null
  nestOverId: string | null
  nestBlocked: Set<string>
  dropLine: { id: string; edge: 'before' | 'after' } | null
}) {
  const { t } = useTranslation('nav')
  const expanded = open.has(node.id)
  const hasChildren = node.children.length > 0
  const isActive = activeId === node.id
  const rowLabel = labelFor(node, parentTagNames)
  const rowTitle = rowLabel
  const showDropBefore = dropLine?.id === node.id && dropLine.edge === 'before'
  const showDropAfter = dropLine?.id === node.id && dropLine.edge === 'after'

  const sortable = useSortable({
    id: node.id,
    disabled: !enableDrag,
    animateLayoutChanges,
  })
  // Nest strip is active for every other folder while dragging (right-drop target).
  const showNestZone = Boolean(
    enableDrag && draggingId && draggingId !== node.id && !nestBlocked.has(node.id),
  )
  const nestHighlight = nestOverId === node.id
  const movingTag = Boolean(draggingTag)
  const { setNodeRef: nestRef, isOver: nestIsOver } = useDroppable({
    id: nestDropId(node.id),
    disabled: !showNestZone,
  })

  const style: CSSProperties = enableDrag
    ? {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.isDragging ? undefined : sortable.transition,
      }
    : {}

  const childList = (
    <div className="relative ml-3.5 space-y-px border-l border-border/55 pl-2.5">
      {node.children.map((child, index) => (
        <div key={child.id} className="relative">
          <span
            className="pointer-events-none absolute -left-2.5 top-[14px] h-px w-2 bg-border/70"
            aria-hidden
          />
          {index === node.children.length - 1 ? (
            <span
              className="pointer-events-none absolute -left-px top-0 h-[14px] w-px bg-bg"
              aria-hidden
            />
          ) : null}
          <FolderNavRow
            node={child}
            open={open}
            onToggle={onToggle}
            activeId={activeId}
            enableDrag={enableDrag}
            href={href}
            parentTagNames={node.tag_names}
            draggingId={draggingId}
            draggingTag={draggingTag}
            draggingTagNames={draggingTagNames}
            nestOverId={nestOverId}
            nestBlocked={nestBlocked}
            dropLine={dropLine}
          />
        </div>
      ))}
    </div>
  )

  const nestLit = nestHighlight || nestIsOver
  const nestHint = movingTag && draggingTag
    ? t('projects.detail.tagMoveHint', {
        defaultValue: 'Drop to move {{tag}} into this folder',
        tag: draggingTag.tag,
      })
    : t('projects.detail.nestDropHint', {
        defaultValue: 'Drop here to nest under this folder',
      })

  return (
    <div
      ref={enableDrag ? sortable.setNodeRef : undefined}
      style={style}
      data-folder-id={node.id}
      className={cn(
        'relative block shrink-0 space-y-px',
        sortable.isDragging && 'opacity-0',
      )}
    >
      {showDropBefore ? (
        <div
          className="pointer-events-none absolute inset-x-1 -top-px z-20 h-0.5 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--color-accent)/0.55)]"
          aria-hidden
        />
      ) : null}
      <div
        className={cn(
          'group/row relative flex h-[28px] items-center gap-0.5 rounded-md transition-[background-color,box-shadow,opacity] duration-150',
          nestLit && 'bg-accent/14 ring-1 ring-inset ring-accent/45',
          enableDrag && 'cursor-grab active:cursor-grabbing',
        )}
        {...(enableDrag ? { ...sortable.attributes, ...sortable.listeners } : {})}
      >
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
            className="inline-flex h-[28px] w-4 shrink-0 items-center justify-center rounded text-text-muted hover:bg-bg-hover/80 hover:text-text-secondary"
          >
            <ChevronRight
              size={12}
              className={cn('transition-transform duration-150', expanded && 'rotate-90')}
              aria-hidden
            />
          </button>
        ) : (
          <span className="inline-flex h-[28px] w-4 shrink-0" aria-hidden />
        )}
        <NavLink
          to={href(node.id)}
          draggable={false}
          className={cn(
            'nav-row group h-[28px] min-w-0 flex-1 overflow-hidden pr-8 text-left text-xs',
            isActive && 'text-accent',
          )}
          title={rowTitle}
          data-active={isActive ? 'true' : undefined}
        >
          <FolderRowChrome node={node} isActive={isActive} />
        </NavLink>

        {showNestZone ? (
          <div
            ref={nestRef}
            title={nestHint}
            className={cn(
              // Right half of the row = nest target (drag right onto a folder).
              'absolute inset-y-0 right-0 z-20 flex w-1/2 items-center justify-end rounded-md px-1.5 transition-[background-color,box-shadow,opacity] duration-150',
              nestLit
                ? 'bg-accent/35 shadow-[-12px_0_20px_-8px_rgba(52,211,153,0.8)]'
                : 'bg-gradient-to-l from-accent/[0.2] via-accent/[0.08] to-transparent',
            )}
            aria-label={nestHint}
          >
            <span
              className={cn(
                'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold text-accent transition-opacity',
                nestLit ? 'bg-accent/25 opacity-100' : 'opacity-70',
              )}
            >
              <CornerDownRight size={12} className="shrink-0" aria-hidden />
              <span className="truncate">
                {movingTag
                  ? t('projects.detail.tagMoveLabel', { defaultValue: 'Move label' })
                  : t('projects.detail.nestDropLabel', { defaultValue: 'Nest' })}
              </span>
            </span>
          </div>
        ) : null}
      </div>
      {showDropAfter ? (
        <div
          className="pointer-events-none absolute inset-x-1 -bottom-px z-20 h-0.5 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--color-accent)/0.55)]"
          aria-hidden
        />
      ) : null}
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

/** Compact chip for a folder by display name (not its labels). */
export function FolderFilterChip({
  name,
  size = 'sm',
}: {
  tagNames?: string[]
  name?: string
  size?: 'sm' | 'md'
}) {
  const bare = (name || '').replace(/^#/, '').trim()
  if (!bare) return null
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center truncate font-medium text-text-heading',
        size === 'sm' ? 'text-2xs' : 'text-xs',
      )}
    >
      {bare}
    </span>
  )
}
