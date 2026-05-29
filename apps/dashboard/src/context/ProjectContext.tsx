import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { getProject, type ProjectRow } from '../lib/projects-api'

export type ProjectContextValue = {
  projectId: string
  project: ProjectRow | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>()
  const [project, setProject] = useState<ProjectRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!projectId) {
      setProject(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const row = await getProject(projectId)
      setProject(row)
    } catch (err) {
      setProject(null)
      setError(err instanceof Error ? err.message : 'Could not load project.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo(
    () => ({
      projectId: projectId ?? '',
      project,
      loading,
      error,
      refresh,
    }),
    [projectId, project, loading, error, refresh],
  )

  if (!projectId) {
    return <div className="p-6 text-sm text-text-muted">Project not found.</div>
  }

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}

export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectContext)
  if (!ctx) throw new Error('useProjectContext must be used within ProjectProvider')
  return ctx
}

export function useOptionalProjectContext(): ProjectContextValue | null {
  return useContext(ProjectContext)
}
