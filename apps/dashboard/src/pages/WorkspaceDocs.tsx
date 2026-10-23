import { TextLink } from '../components/ui/text-link'
import { Card } from '../components/ui/card'
import { Pressable } from '../components/ui/pressable'
import { Spinner } from '../components/ui/spinner'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { toastMovedToBin } from '../lib/bin-toast'
import {
  ArrowUpRight,
  Copy,
  ExternalLink,
  FilePlus,
  FileText,
  Globe,
  Lock,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { ConversationRowsSkeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { Button } from '../components/ui/button'
import { FilterChip } from '../components/ui/filter-chip'
import { PageHeader } from '../components/ui/page-header'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Badge, badgeVariants } from '../components/ui/badge'
import { useConfirm } from '../components/ui/confirm-dialog'
import MarkdownView from '../components/docs/MarkdownView'
import { KnowledgeMarkdownEditor } from '../components/knowledge/KnowledgeMarkdownEditor'
import { DocSectionsEditor } from '../components/knowledge/DocSections'
import { LinkedRequestsChips } from '../components/knowledge/LinkedRequestsChips'
import { PageGuideLink } from '../components/layout/PageGuideLink'
import { KnowledgeMark, KnowledgeTile, LearnedChip } from '../components/knowledge/KnowledgeMark'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import {
  createWorkspaceDoc,
  deleteWorkspaceDoc,
  getWorkspaceDoc,
  listLessons,
  listPlatformSkills,
  listWorkspaceDocsPage,
  publishWorkspaceDoc,
  searchWorkspace,
  updateWorkspaceDoc,
  uploadWorkspaceDocument,
  type PlatformSkillRow,
  type WorkspaceDocKind,
  type WorkspaceDocRow,
  type LessonRow,
  type WorkspaceSearchHit,
} from '../lib/workspace-api'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { listAgents } from '../lib/agents-api'
import type { RuntimeAgent } from '../lib/workforce-api'
import { ENTITY_ICONS } from '../lib/entity-icons'
import { activityTerminalPath } from '../lib/messages-paths'
import { openEntityPath } from '../lib/open-entity'
import { talkToAssistantPath } from '../lib/talk-to-assistant'
import { titleToDocPath } from '../lib/workspace-doc-path'
import { cn } from '../lib/utils'
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard'
import { formatAppTime } from '../lib/app-locale'
import { workspaceBrandName } from '../lib/tenant-branding'
import { AgentsSectionTabs } from '../components/shell/SectionTabs'

const KIND_ORDER: WorkspaceDocKind[] = [
  'persona',
  'memory',
  'skill',
  'heartbeat',
  'doc',
  'project_doc',
  'daily_log',
]

type KnowledgeScope = 'organization' | 'project' | 'agent'

/** Kinds that agents write and maintain themselves (auto-learning surface). */
/** Scope chips carry a name and its type; long names fade inside the chip. */
const SCOPE_CHIP = 'max-w-[14rem]'

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
  const { t, i18n } = useTranslation('nav')
  const { docId } = useParams<{ docId?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { user } = useAuth()
  const { currentWorkspace } = useWorkspace()
  const organizationName = workspaceBrandName(
    currentWorkspace ?? { name: user?.tenant?.name },
  )

  const kindLabel = (kind: WorkspaceDocKind) =>
    t(`knowledgePage.kinds.${kind}`, { defaultValue: kind })
  const docTitle = (doc: WorkspaceDocRow) => {
    const known = t(`knowledgePage.paths.${doc.path}`, { defaultValue: '' })
    return known || doc.title || doc.path
  }
  const [publishing, setPublishing] = useState(false)
  const [docs, setDocs] = useState<WorkspaceDocRow[]>([])
  const [docsNext, setDocsNext] = useState<number | null>(null)
  const [loadingMoreDocs, setLoadingMoreDocs] = useState(false)
  const [active, setActive] = useState<WorkspaceDocRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [lessons, setLessons] = useState<LessonRow[] | null>(null)
  const [hits, setHits] = useState<WorkspaceSearchHit[] | null>(null)
  const [searchCapped, setSearchCapped] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newKind, setNewKind] = useState<'doc' | 'memory'>('doc')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const [scope, setScope] = useState<KnowledgeScope>(() => {
    const raw = searchParams.get('scope')
    if (raw === 'project' || raw === 'agent') return raw
    return 'organization'
  })
  const [scopeProjectId, setScopeProjectId] = useState(searchParams.get('project') ?? '')
  const [scopeAgentId, setScopeAgentId] = useState(searchParams.get('agent') ?? '')
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [agents, setAgents] = useState<RuntimeAgent[]>([])
  const [platformSkills, setPlatformSkills] = useState<PlatformSkillRow[]>([])
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const knowledgeDirty = Boolean(editing && active && draft !== (active.content ?? ''))
  useUnsavedChangesGuard(knowledgeDirty && !saving, t('knowledgePage.unsavedLeave'))

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.name.localeCompare(b.name, i18n.language)),
    [projects, i18n.language],
  )
  const sortedAgents = useMemo(
    () => [...agents].sort((a, b) => a.name.localeCompare(b.name, i18n.language)),
    [agents, i18n.language],
  )
  const duplicateAgentNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const agent of sortedAgents) {
      counts.set(agent.name, (counts.get(agent.name) ?? 0) + 1)
    }
    return new Set(
      [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name),
    )
  }, [sortedAgents])

  // The selected scope chip filters; this is the way to the entity itself.
  const scopeEntityHref =
    scope === 'project' && scopeProjectId
      ? openEntityPath({ type: 'project', id: scopeProjectId })
      : scope === 'agent' && scopeAgentId
        ? openEntityPath({ type: 'agent', id: scopeAgentId })
        : null
  const ScopeIcon = scope === 'project' ? ENTITY_ICONS.project : ENTITY_ICONS.agent

  const scopeTypeLabel = (value: KnowledgeScope) =>
    t(
      value === 'organization'
        ? 'knowledgePage.scopePlatform'
        : value === 'project'
          ? 'knowledgePage.scopeProject'
          : 'knowledgePage.scopeAgent',
    )

  useEffect(() => {
    void (async () => {
      try {
        const [projectRows, agentRows] = await Promise.all([listProjects(), listAgents()])
        setProjects(projectRows)
        setAgents(agentRows)
      } catch {
        // Pickers stay empty; org scope still works.
      }
    })()
  }, [])

  useEffect(() => {
    let cancelled = false
    listPlatformSkills(i18n.language.startsWith('nl') ? 'nl' : 'en')
      .then((rows) => {
        if (!cancelled) setPlatformSkills(rows)
      })
      .catch(() => {
        if (!cancelled) setPlatformSkills([])
      })
    return () => {
      cancelled = true
    }
  }, [i18n.language])

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    if (scope === 'organization') {
      next.delete('scope')
      next.delete('project')
      next.delete('agent')
    } else {
      next.set('scope', scope)
      if (scope === 'project' && scopeProjectId) next.set('project', scopeProjectId)
      else next.delete('project')
      if (scope === 'agent' && scopeAgentId) next.set('agent', scopeAgentId)
      else next.delete('agent')
    }
    setSearchParams(next, { replace: true })
    // Intentionally omit searchParams to avoid feedback loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, scopeProjectId, scopeAgentId, setSearchParams])

  const docsParams = useCallback(
    (offset?: number) => ({
      ...(scope === 'project' && scopeProjectId
        ? { project_id: scopeProjectId }
        : scope === 'agent' && scopeAgentId
          ? { agent_id: scopeAgentId }
          : {}),
      limit: 100,
      ...(offset != null ? { offset } : {}),
    }),
    [scope, scopeProjectId, scopeAgentId],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    setDocsNext(null)
    try {
      const page = await listWorkspaceDocsPage(docsParams())
      setDocs(page.docs)
      setDocsNext(page.nextOffset)
      setRefreshedAt(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('knowledgePage.loadError'))
    } finally {
      setLoading(false)
    }
  }, [docsParams, t])

  const loadMoreDocs = useCallback(async () => {
    if (docsNext == null || loadingMoreDocs) return
    setLoadingMoreDocs(true)
    try {
      const page = await listWorkspaceDocsPage(docsParams(docsNext))
      setDocs((prev) => {
        const seen = new Set(prev.map((doc) => doc.id))
        return [...prev, ...page.docs.filter((doc) => !seen.has(doc.id))]
      })
      setDocsNext(page.nextOffset)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('knowledgePage.loadError'))
    } finally {
      setLoadingMoreDocs(false)
    }
  }, [docsNext, docsParams, loadingMoreDocs, t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (docId || loading || error || docs.length === 0) return
    const preferred =
      docs.find((doc) => doc.kind === 'persona') ??
      docs.find((doc) => doc.kind === 'memory') ??
      docs[0]
    if (preferred) navigate(`/agents/knowledge/${preferred.id}`, { replace: true })
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

  const reloadActive = useCallback(async () => {
    if (!docId) return
    try {
      const doc = await getWorkspaceDoc(docId)
      setActive(doc)
      setDraft(doc.content ?? '')
    } catch {
      toast.error(t('knowledgePage.loadDocError'))
    }
  }, [docId, t])

  /** Sections follow what is actually in the library — no empty predefined kinds. */
  const presentSections = useMemo(() => {
    const byKind = new Map<WorkspaceDocKind, WorkspaceDocRow[]>()
    for (const doc of docs) {
      const kind: WorkspaceDocKind = KIND_ORDER.includes(doc.kind) ? doc.kind : 'doc'
      const bucket = byKind.get(kind) ?? []
      bucket.push(doc)
      byKind.set(kind, bucket)
    }
    const prefer = (kind: WorkspaceDocKind) => {
      const idx = KIND_ORDER.indexOf(kind)
      return idx === -1 ? KIND_ORDER.length : idx
    }
    return [...byKind.entries()]
      .map(([kind, rows]) => ({
        kind,
        rows: [...rows].sort((a, b) =>
          (a.title || a.path).localeCompare(b.title || b.path, i18n.language),
        ),
      }))
      .sort((a, b) => prefer(a.kind) - prefer(b.kind))
  }, [docs, i18n.language])

  const runSearch = useCallback(async () => {
    if (!query.trim()) {
      setHits(null)
      setSearchCapped(false)
      return
    }
    try {
      const found = await searchWorkspace(query.trim(), 40)
      setHits(found)
      setSearchCapped(found.length >= 40)
    } catch {
      setHits([])
      setSearchCapped(false)
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      if (!editing || !active || draft === (active.content ?? '')) return
      event.preventDefault()
      void handleSave()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, active, draft, handleSave])

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim()
    const path = titleToDocPath(title) || titleToDocPath('note')
    if (!title) return
    if (scope === 'project' && !scopeProjectId) {
      toast.error(t('knowledgePage.pickProject'))
      return
    }
    if (scope === 'agent' && !scopeAgentId) {
      toast.error(t('knowledgePage.pickAgent'))
      return
    }
    try {
      const projectSlug = projects.find((p) => p.id === scopeProjectId)?.slug
      const scopedPath =
        scope === 'project' && projectSlug
          ? `projects/${projectSlug}/${path}`
          : scope === 'agent'
            ? `agents/${scopeAgentId.slice(0, 8)}/${path}`
            : path
      const doc = await createWorkspaceDoc({
        path: scopedPath,
        content: `# ${title}\n`,
        kind: scope === 'project' ? 'project_doc' : newKind,
        project_id: scope === 'project' ? scopeProjectId : undefined,
        agent_id: scope === 'agent' ? scopeAgentId : undefined,
      })
      setCreating(false)
      setNewTitle('')
      setError(null)
      toast.success(t('knowledgePage.created'))
      await refresh()
      navigate(`/agents/knowledge/${doc.id}`)
    } catch (err) {
      const message = formatApiErrorMessage(err, t('knowledgePage.createError'))
      setError(message)
      toast.error(message)
    }
  }, [navigate, newKind, newTitle, projects, refresh, scope, scopeAgentId, scopeProjectId, t])

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true)
      try {
        const doc = await uploadWorkspaceDocument(file)
        setError(null)
        toast.success(t('knowledgePage.uploaded', { name: file.name }))
        await refresh()
        navigate(`/agents/knowledge/${doc.id}`)
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
    if (publish && !(await confirm({ description: t('knowledgePage.publishConfirm') }))) return
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
  }, [active, confirm, refresh, t])

  const handleDelete = useCallback(async () => {
    if (!active) return
    if (
      !(await confirm({
        description: t('knowledgePage.deleteConfirm', { path: active.path }),
        destructive: true,
      }))
    )
      return
    try {
      await deleteWorkspaceDoc(active.id)
      setActive(null)
      setError(null)
      toastMovedToBin(t('knowledgePage.deleted'), navigate)
      await refresh()
      navigate('/agents/knowledge')
    } catch (err) {
      const message = formatApiErrorMessage(err, t('knowledgePage.deleteError'))
      setError(message)
      toast.error(message)
    }
  }, [active, confirm, navigate, refresh, t])

  const activeTitle = active ? docTitle(active) : ''
  const displayContent = active
    ? stripDuplicateTitle(active.content ?? '', [activeTitle, active.title || '', active.path])
    : ''
  const frontmatterEntries = active
    ? Object.entries(active.frontmatter ?? {}).filter(([k]) => k !== 'published')
    : []

  return (
    <div className="flex h-full min-h-0 flex-col p-3 animate-page-enter">
      <AgentsSectionTabs className="mb-2 shrink-0" />
      <Card className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-72 shrink-0 flex-col border-r border-border">
          <div className="space-y-2.5 border-b border-border px-3 pb-3 pt-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <KnowledgeTile />
                <div className="min-w-0 leading-tight">
                  <h2 className="truncate-fade text-sm font-semibold text-text-heading">{t('knowledgePage.title')}</h2>
                  <p className="text-xs leading-snug text-text-muted line-clamp-2">
                    {t('knowledgePage.subtitle')}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <PageGuideLink page="knowledge" compact />
                <Button
                  variant="ghost"
                  size="iconSm"
                  title={t('knowledgePage.refresh')}
                  onClick={() => void refresh()}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="iconSm"
                  title={t('knowledgePage.upload')}
                  disabled={uploading}
                  onClick={() => uploadInputRef.current?.click()}
                >
                  {uploading ? (
                    <Spinner size="md" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="iconSm"
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
                <Select value={newKind} onValueChange={(value) => setNewKind(value === 'memory' ? 'memory' : 'doc')}>
                  <SelectTrigger
                    className="h-8 w-auto min-w-[7rem] text-xs"
                    aria-label={t('knowledgePage.kind', { defaultValue: 'Kind' })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="doc">{t('knowledgePage.kinds.doc', { defaultValue: 'Document' })}</SelectItem>
                    <SelectItem value="memory">{t('knowledgePage.kinds.memory', { defaultValue: 'Memory' })}</SelectItem>
                  </SelectContent>
                </Select>
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
                <Button size="sm" onClick={() => void handleCreate()} disabled={!newTitle.trim()}>
                  {t('knowledgePage.add')}
                </Button>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              <FilterChip
                active={lessons !== null}
                count={lessons?.length}
                onClick={() => {
                  if (lessons) {
                    setLessons(null)
                    return
                  }
                  void listLessons({ status: 'draft' }).then(setLessons).catch(() => setLessons([]))
                }}
              >
                {t('knowledgePage.draftLessons')}
              </FilterChip>
              <FilterChip
                active={scope === 'organization'}
                onClick={() => {
                  setScope('organization')
                  setScopeProjectId('')
                  setScopeAgentId('')
                }}
                className={SCOPE_CHIP}
                title={`${organizationName} · ${scopeTypeLabel('organization')}`}
              >
                <span className="min-w-0 truncate-fade">{organizationName}</span>
                <span className="font-normal opacity-70">{scopeTypeLabel('organization')}</span>
              </FilterChip>
              {sortedProjects.map((project) => (
                <FilterChip
                  key={project.id}
                  active={scope === 'project' && scopeProjectId === project.id}
                  onClick={() => {
                    setScope('project')
                    setScopeProjectId(project.id)
                    setScopeAgentId('')
                  }}
                  className={SCOPE_CHIP}
                  title={`${project.name} · ${scopeTypeLabel('project')}`}
                >
                  <span className="min-w-0 truncate-fade">{project.name}</span>
                  <span className="font-normal opacity-70">{scopeTypeLabel('project')}</span>
                </FilterChip>
              ))}
              {sortedAgents.map((agent) => {
                const sameName = duplicateAgentNames.has(agent.name)
                const sameRoleCount = sortedAgents.filter(
                  (other) =>
                    other.name === agent.name &&
                    (other.role_name || '') === (agent.role_name || ''),
                ).length
                const chipHint = !sameName
                  ? scopeTypeLabel('agent')
                  : sameRoleCount > 1
                    ? agent.slug || agent.id.slice(0, 8)
                    : agent.role_name || agent.slug
                return (
                <FilterChip
                  key={agent.id}
                  active={scope === 'agent' && scopeAgentId === agent.id}
                  onClick={() => {
                    setScope('agent')
                    setScopeAgentId(agent.id)
                    setScopeProjectId('')
                  }}
                  className={SCOPE_CHIP}
                  title={`${agent.name} · ${chipHint}`}
                >
                  <span className="min-w-0 truncate-fade">{agent.name}</span>
                  <span className="font-normal opacity-70">{chipHint}</span>
                </FilterChip>
                )
              })}
            </div>
            {scopeEntityHref ? (
              <Link
                to={scopeEntityHref}
                className="inline-flex items-center gap-1 self-start text-2xs text-text-muted hover:text-accent hover:underline"
                data-testid="knowledge-open-scope"
              >
                <ScopeIcon size={11} aria-hidden />
                {scope === 'project' ? t('knowledgePage.openProject') : t('knowledgePage.openAgent')}
                <ArrowUpRight size={14} aria-hidden />
              </Link>
            ) : null}
            {lessons ? (
              <ul className="flex flex-col gap-1">
                {lessons.map((lesson) => (
                  <li key={lesson.id} className="flex items-center gap-2 text-xs text-text-secondary">
                    <span className="font-medium text-text-heading">{lesson.heading || t('knowledgePage.draftLessons')}</span>
                    {lesson.tags.map((tag) => (
                      <span key={tag.id}>{tag.name.replace(/^#/, '')}</span>
                    ))}
                    <span>{t('knowledgePage.lessonSignals', { count: lesson.signals })}</span>
                    {lesson.signal_id ? (
                      <Link to={`/communication/${lesson.signal_id}`} className="text-accent hover:underline">
                        {t('knowledgePage.openAgent')}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
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
              <Button size="sm" variant="secondary" onClick={() => void runSearch()}>
                {t('knowledgePage.search')}
              </Button>
            </div>
            {refreshedAt ? (
              <p className="text-2xs text-text-muted">
                {t('knowledgePage.refreshedAt', { time: formatAppTime(refreshedAt, i18n.language) })}
              </p>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {hits !== null ? (
              <div className="space-y-1">
                <TextLink
                  tone="muted"
                  className="px-2 text-xs"
                  onClick={() => {
                    setHits(null)
                    setSearchCapped(false)
                    setQuery('')
                  }}
                >
                  {t('knowledgePage.clearSearch')}
                </TextLink>
                {hits.length === 0 ? (
                  <p className="px-2 py-4 text-xs text-text-muted">
                    {t('knowledgePage.noMatches')}
                  </p>
                ) : (
                  hits.map((hit, idx) => (
                    <Pressable
                      key={idx}
                      className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-bg-hover"
                      onClick={() => {
                        if (hit.doc_id) navigate(`/agents/knowledge/${hit.doc_id}`)
                      }}
                    >
                      <span className="block truncate-fade text-xs font-medium text-text-primary">
                        {hit.title}
                      </span>
                      <span className="block truncate-fade text-xs text-text-muted">
                        {hit.content.slice(0, 80)}
                      </span>
                    </Pressable>
                  ))
                )}
                {searchCapped ? (
                  <p className="px-2 pt-1 text-xs text-text-muted">{t('knowledgePage.searchCapped')}</p>
                ) : null}
              </div>
            ) : loading ? (
              <ConversationRowsSkeleton rows={7} />
            ) : error ? (
              <p className="px-2 py-4 text-xs text-status-error">{error}</p>
            ) : docs.length === 0 ? (
              <EmptyState tone="plain" size="sm" className="px-2 py-4" title={t('knowledgePage.emptyHint')} />
            ) : (
              presentSections.map(({ kind, rows }) => (
                  <div key={kind} className="mb-3">
                    <p className="flex items-center gap-1.5 px-2 pb-1 text-xs font-medium text-text-muted">
                      {kindLabel(kind)}
                      {AI_MAINTAINED_KINDS.has(kind) ? <KnowledgeMark size={11} /> : null}
                    </p>
                    {rows.map((doc) => (
                      <Pressable
                        key={doc.id}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary',
                          active?.id === doc.id &&
                            'bg-ai/10 font-medium text-ai-ink',
                        )}
                        onClick={() => navigate(`/agents/knowledge/${doc.id}`)}
                      >
                        {AI_MAINTAINED_KINDS.has(doc.kind) ? (
                          <KnowledgeMark size={13} />
                        ) : (
                          <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                        )}
                        <span className="min-w-0 flex-1 truncate-fade">{docTitle(doc)}</span>
                        {isPublished(doc) ? (
                          <span
                            title={t('knowledgePage.publishedHelp')}
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-success"
                          />
                        ) : null}
                      </Pressable>
                    ))}
                  </div>
                ))
            )}
            {hits === null && !loading && scope === 'organization' && platformSkills.length > 0 ? (
              <div className="mb-3">
                <p
                  className="flex items-center gap-1.5 px-2 pb-1 text-xs font-medium text-text-muted"
                  title={t('knowledgePage.platformSkillsHelp')}
                >
                  {t('knowledgePage.platformSkills')}
                </p>
                {platformSkills.map((skill) => (
                  <div
                    key={skill.slug}
                    title={skill.description}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-text-muted"
                  >
                    <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate-fade">{skill.name}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {hits === null && docsNext != null ? (
              <Pressable
                type="button"
                className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-accent hover:underline disabled:opacity-60"
                disabled={loadingMoreDocs}
                onClick={() => void loadMoreDocs()}
              >
                {loadingMoreDocs ? t('knowledgePage.loadingMore') : t('knowledgePage.loadMore')}
              </Pressable>
            ) : null}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          {!active ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
              <PageHeader className="sr-only" title={t('tabs.knowledge.title')} />
              <KnowledgeTile size="lg" className="knowledge-glow" />
              <div className="space-y-1.5">
                <h2 className="text-lg font-semibold text-text-heading">{t('knowledgePage.emptyTitle')}</h2>
                <p className="mx-auto max-w-md text-sm leading-6 text-text-secondary">
                  {t('knowledgePage.emptyBody')}
                </p>
              </div>
              {!loading && docs.length === 0 ? (
                <div className="flex flex-col items-center gap-3">
                  <Pressable
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
                      'w-auto rounded-lg border border-dashed px-6 text-center py-5 text-xs text-text-muted transition-colors',
                      dragOver ? 'border-accent/50 bg-accent/5 text-text-secondary' : 'border-border',
                    )}
                  >
                    {t('knowledgePage.dropHint')}
                  </Pressable>
                  <Button size="sm" onClick={() => setCreating(true)}>
                    <FilePlus className="mr-1.5 h-3.5 w-3.5" />
                    {t('knowledgePage.createFirst')}
                  </Button>
                  <Link to="/docs/ai/knowledge" className="text-xs font-medium text-accent hover:underline">
                    {t('pageGuides.learnMore')}
                  </Link>
                </div>
              ) : (
                <p className="text-xs text-text-muted">{t('knowledgePage.selectHint')}</p>
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-3xl px-8 py-7">
              {error ? <p className="mb-3 text-xs text-status-error">{error}</p> : null}
              <PageHeader
                className="mb-5 items-start"
                title={docTitle(active)}
                subtitle={
                  <>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge>{kindLabel(active.kind)}</Badge>
                        <Pressable
                          onClick={() => {
                            void navigator.clipboard.writeText(active.path).then(
                              () => toast.success(t('knowledgePage.pathCopied')),
                              () => toast.error(t('knowledgePage.copyFailed')),
                            )
                          }}
                          title={t('knowledgePage.copyPath')}
                          className={cn(badgeVariants({ variant: 'neutral' }), 'w-auto gap-1 font-mono text-text-muted hover:text-text-secondary')}
                        >
                          <Copy size={14} />
                          {active.path}
                        </Pressable>
                        {AI_MAINTAINED_KINDS.has(active.kind) ? (
                          <LearnedChip label={t('knowledgePage.aiMaintained')} />
                        ) : null}
                        {isPublished(active) ? (
                          <Badge variant="success" icon={Globe}>
                            {t('knowledgePage.publishedBadge')}
                          </Badge>
                        ) : null}
                      </div>
                      {AI_MAINTAINED_KINDS.has(active.kind) ? (
                        <p className="mt-2 rounded-lg border border-border bg-bg-input/40 px-3 py-2 text-xs text-text-muted">
                          {t('knowledgePage.aiMaintainedBanner')}
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs text-text-muted">
                        {t('knowledgePage.usedByAgents')}{' '}
                        <Link to="/agents" className="font-medium text-accent hover:underline">
                          {t('knowledgePage.openAgents')}
                        </Link>
                        {' · '}
                        <Link to={activityTerminalPath()} className="font-medium text-accent hover:underline">
                          {t('knowledgePage.openRuns')}
                        </Link>
                        {' · '}
                        <Link
                          to={talkToAssistantPath(t('knowledgePage.tryPrefill'))}
                          className="font-medium text-accent hover:underline"
                        >
                          {t('knowledgePage.talkAssistant')}
                        </Link>
                      </p>
                  </>
                }
                actions={
                  editing ? (
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                      {t('knowledgePage.cancel')}
                    </Button>
                  ) : (
                    <>
                      {active.kind === 'doc' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={publishing}
                          onClick={() => void handlePublishToggle()}
                          title={isPublished(active) ? t('knowledgePage.unpublishTitle') : t('knowledgePage.publishTitle')}
                        >
                          <Globe className="mr-1.5 h-3.5 w-3.5" />
                          {publishing
                            ? t('knowledgePage.saving')
                            : isPublished(active)
                              ? t('knowledgePage.publishedBadge')
                              : t('knowledgePage.publish')}
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="icon" title={t('knowledgePage.delete')} onClick={() => void handleDelete()}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )
                }
                primaryAction={
                  editing ? (
                    <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                      {saving ? t('knowledgePage.saving') : t('knowledgePage.save')}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setDraft(active.content ?? '')
                        setEditing(true)
                      }}
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      {t('knowledgePage.edit')}
                    </Button>
                  )
                }
              />
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
                    <Badge key={k} className="max-w-full gap-1">
                      <span className="text-text-muted">{k}</span>
                      <span className="truncate-fade">{String(v)}</span>
                    </Badge>
                  ))}
                </div>
              ) : null}
              {!editing && (active.linked_requests?.length ?? 0) > 0 ? (
                <LinkedRequestsChips
                  requests={active.linked_requests ?? []}
                  className="mb-5"
                />
              ) : null}
              {editing ? (
                <KnowledgeMarkdownEditor
                  value={draft}
                  onChange={setDraft}
                  minHeightClassName="min-h-[60vh]"
                  writeLabel={t('knowledgePage.editorWrite')}
                  markdownLabel={t('knowledgePage.editorMarkdown')}
                />
              ) : (active.sections?.length ?? 0) > 0 ? (
                <DocSectionsEditor
                  docId={active.id}
                  sections={(active.sections ?? []).map((s) =>
                    s.heading
                      ? s
                      : {
                          ...s,
                          content: stripDuplicateTitle(s.content, [
                            activeTitle,
                            active.title || '',
                            active.path,
                          ]),
                        },
                  )}
                  onChanged={() => void reloadActive()}
                />
              ) : (
                <MarkdownView content={displayContent} />
              )}
            </div>
          )}
        </main>
      </Card>
    </div>
  )
}
