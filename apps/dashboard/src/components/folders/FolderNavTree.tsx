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
  useDraggable,
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
  filtersetLabel,
  filtersetLocalNames,
  filtersetPlainLabel,
  folderAncestorChain,
  folderFilterSiblings,
  optimisticUnnestToRoot,
  previewNestMerge,
  resolveSiblingReorderTarget,
  type FolderFilterNode,
  type FolderFilterSource,
} from '../../lib/folder-filter-tree'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { useConfirm } from '../ui/confirm-dialog'
import { Hashtag } from '../ui/HashtagMark'
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
/** Droppable id for the top-level (unnest / tag-to-root) zone. */
const ROOT_DROP_ID = 'folder-root-drop'

/** Active tree rail while dragging — collision uses its midpoint (left=reorder, right=nest). */
let activeFolderTreeRail: HTMLElement | null = null
/** Last half under the pointer; collision detection updates this each move. */
let lastFolderDragHalf: 'left' | 'right' = 'left'

function nestDropId(folderId: string): string {
  return `${NEST_PREFIX}${folderId}`
}

function parseNestDropId(id: UniqueIdentifier | null | undefined): string | null {
  const raw = id == null ? '' : String(id)
  return raw.startsWith(NEST_PREFIX) ? raw.slice(NEST_PREFIX.length) : null
}

function isRootDropId(id: UniqueIdentifier | null | undefined): boolean {
  return id != null && String(id) === ROOT_DROP_ID
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

function labelFor(node: FolderFilterNode, parentTagNames?: string[] | null): string {
  if (node.tag_names.length) {
    return filtersetPlainLabel(filtersetLocalNames(node.tag_names, parentTagNames))
  }
  return node.name.replace(/^#/, '')
}

/**
 * Left half of the tree rail → reorder (folder droppables only).
 * Right half → nest (nest droppables; folder hits map to nest:id).
 */
const folderCollision: CollisionDetection = (args) => {
  const rootContainers = args.droppableContainers.filter((container) =>
    isRootDropId(container.id),
  )
  const rootHits = pointerWithin({ ...args, droppableContainers: rootContainers })
  if (rootHits.length > 0) return rootHits

  const folderContainers = args.droppableContainers.filter((container) => {
    const id = String(container.id)
    return !id.startsWith(NEST_PREFIX) && !isTagDragId(id) && !isRootDropId(id)
  })
  const nestContainers = args.droppableContainers.filter((container) =>
    String(container.id).startsWith(NEST_PREFIX),
  )

  if (isTagDragId(String(args.active.id))) {
    lastFolderDragHalf = 'right'
    const nestHits = pointerWithin({ ...args, droppableContainers: nestContainers })
    if (nestHits.length > 0) return nestHits
    const pointerHits = pointerWithin({ ...args, droppableContainers: folderContainers })
    if (pointerHits.length > 0) return pointerHits
    return closestCenter({ ...args, droppableContainers: folderContainers })
  }

  const half = pointerDragHalf(args.pointerCoordinates)
  lastFolderDragHalf = half

  if (half === 'right') {
    const nestHits = pointerWithin({ ...args, droppableContainers: nestContainers })
    if (nestHits.length > 0) return nestHits
    const folderPointerHits = pointerWithin({ ...args, droppableContainers: folderContainers })
    const folderHits =
      folderPointerHits.length > 0
        ? folderPointerHits
        : closestCenter({ ...args, droppableContainers: folderContainers })
    if (folderHits.length > 0) {
      const folderId = String(folderHits[0]!.id)
      const nestHit = nestContainers.find((container) => String(container.id) === nestDropId(folderId))
      if (nestHit) return [{ id: nestHit.id }]
    }
    return closestCenter({ ...args, droppableContainers: nestContainers })
  }

  // Left half: reorder only — ignore nest strips entirely.
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
  const confirm = useConfirm()
  // Optimistic tree order — updates while dragging so drop does not snap back.
  const [localSources, setLocalSources] = useState(sources)
  const localSourcesRef = useRef(sources)
  const draggingRef = useRef(false)
  const treeRailRef = useRef<HTMLDivElement | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [nestOverId, setNestOverId] = useState<string | null>(null)

  useEffect(() => {
    if (draggingRef.current) return
    localSourcesRef.current = sources
    setLocalSources(sources)
  }, [sources])

  const tree = useMemo(() => deriveFolderTree(localSources), [localSources])
  const draggingTag = useMemo(() => parseTagDragId(draggingId), [draggingId])
  const draggingFolderId = draggingTag || !draggingId ? null : draggingId
  const nestBlocked = useMemo(() => {
    if (draggingTag) return new Set([draggingTag.folderId])
    return blockedNestTargets(tree, draggingFolderId)
  }, [tree, draggingTag, draggingFolderId])
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
    activeFolderTreeRail = null
    lastFolderDragHalf = 'left'
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
    activeFolderTreeRail = treeRailRef.current
    lastFolderDragHalf = 'left'
    setDraggingId(String(event.active.id))
    setNestOverId(null)
  }

  const onDragOver = (event: DragOverEvent) => {
    const activeId = String(event.active.id)
    const activeTagDrag = parseTagDragId(activeId)
    if (isRootDropId(event.over?.id)) {
      setNestOverId(ROOT_DROP_ID)
      return
    }

    const overRaw = event.over ? String(event.over.id) : null
    const nestId = parseNestDropId(event.over?.id)
    const half = lastFolderDragHalf

    // Tag chip → highlight the folder under the pointer (move target).
    if (activeTagDrag) {
      if (!overRaw) {
        setNestOverId(null)
        return
      }
      const targetId = resolveFolderDropTarget(overRaw, null)
      setNestOverId(targetId && !nestBlocked.has(targetId) ? targetId : null)
      return
    }

    // Right half of the rail: nest only — never shuffle order.
    if (half === 'right') {
      const nestTarget =
        nestId ??
        (overRaw && !isRootDropId(overRaw) && !parseTagDragId(overRaw) ? overRaw : null) ??
        null
      if (nestTarget && !nestBlocked.has(nestTarget)) {
        setNestOverId(nestTarget)
        return
      }
      setNestOverId(null)
      return
    }

    // Left half: reorder only — never nest.
    setNestOverId(null)
    if (!overRaw || nestId || isRootDropId(overRaw) || parseTagDragId(overRaw)) return
    const treeNow = deriveFolderTree(localSourcesRef.current)
    const reorderOverId = resolveSiblingReorderTarget(treeNow, activeId, overRaw)
    if (!reorderOverId) return
    const moved = reorderSiblingSources(localSourcesRef.current, activeId, reorderOverId)
    if (moved) setSourcesOptimistic(moved.sources)
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

  const runUnnestToRoot = async (folderId: string) => {
    const snapshot = localSourcesRef.current
    const before = snapshot.find((source) => source.id === folderId)
    if (!before) return
    const previousTags = (before.tag_names ?? []).map(bareTag).filter(Boolean)
    const optimistic = optimisticUnnestToRoot(snapshot, folderId)
    if (!optimistic) {
      toast.error(
        t('projects.detail.unnestBlocked', {
          defaultValue: 'This map is already at the top level',
        }),
      )
      return
    }
    const next = optimistic.find((source) => source.id === folderId)
    const nextTags = (next?.tag_names ?? []).map(bareTag).filter(Boolean)
    if (!nextTags.length) return
    setSourcesOptimistic(optimistic)
    try {
      await patchProject(folderId, { tags: nextTags })
      offerUndo(
        t('projects.detail.unnested', {
          defaultValue: 'Map moved to the top level',
        }),
        async () => {
          if (!previousTags.length) return
          await patchProject(folderId, { tags: previousTags })
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
    const optimistic = optimisticRemoveTag(snapshot, fromId, bare)
    if (!optimistic) return
    const nextFrom = optimistic.find((source) => source.id === fromId)
    if (!nextFrom) return
    setSourcesOptimistic(optimistic)
    try {
      await patchProject(fromId, { tags: (nextFrom.tag_names ?? []).map(bareTag).filter(Boolean) })
      let createdId: string | null = null
      let createdName: string | null = null
      if (!existing) {
        const created = await createProject({ tags: [bare] })
        createdId = created.id
        createdName = created.name
      }
      offerUndo(
        t('projects.detail.tagMovedToRoot', {
          defaultValue: 'Moved #{{tag}} to the top level',
          tag: bare,
        }),
        async () => {
          await patchProject(fromId, { tags: previousFrom })
          if (createdId && createdName) {
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
    const tagDrag = parseTagDragId(activeId)
    const dropOnRoot = isRootDropId(overRaw) || nestOverId === ROOT_DROP_ID
    const dropFolderId = dropOnRoot ? null : resolveFolderDropTarget(overRaw, nestOverId)

    if (!enableDrag || !overRaw) {
      clearDrag()
      return
    }

    if (dropOnRoot) {
      clearDrag()
      if (tagDrag) {
        void runMoveTagToRoot(tagDrag.folderId, tagDrag.tag)
        return
      }
      void runUnnestToRoot(activeId)
      return
    }

    if (tagDrag) {
      clearDrag()
      if (!dropFolderId || dropFolderId === tagDrag.folderId) return
      void runMoveTag(tagDrag.folderId, dropFolderId, tagDrag.tag)
      return
    }

    const treeAtDrop = deriveFolderTree(localSourcesRef.current)
    const blocked = blockedNestTargets(treeAtDrop, activeId)
    const snapshot = sources
    const half = lastFolderDragHalf

    // Right half: nest under the map under the pointer.
    if (half === 'right') {
      const nestParentId =
        parseNestDropId(overRaw) ??
        (nestOverId && nestOverId !== ROOT_DROP_ID ? nestOverId : null) ??
        (overRaw && !parseTagDragId(overRaw) ? overRaw : null)
      clearDrag()
      if (nestParentId && !blocked.has(nestParentId) && nestParentId !== activeId) {
        void runNest(activeId, nestParentId, blocked)
      }
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
      void persistSiblingOrder(moved.siblingIds, snapshot)
      return
    }

    clearDrag()
    if (reorderOverId) {
      const sibs = folderFilterSiblings(treeAtDrop, activeId)
      if (sibs) {
        void persistSiblingOrder(
          sibs.siblings.map((sibling) => sibling.id),
          snapshot,
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
  const rootDropHighlight = nestOverId === ROOT_DROP_ID

  const rows = (
    <div ref={treeRailRef} className={cn('space-y-px', className)}>
      {enableDrag ? (
        <RootDropZone
          active={showRootDrop}
          highlight={rootDropHighlight}
          movingTag={Boolean(draggingTag)}
          tagName={draggingTag?.tag ?? null}
        />
      ) : null}
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
          draggingTag={draggingTag}
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

  const dragNode = draggingFolderId ? findNode(tree, draggingFolderId) : null

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
        {draggingTag ? (
          <div className="pointer-events-none inline-flex h-[22px] items-center rounded-md border border-accent/40 bg-bg-surface/95 px-1.5 text-xs shadow-overlay backdrop-blur-sm">
            <Hashtag name={draggingTag.tag} />
          </div>
        ) : dragNode ? (
          <div className="pointer-events-none flex h-[26px] items-center gap-2 rounded-md border border-accent/35 bg-bg-surface/95 px-2 text-xs shadow-overlay backdrop-blur-sm">
            <FolderRowChrome node={dragNode} parentTagNames={null} enableDrag={false} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function RootDropZone({
  active,
  highlight,
  movingTag,
  tagName,
}: {
  active: boolean
  highlight: boolean
  movingTag: boolean
  tagName: string | null
}) {
  const { t } = useTranslation('nav')
  const { setNodeRef, isOver } = useDroppable({
    id: ROOT_DROP_ID,
    disabled: !active,
  })
  if (!active) return null
  const lit = highlight || isOver
  const hint = movingTag
    ? t('projects.detail.rootDropTagHint', {
        defaultValue: 'Drop to place #{{tag}} at the top level',
        tag: tagName ?? '',
      })
    : t('projects.detail.rootDropHint', {
        defaultValue: 'Drop to move this map to the top level',
      })
  const label = movingTag
    ? t('projects.detail.rootDropTagLabel', { defaultValue: 'Top level' })
    : t('projects.detail.rootDropLabel', { defaultValue: 'Top level' })
  return (
    <div
      ref={setNodeRef}
      title={hint}
      aria-label={hint}
      className={cn(
        'mb-0.5 flex h-[26px] items-center gap-1.5 rounded-md border border-dashed px-2 text-2xs font-medium transition-[background-color,border-color,color] duration-150',
        lit
          ? 'border-accent/50 bg-accent/12 text-accent'
          : 'border-border/55 bg-bg-hover/30 text-text-muted',
      )}
    >
      <ArrowUpToLine size={12} className="shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </div>
  )
}

/** Local tags as separate chips — hover pill + optional per-tag drag. */
function FolderRowChrome({
  node,
  parentTagNames,
  enableDrag = false,
  isActive = false,
  trailing,
}: {
  node: FolderFilterNode
  parentTagNames?: string[] | null
  enableDrag?: boolean
  isActive?: boolean
  trailing?: ReactNode
}) {
  const names = node.tag_names.length
    ? filtersetLocalNames(node.tag_names, parentTagNames)
    : [bareTag(node.name)].filter(Boolean)
  // Only multi-tag filtersets can lend a tag out; a lone tag is the map itself.
  const canDragTags = Boolean(enableDrag && node.tag_names.length > 1)
  return (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {names.map((name, index) => (
          <span key={`${name}-${index}`} className="inline-flex min-w-0 items-center gap-0.5">
            {index > 0 ? (
              <span aria-hidden className="shrink-0 px-0.5 text-text-muted/55">
                ·
              </span>
            ) : null}
            <FolderTagChip
              folderId={node.id}
              name={name}
              enableDrag={canDragTags}
              isActive={isActive}
            />
          </span>
        ))}
      </span>
      {trailing}
    </>
  )
}

function folderTagChipClass(isActive: boolean, enableDrag: boolean, isDragging = false) {
  return cn(
    'inline-flex max-w-full min-w-0 items-center rounded-md px-1 py-0.5 text-xs transition-colors duration-150',
    isActive ? 'bg-accent/12 text-accent' : 'text-inherit hover:bg-bg-hover/70',
    enableDrag && 'cursor-grab active:cursor-grabbing',
    isDragging && 'opacity-35',
  )
}

function FolderTagChip({
  folderId,
  name,
  enableDrag,
  isActive,
}: {
  folderId: string
  name: string
  enableDrag: boolean
  isActive: boolean
}) {
  if (!enableDrag) {
    return (
      <span className={folderTagChipClass(isActive, false)}>
        <Hashtag name={name} className="min-w-0" />
      </span>
    )
  }
  return <DraggableFolderTagChip folderId={folderId} name={name} isActive={isActive} />
}

function DraggableFolderTagChip({
  folderId,
  name,
  isActive,
}: {
  folderId: string
  name: string
  isActive: boolean
}) {
  const { t } = useTranslation('nav')
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: tagDragId(folderId, name),
    data: { type: 'folder-tag', folderId, tag: name },
  })
  return (
    <span
      ref={setNodeRef}
      title={t('projects.detail.tagDragHint', {
        defaultValue: 'Drag to move #{{tag}} to another folder',
        tag: name,
      })}
      className={folderTagChipClass(isActive, true, isDragging)}
      {...attributes}
      {...listeners}
      onPointerDown={(event: ReactPointerEvent<HTMLSpanElement>) => {
        // Keep the row sortable from stealing the gesture.
        event.stopPropagation()
        listeners?.onPointerDown?.(event)
      }}
    >
      <Hashtag name={name} className="min-w-0" />
    </span>
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
  const movingTag = Boolean(draggingTag)
  const nestPreview =
    showNestZone && !movingTag && draggingTagNames
      ? previewNestMerge(draggingTagNames, node.tag_names)
      : null

  const { setNodeRef: nestRef, isOver: nestIsOver } = useDroppable({
    id: nestDropId(node.id),
    disabled: !showNestZone,
  })

  const style: CSSProperties = enableDrag
    ? {
        transform: CSS.Transform.toString(sortable.transform),
        // Overlay carries the dragged row; keep the slot so siblings can slide into place.
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
          draggingTag={draggingTag}
          draggingTagNames={draggingTagNames}
          nestOverId={nestOverId}
          nestBlocked={nestBlocked}
        />
      ))}
    </div>
  )

  const nestLit = nestHighlight || nestIsOver
  const nestHint = movingTag && draggingTag
    ? t('projects.detail.tagMoveHint', {
        defaultValue: 'Drop to move #{{tag}} into this folder',
        tag: draggingTag.tag,
      })
    : nestPreview
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
    <div
      ref={enableDrag ? sortable.setNodeRef : undefined}
      style={style}
      className={cn(
        'relative block shrink-0 space-y-px',
        // Whole branch (row + open children) is the gap so siblings slide aside.
        sortable.isDragging && 'opacity-0',
      )}
    >
      <div
        className={cn(
          'group/row relative flex h-[26px] items-center gap-0.5 rounded-md transition-[background-color,box-shadow,opacity] duration-150',
          nestLit && 'bg-accent/12 ring-1 ring-inset ring-accent/40',
          nestLit && nestPreview?.unrelated && 'ring-amber-400/50 bg-amber-500/10',
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
          draggable={false}
          className={cn(
            'nav-row group h-[26px] min-w-0 flex-1 overflow-hidden pr-8 text-left text-xs',
            isActive && 'text-accent',
          )}
          title={rowTitle}
          data-active={isActive ? 'true' : undefined}
        >
          <FolderRowChrome
            node={node}
            parentTagNames={parentTagNames}
            enableDrag={enableDrag}
            isActive={isActive}
          />
        </NavLink>

        {showNestZone ? (
          <div
            ref={nestRef}
            title={nestHint}
            className={cn(
              // Right half of the row mirrors the rail rule: right = nest, left = order.
              'absolute inset-y-0.5 right-0 z-10 flex w-1/2 items-center justify-end rounded-md px-1.5 transition-[background-color,box-shadow,opacity] duration-150',
              nestLit
                ? 'bg-accent/25 shadow-[-8px_0_14px_-10px_rgba(52,211,153,0.65)]'
                : 'bg-gradient-to-l from-accent/[0.14] via-accent/[0.05] to-transparent',
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
                {movingTag
                  ? t('projects.detail.tagMoveLabel', { defaultValue: 'Move tag' })
                  : nestLit && nestPreview
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
