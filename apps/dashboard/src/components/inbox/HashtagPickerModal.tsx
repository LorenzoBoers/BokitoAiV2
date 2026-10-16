import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import type { InboxThread, PatchThreadInput } from '../../lib/inbox-api'
import { normalizeHashtag } from '../../lib/hashtag'
import { listSignalTags, type SignalTag } from '../../lib/signals-api'
import {
  createCategory,
  fileTicket,
  listCategories,
  type CategoryRow,
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
import { Hashtag } from '../ui/HashtagMark'
import { TagSetPicker } from '../ui/TagSetPicker'
import { TicketFieldControl } from './TicketFieldControl'

type Phase = 'pick' | 'create' | 'intake' | 'replace'

type PendingFile = {
  tagId: string
  name: string
  intakeFields: TicketStageField[]
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  thread: InboxThread
  onPatch?: (input: PatchThreadInput) => Promise<void>
  onTicketChanged?: () => void
}

/**
 * Thread tag picker: multi-select free tags / maps via TagSetPicker, then apply
 * once. Action tags still file immediately (intake / replace when needed).
 */
export function HashtagPickerModal({ open, onOpenChange, thread, onPatch, onTicketChanged }: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [registry, setRegistry] = useState<SignalTag[]>([])
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<Phase>('pick')
  const [createName, setCreateName] = useState('')
  const [pending, setPending] = useState<PendingFile | null>(null)
  const [replaceNext, setReplaceNext] = useState<PendingFile | null>(null)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})

  const tags = thread.tags ?? []
  const currentTicket =
    thread.ticket && thread.ticket.status !== 'proposed' ? thread.ticket : null
  const categoryById = useMemo(() => new Map(categories.map((row) => [row.id, row])), [categories])

  useEffect(() => {
    if (!open || !token) return
    let cancelled = false
    setPhase('pick')
    setPending(null)
    setReplaceNext(null)
    setFieldValues({})
    setCreateName('')
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
    return () => {
      cancelled = true
    }
  }, [open, token])

  const close = () => onOpenChange(false)

  const applyTags = async (names: string[]) => {
    if (!onPatch) return
    const next = [...tags]
    for (const name of names) {
      const clean = normalizeHashtag(name)
      if (!clean || next.includes(clean) || (thread.inheritedTags ?? []).includes(clean)) continue
      next.push(clean)
    }
    if (next.length === tags.length) {
      close()
      return
    }
    await onPatch({ tags: next })
  }

  const beginFile = (tagId: string, name: string, intakeFields: TicketStageField[]) => {
    const next: PendingFile = { tagId, name, intakeFields }
    if (currentTicket && currentTicket.tagId !== tagId) {
      setReplaceNext(next)
      setPhase('replace')
      return
    }
    continueAfterReplace(next)
  }

  const continueAfterReplace = (next: PendingFile) => {
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
      const fields =
        target.intakeFields.length > 0
          ? Object.fromEntries(
              target.intakeFields.map((field) => [field.key, (values ?? fieldValues)[field.key] ?? '']),
            )
          : undefined
      await fileTicket(String(thread.id), target.tagId, undefined, fields)
      onTicketChanged?.()
      close()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('tags.fileError')))
    } finally {
      setBusy(false)
    }
  }

  const makeActionTag = async () => {
    const normalized = normalizeHashtag(createName)
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
          showInNav: created.show_in_nav,
          groupId: created.group_id ?? null,
          groupName: created.group_name ?? null,
          folders: created.folders ?? [],
          aiAutoTag: true,
          sendMode: created.send_mode,
        },
      ])
      setBusy(false)
      beginFile(created.id, created.name, created.intake_fields ?? [])
    } catch (err) {
      setBusy(false)
      toast.error(formatApiErrorMessage(err, t('tags.createError')))
    }
  }

  const intakeValid =
    !pending ||
    pending.intakeFields.every(
      (field) => !field.required || Boolean((fieldValues[field.key] || '').trim()),
    )

  if (phase === 'pick') {
    return (
      <TagSetPicker
        open={open}
        onOpenChange={onOpenChange}
        mode="thread"
        title={t('tags.modalTitle')}
        description={t('tags.modalHintMulti', {
          defaultValue: t('tags.modalHint'),
        })}
        confirmLabel={t('tags.applySelected', { defaultValue: 'Add tags' })}
        appliedNames={tags}
        inheritedNames={thread.inheritedTags ?? []}
        onConfirm={applyTags}
        onPickAction={(tagId, name) => {
          const category = categoryById.get(tagId)
          beginFile(tagId, name, category?.intake_fields ?? [])
        }}
        onCreateChoice={(name) => {
          setCreateName(name)
          setPhase('create')
        }}
      />
    )
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
        ) : phase === 'intake' && pending ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('tags.intakeTitle')}</DialogTitle>
              <DialogDescription>
                <Hashtag name={pending.name} category />
                <span className="mt-1 block">{t('tags.intakeHint')}</span>
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {pending.intakeFields.map((field) => (
                <label key={field.key} className="block space-y-1">
                  <span className="text-xs font-medium text-text-heading">
                    {field.name}
                    {field.required ? <span className="ml-1 text-status-error">*</span> : null}
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
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                <Hashtag name={normalizeHashtag(createName)} category />
              </DialogTitle>
              <DialogDescription>{t('tags.modalHint')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <button
                type="button"
                disabled={busy || !onPatch}
                onClick={() => {
                  void applyTags([createName]).then(() => close())
                }}
                className="flex w-full flex-col items-start gap-0.5 rounded-lg border border-border/60 px-3 py-2.5 text-left hover:bg-bg-hover/70 disabled:opacity-40"
              >
                <span className="text-sm font-medium text-text-heading">{t('tags.applyFree')}</span>
                <span className="text-xs text-text-muted">{t('tags.applyFreeHint')}</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void makeActionTag()}
                className="flex w-full flex-col items-start gap-0.5 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2.5 text-left hover:bg-accent/10 disabled:opacity-40"
              >
                <span className="text-sm font-medium text-text-heading">{t('tags.makeActionTag')}</span>
                <span className="text-xs text-text-muted">
                  {t('tags.makeActionTagHint', { name: normalizeHashtag(createName) })}
                </span>
              </button>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setPhase('pick')}>
                {t('tags.cancel')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
