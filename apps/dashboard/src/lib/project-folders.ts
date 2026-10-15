import {
  deriveFolderTree,
  folderFilterRows,
  folderFilterSubtreeIds,
  type FolderFilterNode,
  type FolderFilterSource,
} from './folder-filter-tree'

export type { FolderFilterNode, FolderFilterSource }

/** @deprecated Use `FolderFilterNode` */
export type FolderNode = FolderFilterNode

/** @deprecated Use `FolderFilterRow` from folder-filter-tree */
export type FolderRow = {
  id: string
  name: string
  parentId: string | null
  depth: number
  tag_ids: string[]
  tag_names: string[]
}

type FolderSource = FolderFilterSource & {
  parent_id?: string | null
}

function sources(projects: FolderSource[]): FolderFilterSource[] {
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    tag_ids: project.tag_ids ?? [],
    tag_names: project.tag_names,
    sort_order: project.sort_order,
    parent_id: project.parent_id ?? null,
  }))
}

/** Roots first, then nested by stored parent_id. */
export function folderRows(projects: FolderSource[]): FolderRow[] {
  const tree = deriveFolderTree(sources(projects))
  return folderFilterRows(tree).map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    depth: row.depth,
    tag_ids: row.tag_ids,
    tag_names: row.tag_names,
  }))
}

/** Roots with nested children from stored parent_id. */
export function folderTree(projects: FolderSource[]): FolderFilterNode[] {
  return deriveFolderTree(sources(projects))
}

/** This folder and every folder nested under it in the derived tree. */
export function folderSubtreeIds(projects: FolderSource[], rootId: string): Set<string> {
  return folderFilterSubtreeIds(folderTree(projects), rootId)
}
