import {
  useEffect,
  useMemo,
  useRef,
  useState,
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
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { ArrowUpToLine, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import {
  FOLDER_TREE_BASE_PAD_PX,
  FOLDER_TREE_INDENT_PX,
  deriveFolderTree,
  filtersetLocalNames,
  filtersetPlainLabel,
  folderAncestorChain,
  folderFilterRows,
  folderFilterSiblings,
  optimisticApplyFolderPlacement,
  optimisticUnnestToRootAt,
  placementFromAnchor,
  resolveFolderDepthIntent,
  type FolderDragPlacement,
  type FolderFilterNode,
  type FolderFilterSource,
  type RootPlace,
} from '../../lib/folder-filter-tree'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { TagPill } from '../ui/TagPill'

const FolderIcon = ENTITY_ICONS.project
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
} from '../../lib/folder-tag-move'
import { createProject, deleteProject, nestFolder, patchProject } from '../../lib/projects-api'
import { cn } from '../../lib/utils'

export type FolderNavSource = FolderFilterSource & {
  open_count?: number
}

const UNDO_TOAST_MS = 12_000

type DropLine = { top: number; left: number }

function bareTag(name: string): string {
  return name.replace(/^#/, '').trim()
}

/** Droppable ids for unnest / tag-to-root (top and bottom of the tree). */
const ROOT_DROP_ID = 'folder-root-drop'
const ROOT_DROP_END_ID = 'folder-root-drop-end'

/** Active tree rail while dragging — used for indent-depth placement. */
let activeFolderTreeRail: HTMLElement | null = null
/** Last pointer — Y for before/after, X for nest vs sibling depth. */
let lastFolderPointer = { x: 0, y: 0 }
/** Pointer X minus the row's left edge at grab, so depth follows how far you move. */
let folderGrabOffsetX = 12

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

function resolveFolderDropTarget(overId: string | null, nestOverId: string | null): string | null {
  if (!overId) return null
  const overTag = parseTagDragId(overId)
  if (overTag) return overTag.folderId
  if (nestOverId && overId === nestOverId) return nestOverId
  return overId
}

/**
 * Resolve nest / sibling / unnest from pointer X (depth) and Y (row + edge).
 * The tree stays put; a drop line shows this placement.
 */
function resolvePointerFolderPlacement(
  pointer: { x: number; y: number },
  rail: HTMLElement,
  snapshot: FolderNavSource[],
  activeId: string,
  nestBlocked: Set<string>,
): FolderDragPlacement | null {
  const tree = deriveFolderTree(snapshot)
  const depthById = new Map(folderFilterRows(tree).map((row) => [row.id, row.depth]))
  const els = Array.from(rail.querySelectorAll<HTMLElement>('[data-folder-row]'))
  type Hit = { id: string; depth: number; rect: DOMRect }
  const hits: Hit[] = []
  for (const el of els) {
    const id = el.dataset.folderId
    if (!id || id === activeId || nestBlocked.has(id)) continue
    const depth = depthById.get(id)
    if (depth == null) continue
    hits.push({ id, depth, rect: el.getBoundingClientRect() })
  }
  if (hits.length === 0) return null

  let anchor = hits.find((hit) => pointer.y >= hit.rect.top && pointer.y <= hit.rect.bottom)
  if (!anchor) {
    anchor = hits.reduce((best, hit) => {
      const mid = hit.rect.top + hit.rect.height / 2
      const dist = Math.abs(pointer.y - mid)
      const bestMid = best.rect.top + best.rect.height / 2
      return dist < Math.abs(pointer.y - bestMid) ? hit : best
    })
  }

  const edge: 'before' | 'after' =
    pointer.y < anchor.rect.top + anchor.rect.height / 2 ? 'before' : 'after'
  const railLeft = rail.getBoundingClientRect().left
  const itemLeft = pointer.x - folderGrabOffsetX
  const intendedDepth = resolveFolderDepthIntent(itemLeft, railLeft, anchor.depth)
  const ancestorIds = folderAncestorChain(tree, anchor.id).map((node) => node.id)
  return placementFromAnchor(
    intendedDepth,
    anchor.id,
    anchor.depth,
    ancestorIds,
    edge,
    nestBlocked,
  )
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
  if (node.display_name) return node.display_name
  const named = node.name.replace(/^#/, '').trim()
  if (named) return named
  if (node.tag_names.length) {
    return filtersetPlainLabel(filtersetLocalNames(node.tag_names, _parentTagNames))
  }
  return 'Folder'
}

/**
 * Prefer explicit root drop zones, else the folder row under the pointer.
 * Nest vs sibling is resolved from pointer X in onDragOver (indent depth).
 */
const folderCollision: CollisionDetection = (args) => {
  if (args.pointerCoordinates) {
    lastFolderPointer = {
      x: args.pointerCoordinates.x,
      y: args.pointerCoordinates.y,
    }
  }

  const rootContainers = args.droppableContainers.filter((container) =>
    isRootDropId(container.id),
  )
  const rootHits = pointerWithin({ ...args, droppableContainers: rootContainers })
  if (rootHits.length > 0) {
    const endHit = rootHits.find((hit) => String(hit.id) === ROOT_DROP_END_ID)
    return endHit ? [endHit] : rootHits
  }

  const folderContainers = args.droppableContainers.filter((container) => {
    const id = String(container.id)
    return !isTagDragId(id) && !isRootDropId(id)
  })
  const pointerHits = pointerWithin({ ...args, droppableContainers: folderContainers })
  if (pointerHits.length > 0) return pointerHits
  return closestCenter({ ...args, droppableContainers: folderContainers })
}

/**
 * Shared folder tree chrome for /folders: same nav-row + folder mark as
 * Communication, with expand chevrons and optional whole-row drag (no grip).
 *
 * Drag: the tree stays put. A line shows where the folder will land.
 * Pointer Y picks the row, pointer X picks the indent. Multi-tag rows can
 * drag a tag chip onto another map.
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
  const dropPlacementRef = useRef<FolderDragPlacement | null>(null)
  const [dropLine, setDropLine] = useState<DropLine | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  /** Tag-move highlight (folder rows). Folder drags use the insertion line. */
  const [nestOverId, setNestOverId] = useState<string | null>(null)
  /** Auto-expand nest targets while dragging so the live nest preview is visible. */
  const [dragExpandIds, setDragExpandIds] = useState<Set<string>>(() => new Set())

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
    dragSnapshotRef.current = null
    dropPlacementRef.current = null
    setDropLine(null)
    setDraggingId(null)
    setNestOverId(null)
    setDragExpandIds(new Set())
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
    dragSnapshotRef.current = localSourcesRef.current
    const activeId = String(event.active.id)
    setDraggingId(activeId)
    setNestOverId(null)
    setDragExpandIds(new Set())
    folderGrabOffsetX = 12
    dropPlacementRef.current = null
    setDropLine(null)
    const pointer = event.activatorEvent
    const rail = treeRailRef.current
    if (
      rail &&
      pointer &&
      'clientX' in pointer &&
      typeof pointer.clientX === 'number'
    ) {
      const row = rail.querySelector<HTMLElement>(
        `[data-folder-id="${activeId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`,
      )
      const rect = row?.getBoundingClientRect()
      if (rect) folderGrabOffsetX = pointer.clientX - rect.left
    }
  }

  const expandWhileDragging = (folderId: string) => {
    setDragExpandIds((prev) => {
      if (prev.has(folderId)) return prev
      const next = new Set(prev)
      next.add(folderId)
      return next
    })
  }

  /** Indent-aware live jump; runs on move (X) and over (Y / target) changes. */
  const previewFolderFromPointer = (activeId: string, overRaw: string | null) => {
    const rail = activeFolderTreeRail
    const snap = dragSnapshotRef.current ?? localSourcesRef.current
    if (!rail) return

    const coords = {
      x: lastFolderPointer.x,
      y: lastFolderPointer.y,
    }
    if (coords.x === 0 && coords.y === 0 && overRaw) {
      const overEl = rail.querySelector(
        `[data-folder-id="${overRaw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`,
      )
      const rect = overEl?.getBoundingClientRect()
      if (rect) {
        coords.x = rect.left + 12
        coords.y = rect.top + rect.height / 2
      }
    }

    const blocked = blockedNestTargets(deriveFolderTree(snap), activeId)
    const placement = resolvePointerFolderPlacement(
      coords,
      rail,
      snap,
      activeId,
      blocked,
    )
    if (!placement) return

    dropPlacementRef.current = placement
    const tree = deriveFolderTree(snap)
    const depthById = new Map(folderFilterRows(tree).map((row) => [row.id, row.depth]))
    const targetId = placement.mode === 'nest' ? placement.parentId : placement.overId
    const row = rail.querySelector<HTMLElement>(
      `[data-folder-row][data-folder-id="${targetId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`,
    )
    if (!row) {
      setDropLine(null)
      return
    }
    const rect = row.getBoundingClientRect()
    const railRect = rail.getBoundingClientRect()
    const depth =
      placement.mode === 'nest'
        ? (depthById.get(placement.parentId) ?? 0) + 1
        : placement.parentId == null
          ? 0
          : (depthById.get(placement.overId) ?? 0)
    const edgeTop =
      placement.mode === 'nest' || placement.edge === 'after' ? rect.bottom : rect.top
    setDropLine({
      top: edgeTop - railRect.top,
      left: FOLDER_TREE_BASE_PAD_PX + depth * FOLDER_TREE_INDENT_PX,
    })
  }

  const onDragMove = (event: DragMoveEvent) => {
    const activeId = String(event.active.id)
    if (parseTagDragId(activeId)) return
    previewFolderFromPointer(activeId, event.over ? String(event.over.id) : null)
  }

  const onDragOver = (event: DragOverEvent) => {
    const activeId = String(event.active.id)
    const activeTagDrag = parseTagDragId(activeId)
    const overId = event.over?.id
    const rootPlace = rootPlaceFromDropId(overId)
    if (rootPlace) {
      setNestOverId(String(overId))
      if (!activeTagDrag) previewUnnestToRoot(activeId, rootPlace)
      return
    }

    const overRaw = event.over ? String(event.over.id) : null

    // Tag chip → highlight the folder under the pointer (move target).
    if (activeTagDrag) {
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

    setNestOverId(null)
    previewFolderFromPointer(activeId, overRaw)
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
          defaultValue: 'Moved {{tag}} to the top level',
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

  const persistParentMove = async (
    folderId: string,
    nextParent: string | null,
    preDrag: FolderNavSource[],
  ) => {
    const before = preDrag.find((source) => source.id === folderId)
    if (!before) return
    const previousParent = before.parent_id ?? null
    if ((previousParent ?? null) === (nextParent ?? null)) return
    const previousOrders = preDrag.map((source) => ({
      id: source.id,
      sort_order: source.sort_order ?? 0,
    }))
    const current = localSourcesRef.current
    const sibs = folderFilterSiblings(deriveFolderTree(current), folderId)
    const siblingIds = sibs ? sibs.siblings.map((node) => node.id) : [folderId]
    try {
      await nestFolder(folderId, nextParent)
      await Promise.all(siblingIds.map((id, index) => patchProject(id, { sort_order: index })))
      const label =
        nextParent == null
          ? t('projects.detail.unnested', { defaultValue: 'Map moved to the top level' })
          : t('projects.detail.nested', { defaultValue: 'Folder nested' })
      offerUndo(label, async () => {
        await nestFolder(folderId, previousParent)
        await Promise.all(
          previousOrders.map((row) => patchProject(row.id, { sort_order: row.sort_order })),
        )
        onChanged?.()
      })
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

    if (!enableDrag || (!overRaw && (tagDrag || !dropPlacementRef.current))) {
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

    const placement = dropPlacementRef.current
    const next = placement ? optimisticApplyFolderPlacement(preDrag, activeId, placement) : null
    if (next) setSourcesOptimistic(next)

    const before = preDrag.find((source) => source.id === activeId)
    const after = localSourcesRef.current.find((source) => source.id === activeId)
    if (!before || !after) {
      if (preDrag) setSourcesOptimistic(preDrag)
      clearDrag()
      return
    }

    const prevParent = before.parent_id ?? null
    const nextParent = after.parent_id ?? null
    const nestBlockedAtDrop = blockedNestTargets(deriveFolderTree(preDrag), activeId)

    if (nextParent != null && nestBlockedAtDrop.has(nextParent)) {
      setSourcesOptimistic(preDrag)
      clearDrag()
      return
    }

    if (prevParent !== nextParent) {
      if (nextParent && !open.has(nextParent)) onToggle(nextParent)
      clearDrag()
      void persistParentMove(activeId, nextParent, preDrag)
      return
    }

    const treeAtDrop = deriveFolderTree(localSourcesRef.current)
    const sibs = folderFilterSiblings(treeAtDrop, activeId)
    if (sibs) {
      const siblingIds = sibs.siblings.map((sibling) => sibling.id)
      const orderChanged = siblingIds.some((id, index) => {
        const row = preDrag.find((source) => source.id === id)
        return (row?.sort_order ?? 0) !== index
      })
      clearDrag()
      if (orderChanged) void persistSiblingOrder(siblingIds, preDrag)
      return
    }

    clearDrag()
  }

  if (tree.length === 0) {
    return <>{empty ?? null}</>
  }

  const showRootDrop = Boolean(draggingTag)

  const rows = (
    <div ref={treeRailRef} className={cn('relative space-y-px', className)}>
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
          draggingTag={draggingTag}
          nestOverId={nestOverId}
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
      {dropLine ? (
        <div
          className="pointer-events-none absolute z-30 h-0.5 bg-text-heading"
          style={{ top: dropLine.top - 1, left: dropLine.left, right: 8 }}
          aria-hidden
        >
          <span className="absolute -left-1 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-text-heading" />
        </div>
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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={folderCollision}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragOver={onDragOver}
      onDragEnd={(e) => void onDragEnd(e)}
      onDragCancel={() => {
        const snap = dragSnapshotRef.current ?? sources
        clearDrag()
        setSourcesOptimistic(snap)
      }}
    >
      {body}
      {draggingTag ? (
        <DragOverlay
          dropAnimation={{
            duration: 160,
            easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
        >
          <div className="pointer-events-none scale-[1.03] shadow-overlay">
            <TagPill names={draggingTag.tag} tone="free" size="sm" selected />
          </div>
        </DragOverlay>
      ) : null}
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
        defaultValue: 'Drop to place {{tag}} at the top level',
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
          ? 'border-border bg-bg-hover text-text-secondary'
          : 'border-border/55 bg-bg-hover/30 text-text-muted',
      )}
    >
      <ArrowUpToLine size={12} className="shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </div>
  )
}

/** Folder tree row: Communication-style mark + name (labels live on detail / cards). */
function FolderRowChrome({
  node,
  trailing,
}: {
  node: FolderFilterNode
  trailing?: ReactNode
}) {
  const name = labelFor(node)
  return (
    <>
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-muted" aria-hidden>
        <FolderIcon size={15} />
      </span>
      <span className="min-w-0 flex-1 truncate-fade text-sm">{name}</span>
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
  draggingTag,
  nestOverId,
}: {
  node: FolderFilterNode
  open: Set<string>
  onToggle: (id: string) => void
  activeId?: string | null
  enableDrag: boolean
  href: (id: string) => string
  parentTagNames?: string[] | null
  draggingTag: { folderId: string; tag: string } | null
  nestOverId: string | null
}) {
  const { t } = useTranslation('nav')
  const expanded = open.has(node.id)
  const hasChildren = node.children.length > 0
  const isActive = activeId === node.id
  const rowLabel = labelFor(node, parentTagNames)
  const rowTitle = rowLabel

  const sortable = useSortable({
    id: node.id,
    disabled: !enableDrag,
  })
  const tagTargetLit = Boolean(draggingTag && nestOverId === node.id)

  // Shared .nav-tree-children: border sits under the parent folder mark.
  const childList = (
    <div className="nav-tree-children !ml-4">
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
          draggingTag={draggingTag}
          nestOverId={nestOverId}
        />
      ))}
    </div>
  )

  return (
    <div
      ref={enableDrag ? sortable.setNodeRef : undefined}
      data-folder-id={node.id}
      className={cn(
        'relative block shrink-0 space-y-px',
        sortable.isDragging && 'z-10 opacity-40',
      )}
    >
      <div
        className={cn(
          'group/row relative flex !h-8 items-center rounded-md transition-[background-color,box-shadow,opacity] duration-150',
          tagTargetLit && 'bg-bg-hover',
          enableDrag && 'cursor-grab active:cursor-grabbing',
        )}
        data-folder-row=""
        data-folder-id={node.id}
        {...(enableDrag ? { ...sortable.attributes, ...sortable.listeners } : {})}
      >
        {/*
          Leading mark is 16px (px-2 + half the box = 16px). The child border
          uses ml-4 so it stays under that mark. Chevron trails on the right.
        */}
        <NavLink
          to={href(node.id)}
          draggable={false}
          className={cn(
            'nav-row group !h-8 min-w-0 flex-1 overflow-hidden text-left text-sm',
            hasChildren ? 'pr-7' : 'pr-2',
            sortable.isDragging && 'pointer-events-none',
          )}
          title={rowTitle}
          data-active={isActive ? 'true' : undefined}
        >
          <FolderRowChrome node={node} />
        </NavLink>
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
            className="absolute right-0.5 z-10 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted hover:bg-bg-hover/80 hover:text-text-secondary"
          >
            <ChevronRight
              size={14}
              className={cn('transition-transform duration-150', expanded && 'rotate-90')}
              aria-hidden
            />
          </button>
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
