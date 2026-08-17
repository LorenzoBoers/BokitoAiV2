import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { FilePlus, FileText, Pencil, RefreshCw, Search, Trash2 } from 'lucide-react'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import {
  createWorkspaceDoc,
  deleteWorkspaceDoc,
  getWorkspaceDoc,
  listWorkspaceDocs,
  searchWorkspace,
  updateWorkspaceDoc,
  type WorkspaceDocKind,
  type WorkspaceDocRow,
  type WorkspaceSearchHit,
} from '../lib/workspace-api'
import { cn } from '../lib/utils'

const KIND_ORDER: WorkspaceDocKind[] = ['persona', 'memory', 'skill', 'heartbeat', 'doc', 'daily_log']

const KIND_LABELS: Record<WorkspaceDocKind, string> = {
  persona: 'Persona',
  memory: 'Memory',
  skill: 'Skills',
  heartbeat: 'Heartbeat',
  doc: 'Docs',
  daily_log: 'Daily logs',
}

/** Minimal markdown renderer: headings, lists, code fences, inline bold/italic/code. */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      )
    } else {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>)
    }
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function MarkdownView({ content }: { content: string }) {
  const blocks: React.ReactNode[] = []
  const lines = content.split('\n')
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const code: string[] = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i])
        i += 1
      }
      i += 1
      blocks.push(
        <pre key={key++} className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
          {code.join('\n')}
        </pre>,
      )
      continue
    }
    if (/^#{1,4}\s/.test(line)) {
      const level = (line.match(/^#+/) as RegExpMatchArray)[0].length
      const text = line.replace(/^#+\s*/, '')
      const cls =
        level === 1
          ? 'text-xl font-semibold tracking-tight'
          : level === 2
            ? 'mt-2 text-lg font-semibold tracking-tight'
            : 'mt-1 text-base font-medium'
      blocks.push(
        <div key={key++} className={cls}>
          {renderInline(text)}
        </div>,
      )
      i += 1
      continue
    }
    if (/^\s*[-*]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s/, ''))
        i += 1
      }
      blocks.push(
        <ul key={key++} className="list-disc space-y-1 pl-5 text-sm">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>,
      )
      continue
    }
    if (line.trim() === '') {
      i += 1
      continue
    }
    const para: string[] = [line]
    i += 1
    while (i < lines.length && lines[i].trim() !== '' && !/^(#|```|\s*[-*]\s)/.test(lines[i])) {
      para.push(lines[i])
      i += 1
    }
    blocks.push(
      <p key={key++} className="text-sm leading-6 text-foreground/90">
        {renderInline(para.join(' '))}
      </p>,
    )
  }
  return <div className="space-y-3">{blocks}</div>
}

export default function WorkspaceDocs() {
  const { docId } = useParams<{ docId?: string }>()
  const navigate = useNavigate()
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
  const [newPath, setNewPath] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listWorkspaceDocs()
      setDocs(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load workspace docs.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

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
          toast.error('Could not load this document.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [docId])

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
      toast.error('Search failed. Try again.')
    }
  }, [query])

  const handleSave = useCallback(async () => {
    if (!active) return
    setSaving(true)
    try {
      const updated = await updateWorkspaceDoc(active.id, { content: draft })
      setActive(updated)
      setEditing(false)
      setError(null)
      toast.success('Document saved')
      await refresh()
    } catch (err) {
      const message = formatApiErrorMessage(err, 'Save failed.')
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }, [active, draft, refresh])

  const handleCreate = useCallback(async () => {
    const path = newPath.trim()
    if (!path) return
    try {
      const doc = await createWorkspaceDoc({ path, content: `# ${path.replace(/\.md$/, '')}\n` })
      setCreating(false)
      setNewPath('')
      setError(null)
      toast.success('Document created')
      await refresh()
      navigate(`/knowledge/${doc.id}`)
    } catch (err) {
      const message = formatApiErrorMessage(err, 'Create failed.')
      setError(message)
      toast.error(message)
    }
  }, [navigate, newPath, refresh])

  const handleDelete = useCallback(async () => {
    if (!active) return
    if (!window.confirm(`Delete ${active.path}?`)) return
    try {
      await deleteWorkspaceDoc(active.id)
      setActive(null)
      setError(null)
      toast.success('Document deleted')
      await refresh()
      navigate('/knowledge')
    } catch (err) {
      const message = formatApiErrorMessage(err, 'Could not delete document.')
      setError(message)
      toast.error(message)
    }
  }, [active, navigate, refresh])

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-72 shrink-0 flex-col border-r bg-background">
        <div className="space-y-2 border-b p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Knowledge</h2>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void refresh()}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setCreating((v) => !v)}
              >
                <FilePlus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {creating ? (
            <div className="flex items-center gap-1">
              <Input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="skills/triage.md"
                className="h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate()
                }}
                autoFocus
              />
              <Button size="sm" className="h-8" onClick={() => void handleCreate()}>
                Add
              </Button>
            </div>
          ) : null}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch()
              }}
              placeholder="Search docs"
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {hits !== null ? (
            <div className="space-y-1">
              <button
                className="px-2 text-xs text-muted-foreground hover:underline"
                onClick={() => {
                  setHits(null)
                  setQuery('')
                }}
              >
                Clear search
              </button>
              {hits.length === 0 ? (
                <p className="px-2 py-4 text-xs text-muted-foreground">No matches.</p>
              ) : (
                hits.map((hit, idx) => (
                  <button
                    key={idx}
                    className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
                    onClick={() => {
                      if (hit.doc_id) navigate(`/knowledge/${hit.doc_id}`)
                    }}
                  >
                    <span className="block truncate text-xs font-medium">{hit.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {hit.content.slice(0, 80)}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : loading ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="px-2 py-4 text-xs text-destructive">{error}</p>
          ) : docs.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              No docs yet. Use the + button to add your first one.
            </p>
          ) : (
            KIND_ORDER.map((kind) => {
              const rows = grouped.get(kind) ?? []
              if (rows.length === 0) return null
              return (
                <div key={kind} className="mb-3">
                  <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {KIND_LABELS[kind]}
                  </p>
                  {rows.map((doc) => (
                    <button
                      key={doc.id}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                        active?.id === doc.id && 'bg-muted font-medium',
                      )}
                      onClick={() => navigate(`/knowledge/${doc.id}`)}
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{doc.title || doc.path}</span>
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
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            {!loading && docs.length === 0 ? (
              <>
                <p className="max-w-sm text-center">
                  Knowledge holds workspace docs, skills, and memory that your agents read and
                  maintain. Create your first doc to get started.
                </p>
                <Button size="sm" onClick={() => setCreating(true)}>
                  <FilePlus className="mr-1.5 h-3.5 w-3.5" />
                  Create first doc
                </Button>
              </>
            ) : (
              <p>Select a doc, or create one with the + button.</p>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-8 py-6">
            {error ? <p className="mb-3 text-xs text-destructive">{error}</p> : null}
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{active.title || active.path}</h1>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {active.path} · {KIND_LABELS[active.kind] ?? active.kind}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {editing ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                      {saving ? 'Saving…' : 'Save'}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDraft(active.content ?? '')
                        setEditing(true)
                      }}
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void handleDelete()}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
            {Object.keys(active.frontmatter ?? {}).length > 0 && !editing ? (
              <div className="mb-4 rounded-md border bg-muted/40 p-3 text-xs">
                {Object.entries(active.frontmatter).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="font-medium text-muted-foreground">{k}:</span>
                    <span>{v}</span>
                  </div>
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
              <MarkdownView content={active.content ?? ''} />
            )}
          </div>
        )}
      </main>
    </div>
  )
}
