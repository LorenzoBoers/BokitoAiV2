/** A project shown in a folder tree. Depth 0 is a root. */
export type FolderRow = {
  id: string
  name: string
  parentId: string | null
  depth: number
}

type FolderSource = {
  id: string
  name: string
  parent_id?: string | null
}

/** Roots first, then each folder's children, indented by depth. */
export function folderRows(projects: FolderSource[]): FolderRow[] {
  const byParent = new Map<string | null, FolderSource[]>()
  const ids = new Set(projects.map((project) => project.id))
  for (const project of projects) {
    const parentId = project.parent_id && ids.has(project.parent_id) ? project.parent_id : null
    const group = byParent.get(parentId) ?? []
    group.push(project)
    byParent.set(parentId, group)
  }
  const out: FolderRow[] = []
  const walk = (parentId: string | null, depth: number) => {
    const children = (byParent.get(parentId) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
    for (const child of children) {
      out.push({ id: child.id, name: child.name, parentId, depth })
      walk(child.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export type FolderNode = {
  id: string
  name: string
  children: FolderNode[]
}

/** Roots, with each folder's children nested. */
export function folderTree(projects: FolderSource[]): FolderNode[] {
  const byParent = new Map<string | null, FolderSource[]>()
  const ids = new Set(projects.map((project) => project.id))
  for (const project of projects) {
    const parentId = project.parent_id && ids.has(project.parent_id) ? project.parent_id : null
    const group = byParent.get(parentId) ?? []
    group.push(project)
    byParent.set(parentId, group)
  }
  const build = (parentId: string | null): FolderNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((project) => ({
        id: project.id,
        name: project.name,
        children: build(project.id),
      }))
  return build(null)
}

/** This folder and every folder inside it. */
export function folderSubtreeIds(projects: FolderSource[], rootId: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const project of projects) {
    if (!project.parent_id) continue
    const group = children.get(project.parent_id) ?? []
    group.push(project.id)
    children.set(project.parent_id, group)
  }
  const out = new Set<string>()
  const stack = [rootId]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || out.has(current)) continue
    out.add(current)
    stack.push(...(children.get(current) ?? []))
  }
  return out
}
