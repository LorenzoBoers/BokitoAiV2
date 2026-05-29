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
import { useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import {
  fetchProjectWorkerStatusMap,
  POLL_MS,
  type ProjectWorkerStatusMap,
} from '../lib/project-worker-status-aggregate'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import {
  listProjectWorkstreams,
  type ProjectPoAgent,
  type ProjectWorkstreamRow,
} from '../lib/workstreams-api'
import type { WorkerStatusSnapshot } from '../lib/project-worker-status'
import {
  projectHubScopeKey,
  readLastProjectId,
  writeLastProjectId,
} from '../lib/project-hub-last-opened'

export interface ProjectHubNavValue {
  projects: ProjectRow[]
  selectedProjectId: string | null
  setSelectedProjectId: (projectId: string) => void
  workstreams: ProjectWorkstreamRow[]
  poAgent: ProjectPoAgent | null
  workstreamsLoading: boolean
  workstreamsError: string | null
  refreshWorkstreams: () => Promise<void>
  workerStatusByProjectId: ProjectWorkerStatusMap
  loading: boolean
  statusLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  getWorkerStatus: (projectId: string) => WorkerStatusSnapshot | null
}

const ProjectHubNavContext = createContext<ProjectHubNavValue | null>(null)

export function ProjectHubNavProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [selectedProjectId, setSelectedProjectIdState] = useState<string | null>(null)
  const [workstreams, setWorkstreams] = useState<ProjectWorkstreamRow[]>([])
  const [poAgent, setPoAgent] = useState<ProjectPoAgent | null>(null)
  const [workstreamsLoading, setWorkstreamsLoading] = useState(false)
  const [workstreamsError, setWorkstreamsError] = useState<string | null>(null)
  const [workerStatusByProjectId, setWorkerStatusByProjectId] = useState<ProjectWorkerStatusMap>({})
  const [loading, setLoading] = useState(true)
  const [statusLoading, setStatusLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const projectsRef = useRef<ProjectRow[]>([])
  const selectedProjectIdRef = useRef<string | null>(null)

  const projectScopeKey = useMemo(
    () => projectHubScopeKey(user?.tenant?.id ?? null, user?.tenant?.slug),
    [user?.tenant?.id, user?.tenant?.slug],
  )

  const activeProjectIdFromRoute = pathname.match(/^\/project\/([^/]+)/)?.[1] ?? null

  const setSelectedProjectId = useCallback(
    (projectId: string) => {
      setSelectedProjectIdState(projectId)
      selectedProjectIdRef.current = projectId
      writeLastProjectId(projectScopeKey, projectId)
    },
    [projectScopeKey],
  )

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

  const refreshWorkstreams = useCallback(async () => {
    const projectId = selectedProjectIdRef.current
    if (!projectId) {
      setWorkstreams([])
      setPoAgent(null)
      setWorkstreamsError(null)
      return
    }
    setWorkstreamsLoading(true)
    setWorkstreamsError(null)
    try {
      const data = await listProjectWorkstreams(projectId)
      setWorkstreams(data.items)
      setPoAgent(data.po_agent)
    } catch (err) {
      setWorkstreams([])
      setPoAgent(null)
      setWorkstreamsError(err instanceof Error ? err.message : 'Could not load workstreams.')
    } finally {
      setWorkstreamsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (projects.length === 0) {
      setSelectedProjectIdState(null)
      selectedProjectIdRef.current = null
      return
    }
    if (
      activeProjectIdFromRoute &&
      projects.some((project) => project.id === activeProjectIdFromRoute)
    ) {
      setSelectedProjectId(activeProjectIdFromRoute)
      return
    }
    const lastOpened = readLastProjectId(projectScopeKey)
    const fallback =
      (lastOpened && projects.find((project) => project.id === lastOpened)?.id) ??
      projects[0]?.id ??
      null
    if (fallback) {
      setSelectedProjectId(fallback)
    }
  }, [projects, activeProjectIdFromRoute, projectScopeKey, setSelectedProjectId])

  useEffect(() => {
    void refreshWorkstreams()
  }, [selectedProjectId, refreshWorkstreams])

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
      selectedProjectId,
      setSelectedProjectId,
      workstreams,
      poAgent,
      workstreamsLoading,
      workstreamsError,
      refreshWorkstreams,
      workerStatusByProjectId,
      loading,
      statusLoading,
      error,
      refresh,
      getWorkerStatus,
    }),
    [
      projects,
      selectedProjectId,
      setSelectedProjectId,
      workstreams,
      poAgent,
      workstreamsLoading,
      workstreamsError,
      refreshWorkstreams,
      workerStatusByProjectId,
      loading,
      statusLoading,
      error,
      refresh,
      getWorkerStatus,
    ],
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
