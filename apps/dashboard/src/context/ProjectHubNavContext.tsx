import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  fetchProjectWorkerStatusMap,
  POLL_MS,
  type ProjectWorkerStatusMap,
} from '../lib/project-worker-status-aggregate'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import type { WorkerStatusSnapshot } from '../lib/project-worker-status'

export interface ProjectHubNavValue {
  projects: ProjectRow[]
  workerStatusByProjectId: ProjectWorkerStatusMap
  loading: boolean
  statusLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  getWorkerStatus: (projectId: string) => WorkerStatusSnapshot | null
}

const ProjectHubNavContext = createContext<ProjectHubNavValue | null>(null)

export function ProjectHubNavProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [workerStatusByProjectId, setWorkerStatusByProjectId] = useState<ProjectWorkerStatusMap>({})
  const [loading, setLoading] = useState(true)
  const [statusLoading, setStatusLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const projectsRef = useRef<ProjectRow[]>([])

  const refreshStatus = useCallback(async (rows: ProjectRow[]) => {
    if (rows.length === 0) {
      setWorkerStatusByProjectId({})
      return
    }
    setStatusLoading(true)
    try {
      const map = await fetchProjectWorkerStatusMap(rows)
      setWorkerStatusByProjectId(map)
    } catch {
      setWorkerStatusByProjectId({})
    } finally {
      setStatusLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listProjects()
      projectsRef.current = rows
      setProjects(rows)
      setLoading(false)
      await refreshStatus(rows)
    } catch (err) {
      setProjects([])
      projectsRef.current = []
      setWorkerStatusByProjectId({})
      setError(err instanceof Error ? err.message : 'Could not load projects.')
      setLoading(false)
    }
  }, [refreshStatus])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (projectsRef.current.length > 0) {
        void refreshStatus(projectsRef.current)
      }
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [refreshStatus])

  const getWorkerStatus = useCallback(
    (projectId: string) => workerStatusByProjectId[projectId] ?? null,
    [workerStatusByProjectId],
  )

  const value = useMemo<ProjectHubNavValue>(
    () => ({
      projects,
      workerStatusByProjectId,
      loading,
      statusLoading,
      error,
      refresh,
      getWorkerStatus,
    }),
    [projects, workerStatusByProjectId, loading, statusLoading, error, refresh, getWorkerStatus],
  )

  return <ProjectHubNavContext.Provider value={value}>{children}</ProjectHubNavContext.Provider>
}

export function useProjectHubNav(): ProjectHubNavValue {
  const ctx = useContext(ProjectHubNavContext)
  if (!ctx) throw new Error('useProjectHubNav must be used within ProjectHubNavProvider')
  return ctx
}

export function useOptionalProjectHubNav(): ProjectHubNavValue | null {
  return useContext(ProjectHubNavContext)
}

export function isProjectHubRoute(pathname: string): boolean {
  if (pathname === '/projects/new' || pathname.startsWith('/projects/new/')) return false
  return pathname.startsWith('/projects') || pathname.startsWith('/project/')
}
