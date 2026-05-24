import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { History, RefreshCw } from 'lucide-react'
import { Button } from '../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog'
import { ProjectShell } from '../components/project/ProjectShell'
import { useProjectContext } from '../context/ProjectContext'
import { useProjectDocNav } from '../context/ProjectDocNavContext'
import { BlockEditor } from '../components/doc/BlockEditor'
import { RevisionPanel } from '../components/doc/RevisionPanel'
import {
  listPageBlocks,
  type DocBlockRow,
  type DocPageRow,
} from '../lib/doc-api'

export default function ProjectDoc() {
  const { t } = useTranslation('nav')
  const { projectId } = useProjectContext()
  const { pageSlug } = useParams<{ pageSlug?: string }>()
  const navigate = useNavigate()
  const docNav = useProjectDocNav()

  const [blocks, setBlocks] = useState<DocBlockRow[]>([])
  const [loadingBlocks, setLoadingBlocks] = useState(false)
  const [blocksError, setBlocksError] = useState<string | null>(null)
  const [revisionRefresh, setRevisionRefresh] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)

  const activePage = useMemo<DocPageRow | null>(() => {
    if (!docNav.pages.length) return null
    if (pageSlug) {
      const match = docNav.pages.find((p) => p.slug === pageSlug)
      if (match) return match
    }
    const sorted = [...docNav.pages].sort((a, b) => a.position - b.position)
    return sorted[0] ?? null
  }, [docNav.pages, pageSlug])

  useEffect(() => {
    if (!docNav.loading && !pageSlug && activePage && projectId) {
      navigate(`/project/${projectId}/doc/${activePage.slug}`, { replace: true })
    }
  }, [docNav.loading, pageSlug, activePage, projectId, navigate])

  const reloadBlocks = useCallback(() => {
    if (!projectId || !activePage) return
    setLoadingBlocks(true)
    setBlocksError(null)
    listPageBlocks(projectId, activePage.id)
      .then((res) => {
        setBlocks(res.blocks)
      })
      .catch((err: unknown) => {
        setBlocksError(err instanceof Error ? err.message : t('project.doc.loadError'))
      })
      .finally(() => {
        setLoadingBlocks(false)
      })
  }, [projectId, activePage, t])

  useEffect(() => {
    reloadBlocks()
  }, [reloadBlocks])

  const onSaved = useCallback(() => {
    setRevisionRefresh((n) => n + 1)
  }, [])

  if (docNav.loading) {
    return (
      <ProjectShell width="wide" hideContextBar>
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-text-muted">
          {t('project.doc.loading')}
        </div>
      </ProjectShell>
    )
  }

  if (docNav.error) {
    return (
      <ProjectShell width="wide" hideContextBar>
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-border/80 bg-bg-surface/95 p-8 text-center">
          <h2 className="text-base font-semibold text-text-heading">
            {t('project.doc.loadErrorDeploy')}
          </h2>
          <p className="text-sm text-text-muted">{docNav.error}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void docNav.refresh()}
            className="gap-2"
          >
            <RefreshCw size={14} />
            {t('project.doc.retry')}
          </Button>
        </div>
      </ProjectShell>
    )
  }

  if (!docNav.pages.length) {
    return (
      <ProjectShell width="wide" hideContextBar>
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-border/80 bg-bg-surface/95 p-8 text-center">
          <h2 className="text-base font-semibold text-text-heading">
            {t('project.doc.emptyDoc')}
          </h2>
          <p className="text-sm text-text-muted">{t('project.doc.emptyDocDescription')}</p>
          <Button asChild size="sm" variant="secondary">
            <Link to={`/project/${projectId}/settings`}>
              {t('project.contextBar.details', { defaultValue: 'Details' })}
            </Link>
          </Button>
        </div>
      </ProjectShell>
    )
  }

  if (!activePage) {
    return (
      <ProjectShell width="wide" hideContextBar>
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-text-muted">
          {t('project.doc.pickPage')}
        </div>
      </ProjectShell>
    )
  }

  return (
    <ProjectShell width="wide" hideContextBar>
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6 flex items-start justify-between gap-3 border-b border-border/60 pb-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              {activePage.kind}
            </p>
            <h1 className="mt-1 truncate text-3xl font-semibold text-text-heading">
              {activePage.title}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="ghost" className="gap-1.5">
                  <History size={14} />
                  {t('project.doc.history')}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>{t('project.doc.historyTitle')}</DialogTitle>
                  <DialogDescription>{t('project.doc.historyDescription')}</DialogDescription>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto pr-1">
                  <RevisionPanel
                    projectId={projectId}
                    pageId={activePage.id}
                    refreshKey={revisionRefresh}
                    variant="embedded"
                    onReverted={() => {
                      reloadBlocks()
                      setRevisionRefresh((n) => n + 1)
                    }}
                  />
                </div>
              </DialogContent>
            </Dialog>
            <Button asChild size="sm" variant="secondary">
              <Link
                to={`/project/${projectId}/request`}
                state={{ targetPageId: activePage.id, targetPageTitle: activePage.title }}
              >
                {t('project.doc.requestChange')}
              </Link>
            </Button>
          </div>
        </header>
        {loadingBlocks ? (
          <p className="text-sm text-text-muted">{t('project.doc.loading')}</p>
        ) : blocksError ? (
          <p className="text-sm text-status-error">{blocksError}</p>
        ) : activePage.is_locked ? (
          <div className="rounded-lg border border-status-warning/30 bg-status-warning/8 p-4 text-sm text-text-secondary">
            <p className="font-medium text-text-primary">{t('project.doc.lockedTitle')}</p>
            <p className="mt-1 text-text-muted">{t('project.doc.lockedHint')}</p>
          </div>
        ) : (
          <BlockEditor
            projectId={projectId}
            pageId={activePage.id}
            initialBlocks={blocks}
            onSaved={onSaved}
          />
        )}
      </div>
    </ProjectShell>
  )
}
