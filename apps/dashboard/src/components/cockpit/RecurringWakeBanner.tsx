import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { listTriggers, type Trigger } from '../../lib/orchestration-api'
import { inboxPath } from '../../lib/messages-paths'
import { DEFAULT_REPEAT } from '../../lib/thread-schedule'
import PlanDialog, { type PlanSeed } from '../inbox/PlanDialog'
import { Button } from '../ui/button'

function dismissKey(workspaceId: string | number | null): string {
  return `bokito-recurring-wake-dismissed:${workspaceId ?? 'default'}`
}

function readDismissed(workspaceId: string | number | null): boolean {
  try {
    return globalThis.localStorage.getItem(dismissKey(workspaceId)) === '1'
  } catch {
    return false
  }
}

function writeDismissed(workspaceId: string | number | null): void {
  try {
    globalThis.localStorage.setItem(dismissKey(workspaceId), '1')
  } catch {
    // ignore storage failures
  }
}

function hasRecurringThread(triggers: Trigger[]): boolean {
  return triggers.some((row) => (row.kind === 'interval' || row.kind === 'cron') && row.signal_id && !row.purpose)
}

function WatchMark() {
  return (
    <svg viewBox="0 0 120 88" className="h-16 w-[5.5rem] shrink-0" aria-hidden>
      <rect x="8" y="14" width="72" height="58" rx="14" fill="rgb(var(--color-ai) / 0.16)" />
      <rect x="18" y="26" width="40" height="6" rx="3" fill="rgb(var(--color-ai) / 0.55)" />
      <rect x="18" y="38" width="28" height="5" rx="2.5" fill="rgb(var(--color-text-muted) / 0.35)" />
      <rect x="18" y="48" width="34" height="5" rx="2.5" fill="rgb(var(--color-text-muted) / 0.22)" />
      <circle cx="86" cy="52" r="26" fill="rgb(var(--color-bg-surface))" stroke="rgb(var(--color-ai) / 0.75)" strokeWidth="2" />
      <circle cx="86" cy="52" r="3" fill="rgb(var(--color-ai))" />
      <path d="M86 40v12l8 5" stroke="rgb(var(--color-ai))" strokeWidth="2.4" strokeLinecap="round" fill="none" />
    </svg>
  )
}

/**
 * One-time start for new workspaces: a recurring thread in which the lead
 * agent writes to you. Hidden once any recurring thread exists or after dismiss.
 */
export function RecurringWakeBanner() {
  const { t } = useTranslation('nav')
  const { user } = useAuth()
  const navigate = useNavigate()
  const { currentWorkspace } = useWorkspace()
  const workspaceId = currentWorkspace?.id ?? null
  const [dismissed, setDismissed] = useState(() => readDismissed(workspaceId))
  const [hidden, setHidden] = useState(true)
  const [planOpen, setPlanOpen] = useState(false)

  useEffect(() => {
    setDismissed(readDismissed(workspaceId))
  }, [workspaceId])

  useEffect(() => {
    if (dismissed) {
      setHidden(true)
      return
    }
    let cancelled = false
    void listTriggers()
      .then((triggers) => {
        if (!cancelled) setHidden(hasRecurringThread(triggers))
      })
      .catch(() => {
        if (!cancelled) setHidden(true)
      })
    return () => {
      cancelled = true
    }
  }, [dismissed])

  const seed = useMemo<PlanSeed>(
    () => ({
      title: t('cockpitPage.recurringWake.taskName'),
      repeat: DEFAULT_REPEAT,
      agentId: 'lead',
      instructions: t('cockpitPage.recurringWake.promptDefault'),
      recipient: user?.uuid ? { kind: 'user', id: user.uuid } : null,
    }),
    [t, user?.uuid],
  )

  if (hidden || dismissed) return null

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-border/60 bg-bg-elevated"
      data-testid="recurring-wake-banner"
    >
      <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-ai/10" aria-hidden />
      <button
        type="button"
        onClick={() => {
          writeDismissed(workspaceId)
          setDismissed(true)
        }}
        className="absolute right-2 top-2 rounded p-0.5 text-text-muted hover:bg-bg-hover/70 hover:text-text-heading"
        aria-label={t('cockpitPage.recurringWake.dismiss')}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
      <div className="flex items-center gap-4 px-4 py-3.5 pr-10">
        <WatchMark />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-heading">{t('cockpitPage.recurringWake.title')}</p>
          <p className="mt-1 max-w-xl text-xs leading-5 text-text-secondary">{t('cockpitPage.recurringWake.body')}</p>
          <Button type="button" size="sm" className="mt-3" onClick={() => setPlanOpen(true)}>
            {t('cockpitPage.recurringWake.cta')}
          </Button>
        </div>
      </div>
      <PlanDialog
        open={planOpen}
        onOpenChange={setPlanOpen}
        seed={seed}
        onSaved={(created) => {
          writeDismissed(workspaceId)
          setDismissed(true)
          if (created) navigate(inboxPath('scheduled', String(created.id)))
        }}
      />
    </div>
  )
}
