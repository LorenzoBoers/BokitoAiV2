import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ExternalLink,
  FilePlus,
  FileText,
  Globe,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import MarkdownView from '../components/docs/MarkdownView'
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
import { KnowledgeMark, KnowledgeTile, LearnedChip } from '../components/knowledge/KnowledgeMark'
import { useAuth } from '../context/AuthContext'
import {
  createWorkspaceDoc,
  deleteWorkspaceDoc,
  getWorkspaceDoc,
  listWorkspaceDocs,
  publishWorkspaceDoc,
  searchWorkspace,
  updateWorkspaceDoc,
  uploadWorkspaceDocument,
  type WorkspaceDocKind,
  type WorkspaceDocRow,
  type WorkspaceSearchHit,
} from '../lib/workspace-api'
import { agentRunsPath } from '../lib/messages-paths'
import { titleToDocPath } from '../lib/workspace-doc-path'
import { cn } from '../lib/utils'

const KIND_ORDER: WorkspaceDocKind[] = ['persona', 'memory', 'skill', 'heartbeat', 'doc', 'daily_log']

/** Kinds that agents write and maintain themselves (auto-learning surface). */
const AI_MAINTAINED_KINDS = new Set<WorkspaceDocKind>(['memory', 'heartbeat', 'daily_log'])

const TRUTHY = new Set(['true', '1', 'yes', 'on'])

function isPublished(doc: WorkspaceDocRow | null): boolean {
  return TRUTHY.has(String(doc?.frontmatter?.published ?? '').toLowerCase())
}

const LEGACY_DOC_HEADINGS = new Set([
  'persona',
  'how we sound',
  'heartbeat checklist',
  'daily check-in',
  'long-term memory',
  'what we remember',
  'company',
  'about the company',
])

/** Drop a leading `# Title` that duplicates the header or a known remapped name. */
function stripDuplicateTitle(content: string, titles: string[]): string {
  const lines = content.split('\n')
  let idx = 0
  while (idx < lines.length && lines[idx].trim() === '') idx += 1
  const first = lines[idx] ?? ''
  const heading = first.match(/^#\s+(.*)$/)
  if (!heading) return content
  const text = heading[1].trim().toLowerCase()
  const aliases = titles.map((title) => title.trim().toLowerCase()).filter(Boolean)
  if (aliases.includes(text) || LEGACY_DOC_HEADINGS.has(text)) {
    return lines.slice(idx + 1).join('\n')
  }
  return content
}

export default function WorkspaceDocs() {
  const { t } = useTranslation('nav')
  const { docId } = useParams<{ docId?: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const kindLabel = (kind: WorkspaceDocKind) => t(`knowledgePage.kinds.${kind}`)
  const docTitle = (doc: WorkspaceDocRow) => {
    const known = t(`knowledgePage.paths.${doc.path}`, { defaultValue: '' })
    return known || doc.title || doc.path
  }
  const [publishing, setPublishing] = useState(false)
  const [docs, setDocs] = useState<WorkspaceDocRow[]>([])
  const [active, setActive] = useState<WorkspaceDocRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<WorkspaceSearchHit[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listWorkspaceDocs()
      setDocs(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('knowledgePage.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (docId || loading || error || docs.length === 0) return
    const preferred =
      docs.find((doc) => doc.kind === 'persona') ??
      docs.find((doc) => doc.kind === 'memory') ??
      docs[0]
    if (preferred) navigate(`/knowledge/${preferred.id}`, { replace: true })
  }, [docId, loading, error, docs, navigate])

  useEffect(() => {
    if (!docId) {
      setActive(null)
      setEditing(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const doc = await getWorkspaceDoc(docId)
        if (!cancelled) {
          setActive(doc)
          setDraft(doc.content ?? '')
          setEditing(false)
        }
      } catch {
        if (!cancelled) {
          setActive(null)
          toast.error(t('knowledgePage.loadDocError'))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [docId, t])

  const grouped = useMemo(() => {
    const groups = new Map<WorkspaceDocKind, WorkspaceDocRow[]>()
    for (const kind of KIND_ORDER) groups.set(kind, [])
    for (const doc of docs) {
      const bucket = groups.get(doc.kind) ?? groups.get('doc')!
      bucket.push(doc)
    }
    return groups
  }, [docs])

  const runSearch = useCallback(async () => {
    if (!query.trim()) {
      setHits(null)
      return
    }
    try {
      setHits(await searchWorkspace(query.trim()))
    } catch {
      setHits([])
      toast.error(t('knowledgePage.searchError'))
    }
  }, [query, t])

  const handleSave = useCallback(async () => {
    if (!active) return
    setSaving(true)
    try {
      const updated = await updateWorkspaceDoc(active.id, { content: draft })
      setActive(updated)
      setEditing(false)
      setError(null)
      toast.success(t('knowledgePage.saved'))
      await refresh()
    } catch (err) {
      const message = formatApiErrorMessage(err, t('knowledgePage.saveError'))
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }, [active, draft, refresh, t])

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim()
    const path = titleToDocPath(title) || titleToDocPath('note')
    if (!title) return
    try {
      const doc = await createWorkspaceDoc({ path, content: `# ${title}\n` })
      setCreating(false)
      setNewTitle('')
      setError(null)
      toast.success(t('knowledgePage.created'))
      await refresh()
      navigate(`/knowledge/${doc.id}`)
    } catch (err) {
      const message = formatApiErrorMessage(err, t('knowledgePage.createError'))
      setError(message)
      toast.error(message)
    }
  }, [navigate, newTitle, refresh, t])

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true)
      try {
        const doc = await uploadWorkspaceDocument(file)
        setError(null)
        toast.success(t('knowledgePage.uploaded', { name: file.name }))
        await refresh()
        navigate(`/knowledge/${doc.id}`)
      } catch (err) {
        const message = formatApiErrorMessage(err, t('knowledgePage.uploadError'))
        setError(message)
        toast.error(message)
      } finally {
        setUploading(false)
        if (uploadInputRef.current) uploadInputRef.current.value = ''
      }
    },
    [navigate, refresh, t],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (query.trim()) void runSearch()
      else setHits(null)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query, runSearch])

  const handlePublishToggle = useCallback(async () => {
    if (!active) return
    const publish = !isPublished(active)
    if (publish && !window.confirm(t('knowledgePage.publishConfirm'))) return
    setPublishing(true)
    try {
      const updated = await publishWorkspaceDoc(active.id, publish)
      setActive((prev) => (prev ? { ...prev, frontmatter: updated.frontmatter } : prev))
      toast.success(publish ? t('knowledgePage.published') : t('knowledgePage.unpublished'))
      await refresh()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('knowledgePage.publishError')))
    } finally {
      setPublishing(false)
    }
  }, [active, refresh, t])

  const handleDelete = useCallback(async () => {
    if (!active) return
    if (!window.confirm(t('knowledgePage.deleteConfirm', { path: active.path }))) return
    try {
      await deleteWorkspaceDoc(active.id)
      setActive(null)
      setError(null)
      toast.success(t('knowledgePage.deleted'))
      await refresh()
      navigate('/knowledge')
    } catch (err) {
      const message = formatApiErrorMessage(err, t('knowledgePage.deleteError'))
      setError(message)
      toast.error(message)
    }
  }, [active, navigate, refresh, t])

  const activeTitle = active ? docTitle(active) : ''
  const displayContent = active
    ? stripDuplicateTitle(active.content ?? '', [activeTitle, active.title || '', active.path])
    : ''
  const frontmatterEntries = active
    ? Object.entries(active.frontmatter ?? {}).filter(([k]) => k !== 'published')
    : []

  return (
    <div className="flex h-full min-h-0 flex-col p-3 animate-page-enter">
      <PageGuideBanner page="knowledge" className="mb-3 shrink-0" />
      <div className="featurebase-shell-panel flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-72 shrink-0 flex-col border-r border-border/40">
          <div className="space-y-2.5 border-b border-border/40 px-3 pb-3 pt-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <KnowledgeTile />
                <div className="min-w-0 leading-tight">
                  <h2 className="truncate text-sm font-semibold text-text-heading">{t('knowledgePage.title')}</h2>
                  <p className="truncate text-[11px] text-text-muted">
                    {t('knowledgePage.subtitle')}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title={t('knowledgePage.refresh')}
                  onClick={() => void refresh()}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title={t('knowledgePage.upload')}
                  disabled={uploading}
                  onClick={() => uploadInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title={t('knowledgePage.newDoc')}
                  onClick={() => setCreating((v) => !v)}
                >
                  <FilePlus className="h-3.5 w-3.5" />
                </Button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.rst,.log,.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleUpload(file)
                  }}
                />
              </div>
            </div>
            {creating ? (
              <div className="flex items-center gap-1.5">
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={t('knowledgePage.titlePlaceholder')}
                  className="h-8 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreate()
                  }}
                  autoFocus
                />
                <Button size="sm" className="h-8" onClick={() => void handleCreate()} disabled={!newTitle.trim()}>
                  {t('knowledgePage.add')}
                </Button>
              </div>
            ) : null}
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runSearch()
                  }}
                  placeholder={t('knowledgePage.searchPlaceholder')}
                  title={t('knowledgePage.searchEnterHint')}
                  className="h-8 pl-7 text-xs"
                />
              </div>
              <Button size="sm" variant="outline" className="h-8" onClick={() => void runSearch()}>
                {t('knowledgePage.search')}
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {hits !== null ? (
              <div className="space-y-1">
                <button
                  className="px-2 text-xs text-text-muted hover:text-text-secondary hover:underline"
                  onClick={() => {
                    setHits(null)
                    setQuery('')
                  }}
                >
                  {t('knowledgePage.clearSearch')}
                </button>
                {hits.length === 0 ? (
                  <p className="px-2 py-4 text-xs text-text-muted">
                    {t('knowledgePage.noMatches')}
                  </p>
                ) : (
                  hits.map((hit, idx) => (
                    <button
                      key={idx}
                      className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-bg-hover/60"
                      onClick={() => {
                        if (hit.doc_id) navigate(`/knowledge/${hit.doc_id}`)
                      }}
                    >
                      <span className="block truncate text-xs font-medium text-text-primary">
                        {hit.title}
                      </span>
                      <span className="block truncate text-[11px] text-text-muted">
                        {hit.content.slice(0, 80)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : loading ? (
              <p className="px-2 py-4 text-xs text-text-muted">{t('knowledgePage.loading')}</p>
            ) : error ? (
              <p className="px-2 py-4 text-xs text-status-error">{error}</p>
            ) : docs.length === 0 ? (
              <div className="space-y-1.5 px-2 py-4">
                <p className="text-xs text-text-muted">
                  {t('knowledgePage.emptyHint')}
                </p>
                <div className="flex flex-col gap-1">
                  <Link to="/agents" className="text-[11px] font-medium text-accent hover:underline">
                    {t('knowledgePage.openAgents')}
                  </Link>
                  <Link to="/settings/setup" className="text-[11px] font-medium text-accent hover:underline">
                    {t('knowledgePage.openSetup')}
                  </Link>
                  <Link to="/communication/new" className="text-[11px] font-medium text-accent hover:underline">
                    {t('knowledgePage.talkAssistant')}
                  </Link>
                  <Link to="/settings/help-centers" className="text-[11px] font-medium text-accent hover:underline">
                    {t('knowledgePage.openHelpCenter')}
                  </Link>
                </div>
              </div>
            ) : (
              KIND_ORDER.map((kind) => {
                const rows = grouped.get(kind) ?? []
                if (rows.length === 0) return null
                return (
                  <div key={kind} className="mb-3">
                    <p className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
                      {kindLabel(kind)}
                      {AI_MAINTAINED_KINDS.has(kind) ? <KnowledgeMark size={11} /> : null}
                    </p>
                    <p className="px-2 pb-1 text-[10px] leading-4 text-text-muted/80">
                      {t(`knowledgePage.kindIntros.${kind}`)}
                    </p>
                    {rows.map((doc) => (
                      <button
                        key={doc.id}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary',
                          active?.id === doc.id &&
                            'bg-violet-500/10 font-medium text-violet-500 dark:text-violet-300',
                        )}
                        onClick={() => navigate(`/knowledge/${doc.id}`)}
                      >
                        {AI_MAINTAINED_KINDS.has(doc.kind) ? (
                          <KnowledgeMark size={13} />
                        ) : (
                          <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{docTitle(doc)}</span>
                        {isPublished(doc) ? (
                          <span
                            title={t('knowledgePage.publishedHelp')}
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                          />
                        ) : null}
                      </button>
                    ))}
                  </div>
                )
              })
            )}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          {!active ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
              <KnowledgeTile size="lg" className="knowledge-glow" />
              <div className="space-y-1.5">
                <h1 className="text-lg font-semibold text-text-heading">{t('knowledgePage.emptyTitle')}</h1>
                <p className="mx-auto max-w-md text-sm leading-6 text-text-secondary">
                  {t('knowledgePage.emptyBody')}
                </p>
              </div>
              {!loading && docs.length === 0 ? (
                <div className="flex flex-col items-center gap-3">
                  <button
                    type="button"
                    onDragOver={(event) => {
                      event.preventDefault()
                      setDragOver(true)
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(event) => {
                      event.preventDefault()
                      setDragOver(false)
                      const file = event.dataTransfer.files?.[0]
                      if (file) void handleUpload(file)
                    }}
                    onClick={() => uploadInputRef.current?.click()}
                    className={cn(
                      'rounded-xl border border-dashed px-6 py-5 text-xs text-text-muted transition-colors',
                      dragOver ? 'border-accent/50 bg-accent/5 text-text-secondary' : 'border-border/60',
                    )}
                  >
                    {t('knowledgePage.dropHint')}
                  </button>
                  <Button size="sm" onClick={() => setCreating(true)}>
                    <FilePlus className="mr-1.5 h-3.5 w-3.5" />
                    {t('knowledgePage.createFirst')}
                  </Button>
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
                    <Link to="/settings/setup" className="font-medium text-accent hover:underline">
                      {t('knowledgePage.openSetup')}
                    </Link>
                    <Link to="/agents" className="font-medium text-accent hover:underline">
                      {t('knowledgePage.openAgents')}
                    </Link>
                    <Link to="/communication/new" className="font-medium text-accent hover:underline">
                      {t('knowledgePage.talkAssistant')}
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-text-muted">{t('knowledgePage.selectHint')}</p>
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
                    <Link to="/settings/setup" className="font-medium text-accent hover:underline">
                      {t('knowledgePage.openSetup')}
                    </Link>
                    <Link to="/agents" className="font-medium text-accent hover:underline">
                      {t('knowledgePage.openAgents')}
                    </Link>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-3xl px-8 py-7">
              {error ? <p className="mb-3 text-xs text-status-error">{error}</p> : null}
              <div className="mb-5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-2xl font-semibold tracking-tight text-text-heading">
                    {docTitle(active)}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center rounded-full border border-border/60 bg-bg-elevated/60 px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                      {kindLabel(active.kind)}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-border/60 bg-bg-elevated/60 px-2 py-0.5 font-mono text-[11px] text-text-muted">
                      {active.path}
                    </span>
                    {AI_MAINTAINED_KINDS.has(active.kind) ? (
                      <LearnedChip label={t('knowledgePage.aiMaintained')} />
                    ) : null}
                    {isPublished(active) ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        <Globe size={11} />
                        {t('knowledgePage.publishedBadge')}
                      </span>
                    ) : null}
                  </div>
                  {AI_MAINTAINED_KINDS.has(active.kind) ? (
                    <p className="mt-2 rounded-lg border border-border/60 bg-bg-input/40 px-3 py-2 text-[12px] text-text-muted">
                      {t('knowledgePage.aiMaintainedBanner')}
                    </p>
                  ) : null}
                  <p className="mt-2 text-[12px] text-text-muted">
                    {t('knowledgePage.usedByAgents')}{' '}
                    <Link to="/agents" className="font-medium text-accent hover:underline">
                      {t('knowledgePage.openAgents')}
                    </Link>
                    {' · '}
                    <Link to={agentRunsPath('all')} className="font-medium text-accent hover:underline">
                      {t('knowledgePage.openRuns')}
                    </Link>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {editing ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                        {t('knowledgePage.cancel')}
                      </Button>
                      <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                        {saving ? t('knowledgePage.saving') : t('knowledgePage.save')}
                      </Button>
                    </>
                  ) : (
                    <>
                      {active.kind === 'doc' ? (
                        <Button
                          variant={isPublished(active) ? 'secondary' : 'outline'}
                          size="sm"
                          disabled={publishing}
                          onClick={() => void handlePublishToggle()}
                          title={
                            isPublished(active)
                              ? t('knowledgePage.unpublishTitle')
                              : t('knowledgePage.publishTitle')
                          }
                        >
                          <Globe className="mr-1.5 h-3.5 w-3.5" />
                          {publishing
                            ? t('knowledgePage.saving')
                            : isPublished(active)
                              ? t('knowledgePage.publishedBadge')
                              : t('knowledgePage.publish')}
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDraft(active.content ?? '')
                          setEditing(true)
                        }}
                      >
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                        {t('knowledgePage.edit')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={t('knowledgePage.delete')}
                        onClick={() => void handleDelete()}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {isPublished(active) && !editing && user?.tenant?.slug ? (
                <a
                  href={`/help/${user.tenant.slug}/${active.frontmatter?.slug ?? ''}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mb-4 flex items-center gap-1.5 text-xs text-accent hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t('knowledgePage.viewHelp', {
                    path: `/help/${user.tenant.slug}/${active.frontmatter?.slug ?? ''}`,
                  })}
                </a>
              ) : null}
              {frontmatterEntries.length > 0 && !editing ? (
                <div className="mb-5 flex flex-wrap gap-1.5">
                  {frontmatterEntries.map(([k, v]) => (
                    <span
                      key={k}
                      className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/40 bg-bg-elevated/40 px-2 py-0.5 text-[11px]"
                    >
                      <span className="font-medium text-text-muted">{k}</span>
                      <span className="truncate text-text-secondary">{String(v)}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {editing ? (
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="min-h-[60vh] font-mono text-sm leading-6"
                  spellCheck={false}
                />
              ) : (
                <MarkdownView content={displayContent} />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
