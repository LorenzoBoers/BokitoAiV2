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
import type { DocPageRow, DocRoot } from '../lib/doc-api'
import { getWorkspaceDoc } from '../lib/workspace-doc-api'
import { ensureCompanyHandbookApplied } from '../lib/workspace-company-handbook'
import {
  ensureMissingWorkspaceDocScaffoldPages,
  seedWorkspaceDocScaffoldIfEmpty,
} from '../lib/workspace-doc-scaffold'
import { useAuth } from './AuthContext'

export interface WorkspaceDocNavValue {
  doc: DocRoot | null
  pages: DocPageRow[]
  loading: boolean
  error: string | null
  /** Increments when company handbook content is applied to doc pages. */
  handbookRevision: number
  refresh: () => Promise<void>
}

const WorkspaceDocNavContext = createContext<WorkspaceDocNavValue | null>(null)

const DEPLOY_HINT =
  'Workspace documentation API is not available. Deploy workforce /workspace/doc endpoints and workspace_* tables in Xano, then retry.'

export function WorkspaceDocNavProvider({ children }: { children: ReactNode }) {
  const { token, isLoading: authLoading } = useAuth()
  const [doc, setDoc] = useState<DocRoot | null>(null)
  const [pages, setPages] = useState<DocPageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [handbookRevision, setHandbookRevision] = useState(0)
  const refreshInFlight = useRef<Promise<void> | null>(null)

  const refresh = useCallback(async () => {
    if (!token) {
      setDoc(null)
      setPages([])
      setLoading(authLoading)
      setError(authLoading ? null : 'Not authenticated [/workspace/doc]')
      return
    }

    if (refreshInFlight.current) {
      await refreshInFlight.current
      return
    }

    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        let res = await getWorkspaceDoc()
        let scaffoldAdded = false
        if (!res.pages.length && res.doc?.id) {
          const seeded = await seedWorkspaceDocScaffoldIfEmpty(res.doc.id, res.pages)
          if (seeded) {
            res = await getWorkspaceDoc()
          }
        }
        if (res.doc?.id && res.pages.length > 0) {
          scaffoldAdded = await ensureMissingWorkspaceDocScaffoldPages(res.doc.id, res.pages)
          if (scaffoldAdded) {
            res = await getWorkspaceDoc()
          }
        }
        if (res.doc?.id && res.pages.length > 0) {
          const handbookApplied = await ensureCompanyHandbookApplied(res.doc.id, res.pages)
          if (handbookApplied || scaffoldAdded) {
            setHandbookRevision((n) => n + 1)
            if (handbookApplied) {
              res = await getWorkspaceDoc()
            }
          }
        }
        setDoc(res.doc)
        setPages(Array.isArray(res.pages) ? res.pages : [])
      } catch (err) {
        setDoc(null)
        setPages([])
        const message = err instanceof Error ? err.message : 'Could not load documentation.'
        const isMissingEndpoint =
          /HTTP 404\b/i.test(message) ||
          /ERROR_CODE_NOT_FOUND/i.test(message) ||
          /endpoint not found/i.test(message)
        setError(isMissingEndpoint ? DEPLOY_HINT : message)
      } finally {
        setLoading(false)
      }
    }

    refreshInFlight.current = run()
    try {
      await refreshInFlight.current
    } finally {
      refreshInFlight.current = null
    }
  }, [authLoading, token])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<WorkspaceDocNavValue>(
    () => ({
      doc,
      pages,
      loading,
      error,
      handbookRevision,
      refresh,
    }),
    [doc, pages, loading, error, handbookRevision, refresh],
  )

  return (
    <WorkspaceDocNavContext.Provider value={value}>{children}</WorkspaceDocNavContext.Provider>
  )
}

export function useWorkspaceDocNav(): WorkspaceDocNavValue {
  const ctx = useContext(WorkspaceDocNavContext)
  if (!ctx) throw new Error('useWorkspaceDocNav must be used within WorkspaceDocNavProvider')
  return ctx
}

export function useOptionalWorkspaceDocNav(): WorkspaceDocNavValue | null {
  return useContext(WorkspaceDocNavContext)
}
