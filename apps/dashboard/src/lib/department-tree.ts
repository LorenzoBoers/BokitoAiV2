/** Department nesting for the Workforce organogram. */

export type DepartmentTreeSource = {
  id: string
  name: string
  parent_id?: string | null
}

export type DepartmentTreeNode<T extends DepartmentTreeSource> = {
  department: T
  children: DepartmentTreeNode<T>[]
}

function byName<T extends DepartmentTreeSource>(a: T, b: T): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

/** True when following parent_id from `parentId` returns to `id`. */
function parentChainCycles<T extends DepartmentTreeSource>(
  id: string,
  parentId: string,
  byId: ReadonlyMap<string, T>,
): boolean {
  const seen = new Set<string>([id])
  let current: string | null | undefined = parentId
  while (current) {
    if (seen.has(current)) return true
    seen.add(current)
    current = byId.get(current)?.parent_id
  }
  return false
}

/**
 * One tree per root. The department with no parent sits at the top.
 * Children hang under `parent_id`, sorted by name. A missing parent hangs
 * on that single root. A cycle stays beside the root and is not walked again.
 */
export function buildDepartmentForest<T extends DepartmentTreeSource>(
  departments: readonly T[],
): DepartmentTreeNode<T>[] {
  const unique: T[] = []
  const seenIds = new Set<string>()
  for (const department of departments) {
    if (seenIds.has(department.id)) continue
    seenIds.add(department.id)
    unique.push(department)
  }

  const byId = new Map(unique.map((department) => [department.id, department]))
  const childIds = new Map<string, T[]>()
  const topLevel: T[] = []

  for (const department of unique) {
    const parentId = department.parent_id ?? null
    const parent = parentId ? byId.get(parentId) : undefined
    if (!parent || parentChainCycles(department.id, parentId as string, byId)) {
      topLevel.push(department)
      continue
    }
    const siblings = childIds.get(parent.id) ?? []
    siblings.push(department)
    childIds.set(parent.id, siblings)
  }

  const structuralRoots = topLevel.filter((department) => !department.parent_id)
  const singleRoot = structuralRoots.length === 1 ? structuralRoots[0] : null
  const extras: T[] = []
  if (singleRoot) {
    for (const department of topLevel) {
      if (department.id === singleRoot.id) continue
      const parentId = department.parent_id
      if (parentId && !byId.has(parentId)) {
        const siblings = childIds.get(singleRoot.id) ?? []
        siblings.push(department)
        childIds.set(singleRoot.id, siblings)
      } else {
        extras.push(department)
      }
    }
  }

  function node(department: T, trail: Set<string>): DepartmentTreeNode<T> {
    if (trail.has(department.id)) return { department, children: [] }
    const next = new Set(trail)
    next.add(department.id)
    const children = [...(childIds.get(department.id) ?? [])].sort(byName)
    return {
      department,
      children: children.map((child) => node(child, next)),
    }
  }

  if (singleRoot) {
    const rest = [...extras].sort(byName).map((department) => node(department, new Set()))
    return [node(singleRoot, new Set()), ...rest]
  }
  return [...topLevel].sort(byName).map((department) => node(department, new Set()))
}
