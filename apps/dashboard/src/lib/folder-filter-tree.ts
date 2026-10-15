/** Folder tree from stored ``parent_id`` (matches backend ``derive_tree``). */

export type FolderFilterSource = {
  id: string
  name: string
  tag_ids: string[]
  tag_names?: string[]
  sort_order?: number
  parent_id?: string | null
}

export type FolderFilterNode = {
  id: string
  name: string
  tag_ids: string[]
  tag_names: string[]
  sort_order: number
  parent_id: string | null
  children: FolderFilterNode[]
}

export type FolderFilterRow = {
  id: string
  name: string
  tag_ids: string[]
  tag_names: string[]
  sort_order: number
  depth: number
  parentId: string | null
}

function compareFolders(a: FolderFilterSource, b: FolderFilterSource): number {
  const ao = a.sort_order ?? 0
  const bo = b.sort_order ?? 0
  if (ao !== bo) return ao - bo
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

function toNode(source: FolderFilterSource): FolderFilterNode {
  return {
    id: source.id,
    name: source.name,
    tag_ids: [...source.tag_ids],
    tag_names: source.tag_names?.length ? [...source.tag_names] : [],
    sort_order: source.sort_order ?? 0,
    parent_id: source.parent_id ?? null,
    children: [],
  }
}

/** Roots and nested children from stored parent_id. */
export function deriveFolderTree(sources: FolderFilterSource[]): FolderFilterNode[] {
  if (sources.length === 0) return []

  const known = new Set(sources.map((row) => row.id))
  const childrenByParent = new Map<string | null, FolderFilterSource[]>()
  for (const folder of sources) {
    const parentId =
      folder.parent_id && known.has(folder.parent_id) ? folder.parent_id : null
    const group = childrenByParent.get(parentId) ?? []
    group.push(folder)
    childrenByParent.set(parentId, group)
  }
  for (const group of childrenByParent.values()) {
    group.sort(compareFolders)
  }

  const build = (parentId: string | null): FolderFilterNode[] =>
    (childrenByParent.get(parentId) ?? []).map((source) => {
      const node = toNode(source)
      node.children = build(source.id)
      return node
    })

  return build(null)
}

export function folderFilterRows(tree: FolderFilterNode[]): FolderFilterRow[] {
  const out: FolderFilterRow[] = []
  const walk = (nodes: FolderFilterNode[], parentId: string | null, depth: number) => {
    for (const node of nodes) {
      out.push({
        id: node.id,
        name: node.name,
        tag_ids: node.tag_ids,
        tag_names: node.tag_names,
        sort_order: node.sort_order,
        depth,
        parentId,
      })
      walk(node.children, node.id, depth + 1)
    }
  }
  walk(tree, null, 0)
  return out
}

/** Every folder nested under `rootId` in the tree (includes `rootId`). */
export function folderFilterSubtreeIds(tree: FolderFilterNode[], rootId: string): Set<string> {
  const find = (nodes: FolderFilterNode[]): FolderFilterNode | null => {
    for (const node of nodes) {
      if (node.id === rootId) return node
      const below = find(node.children)
      if (below) return below
    }
    return null
  }
  const root = find(tree)
  const out = new Set<string>()
  if (!root) {
    out.add(rootId)
    return out
  }
  const walk = (node: FolderFilterNode) => {
    out.add(node.id)
    for (const child of node.children) walk(child)
  }
  walk(root)
  return out
}

/** Plain join for aria/tooltips next to typographic HashtagSet. */
export function filtersetPlainLabel(tagNames: string[]): string {
  return tagNames.map((name) => name.replace(/^#/, '')).filter(Boolean).join(' · ')
}

/** With `#` prefixes — copy, tooltips, and non-React surfaces. */
export function filtersetLabel(tagNames: string[]): string {
  return tagNames.map((name) => `#${name.replace(/^#/, '')}`).join(' · ')
}

/**
 * Labels that distinguish this folder from its parent in a layered tree /
 * breadcrumb. Full label set stays for titles; nested rows may show only the delta.
 */
export function filtersetLocalNames(
  tagNames: string[],
  parentTagNames?: string[] | null,
): string[] {
  const mine = tagNames.map((name) => name.replace(/^#/, '')).filter(Boolean)
  if (!parentTagNames?.length) return mine
  const parent = new Set(parentTagNames.map((name) => name.replace(/^#/, '').toLowerCase()))
  const local = mine.filter((name) => !parent.has(name.toLowerCase()))
  return local.length > 0 ? local : mine
}

/** Siblings of `folderId` under the same parent (ordered). */
export function folderFilterSiblings(
  tree: FolderFilterNode[],
  folderId: string,
): { parentId: string | null; siblings: FolderFilterNode[] } | null {
  const walk = (
    nodes: FolderFilterNode[],
    parentId: string | null,
  ): { parentId: string | null; siblings: FolderFilterNode[] } | null => {
    if (nodes.some((node) => node.id === folderId)) {
      return { parentId, siblings: nodes }
    }
    for (const node of nodes) {
      const hit = walk(node.children, node.id)
      if (hit) return hit
    }
    return null
  }
  return walk(tree, null)
}

/**
 * When the pointer is over a nested row (or its nest zone’s folder), map that
 * hit to the same-level sibling of `activeId` we should reorder against —
 * usually an ancestor of `overId`. Returns null when no sibling reorder applies.
 */
export function resolveSiblingReorderTarget(
  tree: FolderFilterNode[],
  activeId: string,
  overId: string,
): string | null {
  if (!activeId || !overId || activeId === overId) return null
  const activeSibs = folderFilterSiblings(tree, activeId)
  if (!activeSibs) return null
  const isSibling = (id: string) => activeSibs.siblings.some((sibling) => sibling.id === id)
  if (isSibling(overId)) return overId
  const ancestors = folderAncestorChain(tree, overId)
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const ancestorId = ancestors[i]!.id
    if (ancestorId === activeId) return null
    if (isSibling(ancestorId)) return ancestorId
  }
  return null
}

/** Find a node by id in a tree. */
export function findFolderNode(tree: FolderFilterNode[], id: string): FolderFilterNode | null {
  for (const node of tree) {
    if (node.id === id) return node
    const nested = findFolderNode(node.children, id)
    if (nested) return nested
  }
  return null
}

/** Ancestors of `folderId` (root → parent), excluding the folder itself. */
export function folderAncestorChain(tree: FolderFilterNode[], folderId: string): FolderFilterNode[] {
  const chain: FolderFilterNode[] = []
  const walk = (nodes: FolderFilterNode[], prefix: FolderFilterNode[]): boolean => {
    for (const node of nodes) {
      if (node.id === folderId) {
        chain.push(...prefix)
        return true
      }
      if (walk(node.children, [...prefix, node])) return true
    }
    return false
  }
  walk(tree, [])
  return chain
}

/**
 * Set parent_id to null so the folder becomes a root.
 * Returns null when already root.
 */
export function optimisticUnnestToRoot<T extends FolderFilterSource>(
  sources: T[],
  folderId: string,
): T[] | null {
  const folder = sources.find((source) => source.id === folderId)
  if (!folder || !folder.parent_id) return null
  return sources.map((source) =>
    source.id === folderId ? { ...source, parent_id: null } : source,
  )
}

export type RootPlace =
  | { at: 'start' }
  | { at: 'end' }
  | { at: 'before'; rootId: string }
  | { at: 'after'; rootId: string }

/**
 * Unnest to root and set root `sort_order` so the map appears at `place`
 * among the other roots (live DnD preview).
 */
export function optimisticUnnestToRootAt<T extends FolderFilterSource>(
  sources: T[],
  folderId: string,
  place: RootPlace = { at: 'end' },
): T[] | null {
  const unnested = optimisticUnnestToRoot(sources, folderId)
  if (!unnested) return null
  const tree = deriveFolderTree(unnested)
  const rootIds = tree.map((node) => node.id)
  if (!rootIds.includes(folderId)) return unnested
  const without = rootIds.filter((id) => id !== folderId)
  let nextRoots: string[]
  if (place.at === 'start') {
    nextRoots = [folderId, ...without]
  } else if (place.at === 'end') {
    nextRoots = [...without, folderId]
  } else {
    const idx = without.indexOf(place.rootId)
    if (idx < 0) {
      nextRoots = [...without, folderId]
    } else if (place.at === 'before') {
      nextRoots = [...without.slice(0, idx), folderId, ...without.slice(idx)]
    } else {
      nextRoots = [...without.slice(0, idx + 1), folderId, ...without.slice(idx + 1)]
    }
  }
  const order = new Map(nextRoots.map((id, index) => [id, index]))
  return unnested.map((source) => {
    const sortOrder = order.get(source.id)
    if (sortOrder == null) return source
    return { ...source, sort_order: sortOrder }
  })
}

/** Set parent_id so the folder nests under `parentId` (live DnD preview). */
export function optimisticNestSources<T extends FolderFilterSource>(
  sources: T[],
  activeId: string,
  parentId: string,
): T[] | null {
  if (activeId === parentId) return null
  const parent = sources.find((source) => source.id === parentId)
  const child = sources.find((source) => source.id === activeId)
  if (!parent || !child) return null
  if (child.parent_id === parentId) return null
  // Block nesting under own descendant.
  const tree = deriveFolderTree(sources)
  const blocked = folderFilterSubtreeIds(tree, activeId)
  if (blocked.has(parentId)) return null
  return sources.map((source) =>
    source.id === activeId ? { ...source, parent_id: parentId } : source,
  )
}

/** Top-level root id for a folder hit (itself if root, else first ancestor). */
export function rootFolderIdFor(tree: FolderFilterNode[], folderId: string): string | null {
  if (tree.some((node) => node.id === folderId)) return folderId
  const ancestors = folderAncestorChain(tree, folderId)
  return ancestors[0]?.id ?? null
}

export type NestMergePreview = {
  /** Parent tags + child tags (parent order first, then extras). */
  mergedNames: string[]
  /** Tags the child gains from the parent. */
  addedNames: string[]
  /** Tags already shared (case-insensitive). */
  sharedNames: string[]
  /** True when the child shared no tags with the parent before nest. */
  unrelated: boolean
  mergedLabel: string
  parentLabel: string
  childLabel: string
}

/**
 * @deprecated Nesting no longer unions labels. Kept for any leftover call sites.
 */
export function previewNestMerge(
  childTagNames: string[],
  parentTagNames: string[],
): NestMergePreview {
  const bareName = (name: string) => name.replace(/^#/, '').trim()
  const parentNames = parentTagNames.map(bareName).filter(Boolean)
  const childNames = childTagNames.map(bareName).filter(Boolean)
  const parentLower = new Set(parentNames.map((name) => name.toLowerCase()))
  const childLower = new Set(childNames.map((name) => name.toLowerCase()))
  const sharedNames = parentNames.filter((name) => childLower.has(name.toLowerCase()))
  const addedNames = parentNames.filter((name) => !childLower.has(name.toLowerCase()))
  const mergedNames = [
    ...parentNames,
    ...childNames.filter((name) => !parentLower.has(name.toLowerCase())),
  ]
  return {
    mergedNames,
    addedNames,
    sharedNames,
    unrelated: sharedNames.length === 0 && childNames.length > 0 && parentNames.length > 0,
    mergedLabel: filtersetLabel(mergedNames),
    parentLabel: filtersetLabel(parentNames),
    childLabel: filtersetLabel(childNames),
  }
}

/**
 * @deprecated Tree nesting is parent_id; create-dialog parent preview unused.
 */
export function predictFiltersetParent(
  _selectedTagNames: string[],
  _maps: { id: string; name: string; tag_names?: string[] | null }[],
): { id: string; name: string; tag_names: string[] } | null {
  return null
}
