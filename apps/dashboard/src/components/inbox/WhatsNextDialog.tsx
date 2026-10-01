import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createCase, listCaseTypes, type CaseTypeRow } from '../../lib/cases-api'
import { signalTypeLabel } from '../../lib/signal-type-catalog'
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

export type FollowUpWhen = 'today' | 'tomorrow' | 'next_week' | 'none'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  signalId: string
  defaultTitle: string
  saving: boolean
  onSaveReminder: (input: { title: string; when: FollowUpWhen }) => Promise<void>
  onSignalCreated?: () => void
}

export function WhatsNextDialog({
  open,
  onOpenChange,
  signalId,
  defaultTitle,
  saving,
  onSaveReminder,
  onSignalCreated,
}: Props) {
  const { t, i18n } = useTranslation('communication')
  const [mode, setMode] = useState<'remind' | 'signal'>('remind')
  const [title, setTitle] = useState(defaultTitle)
  const [when, setWhen] = useState<FollowUpWhen>('today')
  const [types, setTypes] = useState<CaseTypeRow[] | null>(null)
  const [creatingTypeId, setCreatingTypeId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMode('remind')
    setTitle(defaultTitle)
    setWhen('today')
  }, [open, defaultTitle])

  useEffect(() => {
    if (!open || mode !== 'signal') return
    let cancelled = false
    void listCaseTypes()
      .then((rows) => {
        if (!cancelled) setTypes(rows.filter((row) => row.enabled !== false))
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
    async (type: CaseTypeRow) => {
      if (creatingTypeId) return
      setCreatingTypeId(type.id)
      try {
        await createCase({ case_type_id: type.id, signal_id: signalId })
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
              ['signal', 'whatsNextSignal'],
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
                  <span className="min-w-0 flex-1 truncate-fade">
                    {signalTypeLabel(type, i18n.language)}
                  </span>
                  {creatingTypeId === type.id ? (
                    <span className="text-2xs text-text-muted">{t('threadChrome.creating')}</span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        )}
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
