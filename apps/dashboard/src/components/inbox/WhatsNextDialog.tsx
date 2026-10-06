import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, FolderKanban } from 'lucide-react'
import { fileTicket, listCategories, type CategoryRow } from '../../lib/tickets-api'
import { Hashtag } from '../ui/HashtagMark'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { cn } from '../../lib/utils'
import { HandledExternallyForm } from './HandledExternallyForm'

export type FollowUpWhen = 'today' | 'tomorrow' | 'next_week' | 'none'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  signalId: string
  defaultTitle: string
  saving: boolean
  onSaveReminder: (input: { title: string; when: FollowUpWhen }) => Promise<void>
  onSignalCreated?: () => void
  /** The conversation was logged as handled outside Bokito. */
  onHandledExternally?: (info: { closed: boolean }) => void
}

export function WhatsNextDialog({
  open,
  onOpenChange,
  signalId,
  defaultTitle,
  saving,
  onSaveReminder,
  onSignalCreated,
  onHandledExternally,
}: Props) {
  const { t } = useTranslation('communication')
  const { t: tn } = useTranslation('nav')
  const [mode, setMode] = useState<'remind' | 'signal' | 'handled'>('remind')
  const [title, setTitle] = useState(defaultTitle)
  const [when, setWhen] = useState<FollowUpWhen>('today')
  const [types, setTypes] = useState<CategoryRow[] | null>(null)
  const [creatingTypeId, setCreatingTypeId] = useState<string | null>(null)
  /** Category picked whose playbook has projects: the project choice comes next. */
  const [pickProjectFor, setPickProjectFor] = useState<CategoryRow | null>(null)

  useEffect(() => {
    if (!open) return
    setMode('remind')
    setPickProjectFor(null)
    setTitle(defaultTitle)
    setWhen('today')
  }, [open, defaultTitle])

  useEffect(() => {
    if (!open || mode !== 'signal') return
    let cancelled = false
    void listCategories()
      .then((rows) => {
        if (!cancelled) setTypes(rows)
      })
      .catch(() => {
        if (!cancelled) setTypes([])
      })
    return () => {
      cancelled = true
    }
  }, [open, mode])

  const handleRemind = useCallback(async () => {
    const trimmed = title.trim()
    if (!trimmed) return
    await onSaveReminder({ title: trimmed, when })
  }, [title, when, onSaveReminder])

  const handleSignal = useCallback(
    async (type: CategoryRow, projectId?: string | null) => {
      if (creatingTypeId) return
      if (projectId === undefined && type.project_choices.length > 0) {
        setPickProjectFor(type)
        return
      }
      setCreatingTypeId(type.id)
      try {
        await fileTicket(signalId, type.id, projectId)
        setPickProjectFor(null)
        onOpenChange(false)
        onSignalCreated?.()
      } finally {
        setCreatingTypeId(null)
      }
    },
    [creatingTypeId, signalId, onOpenChange, onSignalCreated],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('threadChrome.whatsNextTitle')}</DialogTitle>
          <DialogDescription>{t('threadChrome.whatsNextHint')}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 rounded-lg border border-border/50 bg-bg-elevated p-0.5">
          {(
            [
              ['remind', 'whatsNextRemind'],
              ['signal', 'whatsNextTicket'],
              ['handled', 'whatsNextHandled'],
            ] as const
          ).map(([value, key]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={cn(
                'flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                mode === value
                  ? 'bg-bg-surface text-text-primary '
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {t(`threadChrome.${key}`)}
            </button>
          ))}
        </div>
        {mode === 'remind' ? (
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-text-muted">
                {t('threadChrome.planFollowUpTitleLabel')}
              </span>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </label>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">
                {t('threadChrome.planFollowUpWhen')}
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    ['today', 'planFollowUpToday'],
                    ['tomorrow', 'planFollowUpTomorrow'],
                    ['next_week', 'planFollowUpNextWeek'],
                    ['none', 'planFollowUpNoDate'],
                  ] as const
                ).map(([value, key]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setWhen(value)}
                    className={
                      when === value
                        ? 'rounded-md border border-border-light bg-bg-hover px-2.5 py-1.5 text-left text-xs font-medium text-accent'
                        : 'rounded-md border border-border/60 bg-bg-surface px-2.5 py-1.5 text-left text-xs text-text-secondary hover:border-border-light'
                    }
                  >
                    {t(`threadChrome.${key}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : mode === 'handled' ? (
          <HandledExternallyForm
            threadId={signalId}
            onCancel={() => onOpenChange(false)}
            onDone={(info) => {
              onOpenChange(false)
              onHandledExternally?.(info)
            }}
          />
        ) : pickProjectFor ? (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setPickProjectFor(null)}
              className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-primary"
            >
              <ArrowLeft size={12} />
              <Hashtag name={pickProjectFor.name} category />
            </button>
            <p className="text-xs text-text-muted">{tn('tickets.chooseProject')}</p>
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {[...pickProjectFor.project_choices, { id: '', name: tn('tickets.noProject') }].map((choice) => (
                <button
                  key={choice.id || 'none'}
                  type="button"
                  disabled={creatingTypeId != null}
                  onClick={() => void handleSignal(pickProjectFor, choice.id || null)}
                  className="flex w-full items-center gap-2 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-sm text-text-primary transition-colors hover:border-border/60 hover:bg-bg-hover/60 disabled:opacity-50"
                >
                  {choice.id ? <FolderKanban size={13} className="shrink-0 text-text-muted" /> : null}
                  <span className="min-w-0 flex-1 truncate-fade">{choice.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {types === null ? (
              <p className="px-1 py-2 text-xs text-text-muted">{t('threadChrome.whatsNextLoadingTypes')}</p>
            ) : types.length === 0 ? (
              <p className="px-1 py-2 text-xs text-text-muted">{t('threadChrome.whatsNextNoTypes')}</p>
            ) : (
              types.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  disabled={creatingTypeId != null}
                  onClick={() => void handleSignal(type)}
                  className="flex w-full items-center justify-between rounded-lg border border-transparent px-2.5 py-1.5 text-left text-sm text-text-primary transition-colors hover:border-border/60 hover:bg-bg-hover/60 disabled:opacity-50"
                >
                  <Hashtag name={type.name} category className="min-w-0 flex-1" />
                  {creatingTypeId === type.id ? (
                    <span className="text-2xs text-text-muted">{t('threadChrome.creating')}</span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        )}
        {mode === 'handled' ? null : (
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('threadChrome.cancel', { defaultValue: 'Cancel' })}
          </Button>
          {mode === 'remind' ? (
            <Button
              type="button"
              disabled={saving || !title.trim()}
              onClick={() => void handleRemind()}
            >
              {saving ? t('threadChrome.saving', { defaultValue: 'Saving…' }) : t('threadChrome.whatsNextSave')}
            </Button>
          ) : null}
        </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function scheduledForIso(when: FollowUpWhen): string {
  const at = new Date()
  if (when === 'none') return at.toISOString()
  if (when === 'today') {
    at.setHours(9, 0, 0, 0)
    if (at.getTime() < Date.now()) return new Date().toISOString()
    return at.toISOString()
  }
  if (when === 'tomorrow') {
    at.setDate(at.getDate() + 1)
    at.setHours(9, 0, 0, 0)
    return at.toISOString()
  }
  at.setDate(at.getDate() + 7)
  at.setHours(9, 0, 0, 0)
  return at.toISOString()
}
