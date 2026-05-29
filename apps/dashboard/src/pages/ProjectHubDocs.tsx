import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { History, Lock, LockOpen, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog'
import { Textarea } from '../components/ui/textarea'
import { BlockEditor, type DocEditorSaveStatus } from '../components/doc/BlockEditor'
import { BlockList } from '../components/doc/BlockRenderer'
import { DocSaveIndicator } from '../components/doc/DocSaveIndicator'
import { PageTree } from '../components/doc/PageTree'
import { RevisionPanel } from '../components/doc/RevisionPanel'
import { useWorkspaceDocNav } from '../context/WorkspaceDocNavContext'
import { listWorkspacePageBlocks, createWorkspaceDocChangeRequest, patchWorkspaceDocPage } from '../lib/workspace-doc-api'
import type { DocBlockRow, DocPageRow } from '../lib/doc-api'
import {
  WORKSPACE_DOC_SCAFFOLD_PAGES,
  seedWorkspacePageStarterBlocks,
} from '../lib/workspace-doc-scaffold'
import { newBlockId } from '../lib/doc-blocks'
import { cn } from '../lib/utils'

function buildFallbackScaffoldBlocks(page: DocPageRow): DocBlockRow[] {
  const def = WORKSPACE_DOC_SCAFFOLD_PAGES.find((item) => item.slug === page.slug)
  if (!def) return []
  const now = new Date().toISOString()
  const mkId = () => newBlockId()
  return [
    {
      id: mkId(),
      tenant_id: page.tenant_id,
      project_id: '',
      page_id: page.id,
      parent_block_id: null,
      type: 'heading_1',
      text: [{ text: def.title }],
      props: {},
      position: 0,
      created_by_type: 'user',
      created_by_id: null,
      last_edited_by_type: 'user',
      last_edited_by_id: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: mkId(),
      tenant_id: page.tenant_id,
      project_id: '',
      page_id: page.id,
      parent_block_id: null,
      type: 'callout',
      text: [{ text: def.callout }],
      props: { tone: 'info', icon: 'Info' },
      position: 1,
      created_by_type: 'user',
      created_by_id: null,
      last_edited_by_type: 'user',
      last_edited_by_id: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: mkId(),
      tenant_id: page.tenant_id,
      project_id: '',
      page_id: page.id,
      parent_block_id: null,
      type: 'paragraph',
      text: [{ text: def.paragraph }],
      props: {},
      position: 2,
      created_by_type: 'user',
      created_by_id: null,
      last_edited_by_type: 'user',
      last_edited_by_id: null,
      created_at: now,
      updated_at: now,
    },
  ]
}

export default function ProjectHubDocs() {
  const { t } = useTranslation('nav')
  const { pageSlug } = useParams<{ pageSlug?: string }>()
  const navigate = useNavigate()
  const docNav = useWorkspaceDocNav()

  const [blocks, setBlocks] = useState<DocBlockRow[]>([])
  const [blocksRevision, setBlocksRevision] = useState(0)
  const [contentVersion, setContentVersion] = useState(0)
  const [saveStatus, setSaveStatus] = useState<DocEditorSaveStatus>({
    phase: 'idle',
    lastEditedAt: null,
    lastSavedAt: null,
  })
  const [loadingBlocks, setLoadingBlocks] = useState(false)
  const [blocksError, setBlocksError] = useState<string | null>(null)
  const [revisionRefresh, setRevisionRefresh] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentBody, setAgentBody] = useState('')
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentMessage, setAgentMessage] = useState<string | null>(null)
  const [lockBusy, setLockBusy] = useState(false)

  const sortedPages = useMemo(
    () => [...docNav.pages].sort((a, b) => a.position - b.position),
    [docNav.pages],
  )

  const activePage = useMemo<DocPageRow | null>(() => {
    if (!docNav.pages.length) return null
    if (pageSlug) {
      const match = docNav.pages.find((p) => p.slug === pageSlug)
      if (match) return match
    }
    return sortedPages[0] ?? null
  }, [docNav.pages, pageSlug, sortedPages])

  useEffect(() => {
    if (!docNav.loading && !pageSlug && activePage) {
      navigate(`/projects/docs/${activePage.slug}`, { replace: true })
    }
  }, [docNav.loading, pageSlug, activePage, navigate])

  const reloadBlocks = useCallback(() => {
    if (!activePage) return
    setLoadingBlocks(true)
    setBlocksError(null)
    listWorkspacePageBlocks(activePage.id)
      .then(async (res) => {
        setContentVersion(res.page.content_version ?? 0)
        if (res.blocks.length > 0) {
          setBlocks(res.blocks)
          setBlocksRevision((n) => n + 1)
          return
        }
        const def = WORKSPACE_DOC_SCAFFOLD_PAGES.find((p) => p.slug === activePage.slug)
        if (!def) {
          setBlocks([])
          setBlocksRevision((n) => n + 1)
          return
        }
        try {
          await seedWorkspacePageStarterBlocks(activePage.id, def)
          const again = await listWorkspacePageBlocks(activePage.id)
          setContentVersion(again.page.content_version ?? 0)
          setBlocks(again.blocks)
          setBlocksRevision((n) => n + 1)
        } catch {
          // Keep docs readable while backend seed endpoint is recovering.
          setBlocks(buildFallbackScaffoldBlocks(activePage))
          setBlocksRevision((n) => n + 1)
          setBlocksError(null)
        }
      })
      .catch((err: unknown) => {
        setBlocksError(err instanceof Error ? err.message : t('project.doc.loadError'))
      })
      .finally(() => setLoadingBlocks(false))
  }, [activePage, t])

  useEffect(() => {
    reloadBlocks()
  }, [reloadBlocks, docNav.handbookRevision])

  useEffect(() => {
    setSaveStatus({ phase: 'idle', lastEditedAt: null, lastSavedAt: null })
  }, [activePage?.id])

  const onSaved = useCallback((savedBlocks: DocBlockRow[], meta?: { contentVersion?: number }) => {
    if (typeof meta?.contentVersion === 'number') {
      setContentVersion(meta.contentVersion)
    }
    setBlocks(savedBlocks)
    setRevisionRefresh((n) => n + 1)
  }, [])

  const submitAgentRequest = async () => {
    if (!activePage || !agentBody.trim()) return
    setAgentBusy(true)
    setAgentMessage(null)
    try {
      await createWorkspaceDocChangeRequest({
        body: agentBody.trim(),
        target_page_id: activePage.id,
        title: t('projectHub.docs.agentRequestTitle', { page: activePage.title }),
      })
      setAgentBody('')
      setAgentOpen(false)
      setAgentMessage(t('projectHub.docs.agentRequestSent'))
    } catch (err) {
      setAgentMessage(err instanceof Error ? err.message : t('projectHub.docs.agentRequestFailed'))
    } finally {
      setAgentBusy(false)
    }
  }

  const togglePageLock = async () => {
    if (!activePage) return
    setLockBusy(true)
    try {
      await patchWorkspaceDocPage(activePage.id, { is_locked: !activePage.is_locked })
      await docNav.refresh()
      setSaveStatus({ phase: 'idle', lastEditedAt: null, lastSavedAt: null })
    } finally {
      setLockBusy(false)
    }
  }

  if (docNav.loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-text-muted">
        {t('project.doc.loading')}
      </div>
    )
  }

  if (docNav.error) {
    const showDeployHint =
      /HTTP 404\b/i.test(docNav.error) ||
      /ERROR_CODE_NOT_FOUND/i.test(docNav.error) ||
      /endpoint not found/i.test(docNav.error)
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-border/80 bg-bg-surface/95 p-8 text-center">
        <h2 className="text-base font-semibold text-text-heading">
          {showDeployHint ? t('project.doc.loadErrorDeploy') : t('project.doc.loadError')}
        </h2>
        <p className="text-sm text-text-muted">{docNav.error}</p>
        <Button variant="secondary" size="sm" onClick={() => void docNav.refresh()} className="gap-2">
          <RefreshCw size={14} />
          {t('project.doc.retry')}
        </Button>
      </div>
    )
  }

  if (!docNav.pages.length) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-border/80 bg-bg-surface/95 p-8 text-center">
        <h2 className="text-base font-semibold text-text-heading">
          {t('projectHub.docs.emptyTitle')}
        </h2>
        <p className="text-sm text-text-muted">{t('projectHub.docs.emptyDescription')}</p>
        <Button variant="secondary" size="sm" onClick={() => void docNav.refresh()} className="gap-2">
          <RefreshCw size={14} />
          {t('project.doc.retry')}
        </Button>
      </div>
    )
  }

  if (!activePage) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-text-muted">
        {t('project.doc.pickPage')}
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      {/* Mobile page picker */}
      <nav
        className="mb-4 flex gap-1 overflow-x-auto pb-1 md:hidden"
        aria-label={t('projectHub.docs.group')}
      >
        {sortedPages.map((page) => {
          const isActive = page.id === activePage.id
          return (
            <Link
              key={page.id}
              to={`/projects/docs/${page.slug}`}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                isActive
                  ? 'border-border/70 bg-bg-hover text-text-heading'
                  : 'border-transparent text-text-muted hover:text-text-primary',
              )}
            >
              {page.title}
            </Link>
          )
        })}
      </nav>

      <div className="flex gap-0 md:gap-10 lg:gap-14">
        <aside className="hidden w-52 shrink-0 md:block lg:w-56">
          <div className="sticky top-4 border-r border-border/40 pr-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              {t('projectHub.docs.group')}
            </p>
            <PageTree
              pages={docNav.pages}
              workspaceDocId={docNav.doc?.id}
              activePageId={activePage.id}
              variant="minimal"
              basePath="/projects/docs"
              docScope="workspace"
              enablePageCrud
              onPagesChanged={() => void docNav.refresh()}
              onPageCreated={(page) => navigate(`/projects/docs/${page.slug}`)}
            />
          </div>
        </aside>

        <article className="min-w-0 flex-1 pb-8 max-w-3xl">
          <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-border/50 pb-5">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                {activePage.kind.replace(/_/g, ' ')}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text-heading sm:text-3xl">
                {activePage.title}
              </h1>
              {activePage.is_locked ? (
                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-status-warning/40 bg-status-warning/10 px-2.5 py-0.5 text-xs font-medium text-status-warning">
                  <Lock size={12} aria-hidden />
                  {t('project.doc.lockedBadge')}
                </span>
              ) : !loadingBlocks && !blocksError ? (
                <DocSaveIndicator status={saveStatus} className="mt-2" />
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                size="sm"
                variant={activePage.is_locked ? 'secondary' : 'ghost'}
                className="gap-1.5"
                disabled={lockBusy}
                onClick={() => void togglePageLock()}
              >
                {activePage.is_locked ? <LockOpen size={14} /> : <Lock size={14} />}
                {activePage.is_locked
                  ? t('project.doc.pageCrud.unlock')
                  : t('project.doc.pageCrud.lock')}
              </Button>
              <Dialog open={agentOpen} onOpenChange={setAgentOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="secondary" className="gap-1.5">
                    <Sparkles size={14} />
                    {t('projectHub.docs.agentEdit')}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>{t('projectHub.docs.agentEditTitle')}</DialogTitle>
                    <DialogDescription>{t('projectHub.docs.agentEditDescription')}</DialogDescription>
                  </DialogHeader>
                  <Textarea
                    value={agentBody}
                    onChange={(e) => setAgentBody(e.target.value)}
                    rows={6}
                    placeholder={t('projectHub.docs.agentEditPlaceholder')}
                  />
                  {agentMessage ? (
                    <p className="text-sm text-text-secondary">{agentMessage}</p>
                  ) : null}
                  <DialogFooter>
                    <Button
                      type="button"
                      disabled={agentBusy || !agentBody.trim()}
                      onClick={() => void submitAgentRequest()}
                    >
                      {t('projectHub.docs.agentEditSubmit')}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
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
                      pageId={activePage.id}
                      docScope="workspace"
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
            </div>
          </header>

          {loadingBlocks ? (
            <div className="space-y-3 py-4">
              <div className="h-6 w-2/3 animate-pulse rounded bg-bg-hover" />
              <div className="h-4 w-full animate-pulse rounded bg-bg-hover/70" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-bg-hover/70" />
            </div>
          ) : blocksError ? (
            <div className="rounded-xl border border-status-error/30 bg-status-error/5 p-5">
              <p className="text-sm font-medium text-status-error">{t('project.doc.loadError')}</p>
              <p className="mt-1 text-xs text-text-muted">{blocksError}</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-4 gap-2"
                onClick={() => reloadBlocks()}
              >
                <RefreshCw size={14} />
                {t('project.doc.retry')}
              </Button>
            </div>
          ) : activePage.is_locked ? (
            <div className="space-y-6">
              <div className="rounded-lg border border-status-warning/30 bg-status-warning/8 px-4 py-3 text-sm">
                <p className="font-medium text-text-primary">{t('project.doc.lockedTitle')}</p>
                <p className="mt-1 text-text-muted">{t('project.doc.lockedHint')}</p>
              </div>
              {blocks.length > 0 ? (
                <BlockList blocks={blocks} />
              ) : (
                <p className="text-sm text-text-muted">{t('project.doc.empty')}</p>
              )}
            </div>
          ) : (
            <BlockEditor
              key={`${activePage.id}-${blocksRevision}`}
              pageId={activePage.id}
              docScope="workspace"
              initialBlocks={blocks}
              contentVersion={contentVersion}
              onSaved={onSaved}
              onSaveStatusChange={setSaveStatus}
              onError={() =>
                setSaveStatus((prev) => ({
                  ...prev,
                  phase: 'error',
                  errorMessage: t('project.doc.editor.saveFailed'),
                }))
              }
              onVersionConflict={() => reloadBlocks()}
            />
          )}
        </article>
      </div>
    </div>
  )
}
