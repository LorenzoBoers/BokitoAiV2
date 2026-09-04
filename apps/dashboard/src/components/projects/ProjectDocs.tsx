import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, FileText, Loader2, Pencil, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import MarkdownView from '../docs/MarkdownView'
import { KnowledgeMarkdownEditor } from '../knowledge/KnowledgeMarkdownEditor'
import { DocSectionsEditor } from '../knowledge/DocSections'
import { LinkedRequestsChips } from '../knowledge/LinkedRequestsChips'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Input } from '../ui/input'
import { ApiErrorBanner, formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { TableRowsSkeleton } from '../ui/skeleton'
import { cn } from '../../lib/utils'
import {
  listProjectDocs,
  saveProjectDoc,
  setSectionStatus,
  type DocSectionRow,
  type DocSectionStatus,
  type ProjectDocRow,
} from '../../lib/project-work-api'
import {
  QUEUE_STATUS_VARIANT,
  SECTION_STATUS_RAIL,
  SECTION_STATUS_VARIANT,
} from './projectWorkBadges'

const SECTION_STATUSES: DocSectionStatus[] = ['draft', 'review', 'final']

function SectionRow({
  section,
  canEdit,
  onSetStatus,
}: {
  section: DocSectionRow
  canEdit: boolean
  onSetStatus: (section: DocSectionRow, status: DocSectionStatus) => Promise<void>
}) {
  const { t } = useTranslation('nav')
  const [expanded, setExpanded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const items = section.items ?? []

  return (
    <li className="flex gap-2">
      <span
        className={cn('mt-1 w-1 shrink-0 rounded-full', SECTION_STATUS_RAIL[section.status])}
        aria-hidden
      />
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-1 text-left text-sm text-text-primary hover:text-text-heading"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <ChevronDown size={13} className="shrink-0 text-text-muted" />
            ) : (
              <ChevronRight size={13} className="shrink-0 text-text-muted" />
            )}
            <span className="truncate">{section.heading || section.anchor}</span>
          </button>
          {canEdit ? (
            <div className="relative">
              <button
                type="button"
                className="inline-flex"
                onClick={() => setMenuOpen((v) => !v)}
                title={t('projects.work.changeSectionStatus')}
              >
                <Badge
                  variant={SECTION_STATUS_VARIANT[section.status]}
                  className="cursor-pointer px-1.5 py-0 text-[10px]"
                >
                  {busy ? <Loader2 size={10} className="mr-0.5 animate-spin" /> : null}
                  {t(`projects.work.sectionStatus.${section.status}`)}
                </Badge>
              </button>
              {menuOpen ? (
                <div className="absolute left-0 top-6 z-20 w-40 rounded-lg border border-border/60 bg-bg-surface p-1 shadow-overlay">
                  {SECTION_STATUSES.map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={cn(
                        'block w-full rounded-md px-2 py-1 text-left text-xs text-text-secondary hover:bg-bg-hover',
                        status === section.status && 'bg-bg-hover font-medium text-text-heading',
                      )}
                      onClick={() => {
                        setMenuOpen(false)
                        if (status === section.status) return
                        setBusy(true)
                        void onSetStatus(section, status).finally(() => setBusy(false))
                      }}
                    >
                      {t(`projects.work.sectionStatus.${status}`)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <Badge variant={SECTION_STATUS_VARIANT[section.status]} className="px-1.5 py-0 text-[10px]">
              {t(`projects.work.sectionStatus.${section.status}`)}
            </Badge>
          )}
          {items.length > 0 ? (
            <span className="text-[11px] text-text-muted">
              {t('projects.work.linkedItems', { count: items.length })}
            </span>
          ) : null}
        </div>
        {expanded ? (
          <div className="mt-1 space-y-1 pl-5">
            {section.summary ? (
              <p className="text-xs text-text-muted">{section.summary}</p>
            ) : null}
            {items.length === 0 ? (
              <p className="text-xs text-text-muted">{t('projects.work.noLinkedItems')}</p>
            ) : (
              items.map((item) => (
                <div key={`${item.queue_item_id}-${item.relation}`} className="flex items-center gap-1.5">
                  <Badge variant={QUEUE_STATUS_VARIANT[item.status]} className="px-1.5 py-0 text-[10px]">
                    {t(`projects.work.status.${item.status}`)}
                  </Badge>
                  <span className="min-w-0 truncate text-xs text-text-secondary">{item.title}</span>
                  <span className="text-[10px] text-text-muted">
                    {t(`projects.work.relation.${item.relation}`, { defaultValue: item.relation })}
                  </span>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </li>
  )
}

export function ProjectDocs({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { t } = useTranslation('nav')
  const [docs, setDocs] = useState<ProjectDocRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const [creating, setCreating] = useState(false)
  const [newPath, setNewPath] = useState('')

  const load = useCallback(async () => {
    setError(null)
    try {
      const rows = await listProjectDocs(projectId)
      setDocs(rows)
      setSelectedId((current) => current ?? rows[0]?.id ?? null)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.work.docsLoadError')))
    } finally {
      setLoading(false)
    }
  }, [projectId, t])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const selected = useMemo(
    () => docs.find((doc) => doc.id === selectedId) ?? null,
    [docs, selectedId],
  )

  const startEdit = () => {
    if (!selected) return
    setDraft(selected.content ?? '')
    setEditing(true)
  }

  const saveDoc = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await saveProjectDoc(projectId, { path: selected.path, content: draft })
      setEditing(false)
      toast.success(t('projects.work.docSaved'))
      void load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.work.docSaveError')))
    } finally {
      setSaving(false)
    }
  }

  const createDoc = async () => {
    if (!newPath.trim()) return
    setSaving(true)
    try {
      const doc = await saveProjectDoc(projectId, {
        path: newPath.trim(),
        content: `# ${newPath.trim().replace(/\.md$/, '')}\n`,
      })
      setNewPath('')
      setCreating(false)
      toast.success(t('projects.work.docCreated'))
      await load()
      setSelectedId(doc.id)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.work.docCreateError')))
    } finally {
      setSaving(false)
    }
  }

  const handleSetStatus = async (section: DocSectionRow, status: DocSectionStatus) => {
    try {
      await setSectionStatus(projectId, section.doc_id, section.id, status)
      toast.success(t('projects.work.sectionStatusUpdated'))
      void load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.work.sectionStatusError')))
    }
  }

  if (loading) return <TableRowsSkeleton rows={4} />
  if (error) return <ApiErrorBanner message={error} onRetry={() => void load()} />

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <div className="space-y-1.5">
        {docs.map((doc) => (
          <button
            key={doc.id}
            type="button"
            className={cn(
              'flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors',
              doc.id === selectedId
                ? 'border-border bg-bg-surface text-text-heading'
                : 'border-transparent text-text-secondary hover:bg-bg-hover/60',
            )}
            onClick={() => {
              setSelectedId(doc.id)
              setEditing(false)
            }}
          >
            <FileText size={14} className="shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1 truncate">{doc.title || doc.path}</span>
            {doc.sections.length > 0 ? (
              <span className="text-[11px] text-text-muted">{doc.sections.length}</span>
            ) : null}
          </button>
        ))}
        {canEdit ? (
          creating ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newPath.trim()) {
                    e.preventDefault()
                    void createDoc()
                  }
                }}
                placeholder={t('projects.work.docPathPlaceholder')}
                className="h-8 text-sm"
                autoFocus
              />
              <Button type="button" size="sm" className="h-8" disabled={saving || !newPath.trim()} onClick={() => void createDoc()}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => setCreating(false)}>
                <X size={13} />
              </Button>
            </div>
          ) : (
            <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => setCreating(true)}>
              <Plus size={13} className="mr-1" />
              {t('projects.work.newDoc')}
            </Button>
          )
        ) : null}
        {docs.length === 0 && !canEdit ? (
          <p className="px-1 text-sm text-text-muted">{t('projects.work.docsEmpty')}</p>
        ) : null}
        <Link
          to={`/knowledge?scope=project&project=${encodeURIComponent(projectId)}`}
          className="mt-2 block px-1 text-[11px] font-medium text-accent hover:underline"
        >
          {t('projects.work.openInKnowledge')}
        </Link>
      </div>

      <div className="min-w-0 space-y-3">
        {!selected ? (
          <Card className="p-6 text-center">
            <p className="text-sm font-medium text-text-heading">{t('projects.work.docsEmptyTitle')}</p>
            <p className="mt-1 text-sm text-text-muted">{t('projects.work.docsEmptyBody')}</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
              <Link
                to={`/knowledge?scope=project&project=${encodeURIComponent(projectId)}`}
                className="text-xs font-medium text-accent hover:underline"
              >
                {t('projects.work.openKnowledge')}
              </Link>
              <Link to="/agents" className="text-xs font-medium text-accent hover:underline">
                {t('projects.work.openAgents')}
              </Link>
            </div>
          </Card>
        ) : (
          <>
            {(selected.linked_requests?.length ?? 0) > 0 ? (
              <Card className="p-3">
                <LinkedRequestsChips requests={selected.linked_requests ?? []} />
              </Card>
            ) : null}

            {selected.sections.length > 0 ? (
              <details className="rounded-lg border border-border/50 bg-bg-surface/40 p-3">
                <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-text-muted">
                  {t('projects.work.sections')}
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {selected.sections.map((section) => (
                    <SectionRow
                      key={section.id}
                      section={section}
                      canEdit={canEdit}
                      onSetStatus={handleSetStatus}
                    />
                  ))}
                </ul>
              </details>
            ) : null}

            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-xs text-text-muted">{selected.path}</p>
                {canEdit ? (
                  editing ? (
                    <div className="flex gap-1.5">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                        {t('projects.work.cancel')}
                      </Button>
                      <Button type="button" size="sm" disabled={saving} onClick={() => void saveDoc()}>
                        {saving ? <Loader2 size={13} className="mr-1 animate-spin" /> : null}
                        {t('projects.work.saveDoc')}
                      </Button>
                    </div>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={startEdit}>
                      <Pencil size={13} className="mr-1" />
                      {t('projects.work.editDoc')}
                    </Button>
                  )
                ) : null}
              </div>
              {editing ? (
                <KnowledgeMarkdownEditor
                  value={draft}
                  onChange={setDraft}
                  writeLabel={t('knowledgePage.editorWrite')}
                  markdownLabel={t('knowledgePage.editorMarkdown')}
                />
              ) : selected.sections.length > 0 ? (
                <DocSectionsEditor
                  docId={selected.id}
                  sections={selected.sections}
                  onChanged={() => void load()}
                  readOnly={!canEdit}
                />
              ) : (
                <MarkdownView content={selected.content ?? ''} />
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
