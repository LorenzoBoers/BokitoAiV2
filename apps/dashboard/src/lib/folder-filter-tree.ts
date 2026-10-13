/** Smart folder tree: nesting by strict tag-set inclusion (matches backend `derive_tree` parent rules). */

export type FolderFilterSource = {
  id: string
  name: string
  tag_ids: string[]
  tag_names?: string[]
  sort_order?: number
}

export type FolderFilterNode = {
  id: string
  name: string
  tag_ids: string[]
  tag_names: string[]
  sort_order: number
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

function tagSet(ids: string[]): Set<string> {
  return new Set(ids)
}

function isProperSubset(sub: Set<string>, sup: Set<string>): boolean {
  if (sub.size >= sup.size) return false
  for (const id of sub) {
    if (!sup.has(id)) return false
  }
  return true
}

function compareFolders(a: FolderFilterSource, b: FolderFilterSource): number {
  const ao = a.sort_order ?? 0
  const bo = b.sort_order ?? 0
  if (ao !== bo) return ao - bo
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

function pickParent(
  folder: FolderFilterSource,
  others: FolderFilterSource[],
): FolderFilterSource | null {
  let best: FolderFilterSource | null = null
  const mine = tagSet(folder.tag_ids)
  for (const other of others) {
    if (other.id === folder.id) continue
    const otherSet = tagSet(other.tag_ids)
    if (!isProperSubset(otherSet, mine)) continue
    if (
      best === null ||
      other.tag_ids.length > best.tag_ids.length ||
      (other.tag_ids.length === best.tag_ids.length && compareFolders(other, best) < 0)
    ) {
      best = other
    }
  }
  return best
}

function toNode(source: FolderFilterSource): FolderFilterNode {
  return {
    id: source.id,
    name: source.name,
    tag_ids: [...source.tag_ids],
    tag_names: source.tag_names?.length ? [...source.tag_names] : [],
    sort_order: source.sort_order ?? 0,
    children: [],
  }
}

/** Roots and nested children from filtersets (real folders only; no virtual clusters). */
export function deriveFolderTree(sources: FolderFilterSource[]): FolderFilterNode[] {
  const folders = sources.filter((row) => row.tag_ids.length > 0)
  if (folders.length === 0) return []

  const parentOf = new Map<string, string | null>()
  for (const folder of folders) {
    const parent = pickParent(folder, folders)
    parentOf.set(folder.id, parent?.id ?? null)
  }

  const childrenByParent = new Map<string | null, FolderFilterSource[]>()
  for (const folder of folders) {
    const parentId = parentOf.get(folder.id) ?? null
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

/** Every folder nested under `rootId` in the derived tree (includes `rootId`). */
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
 * Tags that distinguish this folder from its parent in a layered tree /
 * breadcrumb. Full filterset stays for titles; nested rows show only the delta.
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

function bareName(name: string): string {
  return name.replace(/^#/, '').trim()
}

/** Find a node by id in a derived tree. */
export function findFolderNode(tree: FolderFilterNode[], id: string): FolderFilterNode | null {
  for (const node of tree) {
    if (node.id === id) return node
    const nested = findFolderNode(node.children, id)
    if (nested) return nested
  }
  return null
}

/** Derived ancestors of `folderId` (root → parent), excluding the folder itself. */
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
 * Client-side preview of nest (= union parent tags into the child filterset).
 * Matches backend `nest_folder` merge order.
 */
export function previewNestMerge(
  childTagNames: string[],
  parentTagNames: string[],
): NestMergePreview {
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
 * Which existing map would become the derived parent of a draft filterset
 * (strict inclusion — same rule as `deriveFolderTree`).
 */
export function predictFiltersetParent(
  selectedTagNames: string[],
  maps: { id: string; name: string; tag_names?: string[] | null }[],
): { id: string; name: string; tag_names: string[] } | null {
  const mine = selectedTagNames.map(bareName).filter(Boolean)
  if (!mine.length) return null
  const mineLower = new Set(mine.map((name) => name.toLowerCase()))
  let best: { id: string; name: string; tag_names: string[] } | null = null
  for (const map of maps) {
    const other = (map.tag_names ?? []).map(bareName).filter(Boolean)
    if (!other.length || other.length >= mine.length) continue
    const otherLower = new Set(other.map((name) => name.toLowerCase()))
    let subset = true
    for (const name of otherLower) {
      if (!mineLower.has(name)) {
        subset = false
        break
      }
    }
    if (!subset) continue
    if (
      !best ||
      other.length > best.tag_names.length ||
      (other.length === best.tag_names.length &&
        map.name.localeCompare(best.name, undefined, { sensitivity: 'base' }) < 0)
    ) {
      best = { id: map.id, name: map.name, tag_names: other }
    }
  }
  return best
}
