import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderKanban, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import type { InboxThread, PatchThreadInput } from '../../lib/inbox-api'
import { normalizeHashtag, stripHash } from '../../lib/hashtag'
import { listSignalTags, type SignalTag } from '../../lib/signals-api'
import {
  createCategory,
  fileTicket,
  listCategories,
  type CategoryRow,
  type ProjectChoice,
  type TicketStageField,
} from '../../lib/tickets-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Hashtag, HashtagMark } from '../ui/HashtagMark'
import { cn } from '../../lib/utils'
import { TicketFieldControl } from './TicketFieldControl'

type Phase = 'pick' | 'create' | 'project' | 'intake' | 'replace'

type PendingFile = {
  tagId: string
  name: string
  choices: ProjectChoice[]
  intakeFields: TicketStageField[]
  projectId?: string | null
  projectChosen?: boolean
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  thread: InboxThread
  onPatch?: (input: PatchThreadInput) => Promise<void>
  onTicketChanged?: () => void
}

/**
 * One modal for free hashtags and action-tag filing on a conversation.
 * Soft `#` input, typeahead, project settle, and replace confirm when another
 * action tag is already filed.
 */
export function HashtagPickerModal({ open, onOpenChange, thread, onPatch, onTicketChanged }: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [query, setQuery] = useState('')
  const [registry, setRegistry] = useState<SignalTag[]>([])
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<Phase>('pick')
  const [pending, setPending] = useState<PendingFile | null>(null)
  const [replaceNext, setReplaceNext] = useState<PendingFile | null>(null)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})

  const tags = thread.tags ?? []
  const currentTicket =
    thread.ticket && thread.ticket.status !== 'proposed' ? thread.ticket : null

  useEffect(() => {
    if (!open || !token) return
    let cancelled = false
    setLoading(true)
    setQuery('')
    setPhase('pick')
    setPending(null)
    setReplaceNext(null)
    setFieldValues({})
    void Promise.all([listSignalTags(token), listCategories()])
      .then(([rows, cats]) => {
        if (cancelled) return
        setRegistry(rows)
        setCategories(cats)
      })
      .catch(() => {
        if (cancelled) return
        setRegistry([])
        setCategories([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, token])

  const normalized = normalizeHashtag(query)
  const categoryById = useMemo(() => new Map(categories.map((row) => [row.id, row])), [categories])

  const matches = useMemo(() => {
    const q = normalized
    return registry
      .filter((row) => {
        if (!q) return true
        return row.name.includes(q) || row.description.toLowerCase().includes(q)
      })
      .sort((a, b) => {
        if (a.isCategory !== b.isCategory) return a.isCategory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }, [registry, normalized])

  const exactMatch = registry.find((row) => row.name === normalized) ?? null
  const isNewName = Boolean(normalized) && !exactMatch

  const close = () => onOpenChange(false)

  const addFree = async (name: string) => {
    const clean = normalizeHashtag(name)
    if (!clean || !onPatch) return
    if (tags.includes(clean)) {
      close()
      return
    }
    setBusy(true)
    try {
      await onPatch({ tags: [...tags, clean] })
      close()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('tags.createError')))
    } finally {
      setBusy(false)
    }
  }

  const beginFile = (
    tagId: string,
    name: string,
    choices: ProjectChoice[],
    intakeFields: TicketStageField[],
  ) => {
    const next: PendingFile = { tagId, name, choices, intakeFields }
    if (currentTicket && currentTicket.tagId !== tagId) {
      setReplaceNext(next)
      setPhase('replace')
      return
    }
    continueAfterReplace(next)
  }

  const continueAfterReplace = (next: PendingFile) => {
    if (next.choices.length > 0) {
      setPending(next)
      setPhase('project')
      return
    }
    continueAfterProject({ ...next, projectId: undefined, projectChosen: true })
  }

  const continueAfterProject = (next: PendingFile) => {
    if (next.intakeFields.length > 0) {
      setPending(next)
      setFieldValues({})
      setPhase('intake')
      return
    }
    void runFile(next)
  }

  const runFile = async (target: PendingFile, values?: Record<string, string>) => {
    setBusy(true)
    try {
      const projectArg = target.projectChosen ? (target.projectId ?? null) : undefined
      const fields =
        target.intakeFields.length > 0
          ? Object.fromEntries(
              target.intakeFields.map((field) => [field.key, (values ?? fieldValues)[field.key] ?? '']),
            )
          : undefined
      await fileTicket(String(thread.id), target.tagId, projectArg, fields)
      onTicketChanged?.()
      close()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('tags.fileError')))
    } finally {
      setBusy(false)
    }
  }

  const pickRow = (row: SignalTag) => {
    if (row.isCategory) {
      const category = categoryById.get(row.id)
      beginFile(
        row.id,
        row.name,
        category?.project_choices ?? [],
        category?.intake_fields ?? [],
      )
      return
    }
    void addFree(row.name)
  }

  const intakeValid =
    !pending ||
    pending.intakeFields.every(
      (field) => !field.required || Boolean((fieldValues[field.key] || '').trim()),
    )

  const makeActionTag = async () => {
    if (!normalized) return
    setBusy(true)
    try {
      const created = await createCategory({
        name: normalized,
        playbook_name: normalized,
      })
      setCategories((prev) => [...prev, created])
      setRegistry((prev) => [
        ...prev.filter((row) => row.id !== created.id),
        {
          id: created.id,
          name: created.name,
          description: created.description,
          count: created.count,
          isCategory: true,
          workstreamId: created.workstream_id,
          workstreamName: created.workstream_name ?? created.name,
          pinned: created.pinned,
          showInNav: created.show_in_nav,
        },
      ])
      setBusy(false)
      beginFile(
        created.id,
        created.name,
        created.project_choices ?? [],
        created.intake_fields ?? [],
      )
    } catch (err) {
      setBusy(false)
      toast.error(formatApiErrorMessage(err, t('tags.createError')))
    }
  }

  const submitQuery = () => {
    if (!normalized) return
    if (exactMatch) {
      pickRow(exactMatch)
      return
    }
    setPhase('create')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-3" data-testid="hashtag-picker-modal">
        {phase === 'replace' && replaceNext ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('tags.replaceTitle')}</DialogTitle>
              <DialogDescription>
                {t('tags.replaceBody', {
                  current: currentTicket?.name ?? '',
                  next: replaceNext.name,
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setPhase('pick')}>
                {t('tags.cancel')}
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  const next = replaceNext
                  setReplaceNext(null)
                  continueAfterReplace(next)
                }}
              >
                {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
                {t('tags.replaceConfirm')}
              </Button>
            </DialogFooter>
          </>
        ) : phase === 'project' && pending ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('tags.chooseProject')}</DialogTitle>
              <DialogDescription>
                <Hashtag name={pending.name} category className="text-sm text-text-heading" />
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {pending.choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    continueAfterProject({
                      ...pending,
                      projectId: choice.id,
                      projectChosen: true,
                    })
                  }
                  className="flex w-full items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-left text-sm hover:bg-bg-hover/70 disabled:opacity-40"
                >
                  <FolderKanban size={14} className="text-text-muted" />
                  {choice.name}
                </button>
              ))}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  continueAfterProject({ ...pending, projectId: null, projectChosen: true })
                }
                className="flex w-full items-center gap-2 rounded-md border border-dashed border-border/60 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-hover/70 disabled:opacity-40"
              >
                {t('tags.noProject')}
              </button>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setPhase('pick')}>
                {t('tags.cancel')}
              </Button>
            </DialogFooter>
          </>
        ) : phase === 'intake' && pending ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('tags.intakeTitle')}</DialogTitle>
              <DialogDescription>
                <Hashtag name={pending.name} category className="text-sm text-text-heading" />
                <span className="mt-1 block">{t('tags.intakeHint')}</span>
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {pending.intakeFields.map((field) => (
                <label key={field.key} className="block space-y-1">
                  <span className="text-xs font-medium text-text-heading">
                    {field.name}
                    {field.required ? (
                      <span className="ml-1 text-status-error">*</span>
                    ) : null}
                  </span>
                  <TicketFieldControl
                    field={field}
                    value={fieldValues[field.key] ?? ''}
                    disabled={busy}
                    onChange={(value) =>
                      setFieldValues((prev) => ({ ...prev, [field.key]: value }))
                    }
                  />
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setPhase('pick')}>
                {t('tags.cancel')}
              </Button>
              <Button
                type="button"
                disabled={busy || !intakeValid}
                onClick={() => void runFile(pending)}
              >
                {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
                {t('tags.intakeContinue')}
              </Button>
            </DialogFooter>
          </>
        ) : phase === 'create' ? (
          <>
            <DialogHeader>
              <DialogTitle>
                <span className="inline-flex items-center gap-1">
                  <HashtagMark category />
                  {normalized}
                </span>
              </DialogTitle>
              <DialogDescription>{t('tags.modalHint')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <button
                type="button"
                disabled={busy || !onPatch}
                onClick={() => void addFree(normalized)}
                className="flex w-full flex-col items-start gap-0.5 rounded-md border border-border/60 px-3 py-2.5 text-left hover:bg-bg-hover/70 disabled:opacity-40"
              >
                <span className="text-sm font-medium text-text-heading">{t('tags.applyFree')}</span>
                <span className="text-xs text-text-muted">{t('tags.applyFreeHint')}</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void makeActionTag()}
                className="flex w-full flex-col items-start gap-0.5 rounded-md border border-accent/40 bg-accent/5 px-3 py-2.5 text-left hover:bg-accent/10 disabled:opacity-40"
              >
                <span className="text-sm font-medium text-text-heading">{t('tags.makeActionTag')}</span>
                <span className="text-xs text-text-muted">
                  {t('tags.makeActionTagHint', { name: normalized })}
                </span>
              </button>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setPhase('pick')}>
                {t('tags.cancel')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('tags.modalTitle')}</DialogTitle>
              <DialogDescription>{t('tags.modalHint')}</DialogDescription>
            </DialogHeader>
            <label className="flex h-9 items-center gap-1 rounded-md border border-border bg-bg-input px-2">
              <HashtagMark className="text-sm" />
              <input
                autoFocus
                value={query}
                disabled={busy}
                onChange={(e) => setQuery(stripHash(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submitQuery()
                  }
                }}
                placeholder={t('tags.searchPlaceholder')}
                aria-label={t('tags.searchPlaceholder')}
                className="h-full w-full bg-transparent text-sm text-text-primary outline-none"
              />
            </label>
            <div className="max-h-64 overflow-y-auto">
              {loading ? (
                <p className="px-1 py-3 text-xs text-text-muted">{t('tags.busy')}</p>
              ) : matches.length === 0 && !isNewName ? (
                <p className="px-1 py-3 text-xs text-text-muted">{t('tags.noMatches')}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {matches.map((row) => {
                    const applied = !row.isCategory && tags.includes(row.name)
                    const filed = row.isCategory && currentTicket?.tagId === row.id
                    const on = applied || filed
                    return (
                      <button
                        key={row.id}
                        type="button"
                        disabled={busy || on}
                        onClick={() => pickRow(row)}
                        title={
                          row.description
                            ? `${row.isCategory ? t('tags.actionTag') : t('tags.freeHashtag')}: ${row.description}`
                            : row.isCategory
                              ? t('tags.actionTag')
                              : t('tags.freeHashtag')
                        }
                        className={cn(
                          'inline-flex h-7 max-w-full items-center rounded-full border px-2.5 text-xs transition-colors disabled:cursor-default',
                          row.isCategory
                            ? 'border-accent/40 bg-accent/10 text-text-heading hover:border-accent/60 hover:bg-accent/15'
                            : 'border-border/70 bg-bg-subtle/50 text-text-heading hover:border-border hover:bg-bg-hover/70',
                          on && 'opacity-45',
                        )}
                      >
                        <Hashtag name={row.name} category={row.isCategory} />
                      </button>
                    )
                  })}
                  {isNewName ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setPhase('create')}
                      title={t('tags.applyFree')}
                      className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-dashed border-border/80 bg-transparent px-2.5 text-xs text-text-heading transition-colors hover:border-accent/50 hover:bg-accent/5 disabled:opacity-40"
                    >
                      <HashtagMark />
                      <span className="truncate">{normalized}</span>
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
