import { useEffect, useState } from 'react'
import { getConnectionProjects } from './integrations-api'
import { listProjectResources } from './project-work-api'

/**
 * Connections linked only to this project. Deleting the project removes their
 * last link, so they become usable workspace-wide again.
 */
export function useProjectDeleteConnectionImpact(projectId: string | null): string[] {
  const [names, setNames] = useState<string[]>([])

  useEffect(() => {
    setNames([])
    if (!projectId) return
    let alive = true
    void (async () => {
      try {
        const links = (await listProjectResources(projectId)).filter(
          (r) => r.resource_type === 'connection' && r.connection_id,
        )
        const widened: string[] = []
        for (const link of links) {
          const res = await getConnectionProjects(link.connection_id as string).catch(() => null)
          if (res && res.projects.every((p) => p.id === projectId)) {
            widened.push(link.label || link.provider || (link.connection_id as string))
          }
        }
        if (alive) setNames(widened)
      } catch {
        if (alive) setNames([])
      }
    })()
    return () => {
      alive = false
    }
  }, [projectId])

  return names
}
