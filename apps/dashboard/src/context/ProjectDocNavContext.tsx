import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getProjectDoc, type DocPageRow, type DocRoot } from '../lib/doc-api'

export interface ProjectDocNavValue {
  doc: DocRoot | null
  pages: DocPageRow[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const ProjectDocNavContext = createContext<ProjectDocNavValue | null>(null)

export function ProjectDocNavProvider({
  projectId,
  children,
}: {
  projectId: string | null
  children: ReactNode
}) {
  const [doc, setDoc] = useState<DocRoot | null>(null)
  const [pages, setPages] = useState<DocPageRow[]>([])
  const [loading, setLoading] = useState<boolean>(Boolean(projectId))
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!projectId) {
      setDoc(null)
      setPages([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await getProjectDoc(projectId)
      setDoc(res.doc)
      setPages(res.pages)
    } catch (err) {
      setDoc(null)
      setPages([])
      setError(err instanceof Error ? err.message : 'Could not load documentation.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<ProjectDocNavValue>(
    () => ({ doc, pages, loading, error, refresh }),
    [doc, pages, loading, error, refresh],
  )

  return (
    <ProjectDocNavContext.Provider value={value}>{children}</ProjectDocNavContext.Provider>
  )
}

export function useProjectDocNav(): ProjectDocNavValue {
  const ctx = useContext(ProjectDocNavContext)
  if (!ctx) throw new Error('useProjectDocNav must be used within ProjectDocNavProvider')
  return ctx
}

export function useOptionalProjectDocNav(): ProjectDocNavValue | null {
  return useContext(ProjectDocNavContext)
}
