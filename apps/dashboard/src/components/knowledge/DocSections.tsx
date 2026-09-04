import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import MarkdownView from '../docs/MarkdownView'
import { KnowledgeMarkdownEditor } from './KnowledgeMarkdownEditor'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  createDocSection,
  deleteDocSection,
  updateDocSection,
  type DocSectionRow,
  type DocSectionStatus,
} from '../../lib/workspace-api'
import { cn } from '../../lib/utils'

const STATUS_ORDER: DocSectionStatus[] = ['draft', 'review', 'final']

const STATUS_STYLES: Record<DocSectionStatus, string> = {
  draft: 'border-border/60 bg-bg-elevated/60 text-text-muted',
  review: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  final: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
}

export function SectionStatusChip({
  status,
  onChange,
  disabled,
}: {
  status: DocSectionStatus
  onChange?: (next: DocSectionStatus) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('nav')
  const label = t(`knowledgePage.sectionStatus.${status}`, { defaultValue: status })
  const next = STATUS_ORDER[(STATUS_ORDER.indexOf(status) + 1) % STATUS_ORDER.length]
  if (!onChange) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
          STATUS_STYLES[status],
        )}
      >
        {label}
      </span>
    )
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(next)}
      title={t('knowledgePage.sectionStatusCycle', {
        next: t(`knowledgePage.sectionStatus.${next}`, { defaultValue: next }),
      })}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
        STATUS_STYLES[status],
        disabled ? 'opacity-60' : 'hover:opacity-80',
      )}
    >
      {label}
    </button>
  )
}

/**
 * Section-based page editor: knowledge lives as small sections (one topic,
 * ~150-400 words) with their own maturity status. Edits touch one section at
 * a time; the page render on the server stays derived.
 */
export function DocSectionsEditor({
  docId,
  sections,
  onChanged,
  readOnly = false,
}: {
  docId: string
  sections: DocSectionRow[]
  onChanged: () => void | Promise<void>
  readOnly?: boolean
}) {
  const { t } = useTranslation('nav')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [draftHeading, setDraftHeading] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newHeading, setNewHeading] = useState('')
  const [newContent, setNewContent] = useState('')

  const startEdit = useCallback((section: DocSectionRow) => {
    setEditingId(section.id)
    setDraft(section.content)
    setDraftHeading(section.heading)
  }, [])

  const saveSection = useCallback(
    async (section: DocSectionRow) => {
      setBusyId(section.id)
      try {
        await updateDocSection(docId, section.id, {
          content: draft,
          heading: section.heading ? draftHeading : undefined,
        })
        setEditingId(null)
        toast.success(t('knowledgePage.sectionSaved'))
        await onChanged()
      } catch (err) {
        toast.error(formatApiErrorMessage(err, t('knowledgePage.saveError')))
      } finally {
        setBusyId(null)
      }
    },
    [docId, draft, draftHeading, onChanged, t],
  )

  const setStatus = useCallback(
    async (section: DocSectionRow, status: DocSectionStatus) => {
      setBusyId(section.id)
      try {
        await updateDocSection(docId, section.id, { status })
        await onChanged()
      } catch (err) {
        toast.error(formatApiErrorMessage(err, t('knowledgePage.saveError')))
      } finally {
        setBusyId(null)
      }
    },
    [docId, onChanged, t],
  )

  const removeSection = useCallback(
    async (section: DocSectionRow) => {
      if (!window.confirm(t('knowledgePage.sectionDeleteConfirm', { heading: section.heading }))) {
        return
      }
      setBusyId(section.id)
      try {
        await deleteDocSection(docId, section.id)
        toast.success(t('knowledgePage.sectionDeleted'))
        await onChanged()
      } catch (err) {
        toast.error(formatApiErrorMessage(err, t('knowledgePage.deleteError')))
      } finally {
        setBusyId(null)
      }
    },
    [docId, onChanged, t],
  )

  const addSection = useCallback(async () => {
    const heading = newHeading.trim()
    if (!heading) return
    setBusyId('new')
    try {
      await createDocSection(docId, { heading, content: newContent })
      setAdding(false)
      setNewHeading('')
      setNewContent('')
      toast.success(t('knowledgePage.sectionAdded'))
      await onChanged()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('knowledgePage.saveError')))
    } finally {
      setBusyId(null)
    }
  }, [docId, newContent, newHeading, onChanged, t])

  const ordered = [...sections]
    .sort((a, b) => a.position - b.position)
    // Hide an empty intro block (page-title-only preamble).
    .filter((s) => s.heading || s.content.trim())

  return (
    <div className="space-y-1.5">
      {ordered.map((section) => {
        const isEditing = editingId === section.id
        const busy = busyId === section.id
        return (
          <div
            key={section.id}
            className={cn(
              'group rounded-xl border border-transparent px-3 py-2 transition-colors',
              isEditing ? 'border-border/60 bg-bg-elevated/40' : 'hover:border-border/40',
            )}
          >
            <div className="flex items-center gap-2">
              {isEditing && section.heading ? (
                <Input
                  value={draftHeading}
                  onChange={(e) => setDraftHeading(e.target.value)}
                  className="h-7 flex-1 text-sm font-semibold"
                />
              ) : (
                <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-text-heading">
                  {section.heading || t('knowledgePage.sectionIntro')}
                </h2>
              )}
              <SectionStatusChip
                status={section.status}
                onChange={readOnly ? undefined : (next) => void setStatus(section, next)}
                disabled={busy}
              />
              {!readOnly && !isEditing ? (
                <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    title={t('knowledgePage.sectionEdit')}
                    onClick={() => startEdit(section)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    title={t('knowledgePage.delete')}
                    onClick={() => void removeSection(section)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ) : null}
            </div>
            {section.summary && !isEditing ? (
              <p className="mt-0.5 text-[11px] text-text-muted">{section.summary}</p>
            ) : null}
            {isEditing ? (
              <div className="mt-2 space-y-2">
                <KnowledgeMarkdownEditor
                  value={draft}
                  onChange={setDraft}
                  minHeightClassName="min-h-[20vh]"
                  writeLabel={t('knowledgePage.editorWrite')}
                  markdownLabel={t('knowledgePage.editorMarkdown')}
                />
                <p className="text-[10px] text-text-muted">{t('knowledgePage.sectionGuideline')}</p>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} disabled={busy}>
                    {t('knowledgePage.cancel')}
                  </Button>
                  <Button size="sm" onClick={() => void saveSection(section)} disabled={busy}>
                    {busy ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="mr-1.5 h-3 w-3" />
                    )}
                    {t('knowledgePage.save')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-1">
                <MarkdownView content={section.content} />
              </div>
            )}
          </div>
        )
      })}
      {!readOnly ? (
        adding ? (
          <div className="rounded-xl border border-border/60 bg-bg-elevated/40 px-3 py-2">
            <Input
              value={newHeading}
              onChange={(e) => setNewHeading(e.target.value)}
              placeholder={t('knowledgePage.sectionHeadingPlaceholder')}
              className="mb-2 h-8 text-sm font-semibold"
              autoFocus
            />
            <KnowledgeMarkdownEditor
              value={newContent}
              onChange={setNewContent}
              minHeightClassName="min-h-[16vh]"
              writeLabel={t('knowledgePage.editorWrite')}
              markdownLabel={t('knowledgePage.editorMarkdown')}
            />
            <p className="mt-1.5 text-[10px] text-text-muted">{t('knowledgePage.sectionGuideline')}</p>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)} disabled={busyId === 'new'}>
                {t('knowledgePage.cancel')}
              </Button>
              <Button size="sm" onClick={() => void addSection()} disabled={busyId === 'new' || !newHeading.trim()}>
                {busyId === 'new' ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                {t('knowledgePage.add')}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/60 px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent/40 hover:text-text-secondary"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('knowledgePage.sectionAdd')}
          </button>
        )
      ) : null}
    </div>
  )
}
