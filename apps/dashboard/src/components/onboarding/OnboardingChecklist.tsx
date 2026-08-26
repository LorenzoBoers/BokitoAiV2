import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Bot, ListChecks, Mail, MessageSquare, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { appScopedGet, appScopedPost } from '../../lib/api'
import { appRoutes } from '../../api/routes/app.routes'
import { inboxPath } from '../../lib/messages-paths'

export type OnboardingStepId = 'email' | 'company' | 'assistant' | 'first_decision' | 'team'

export interface OnboardingStatus {
  steps: { id: OnboardingStepId; done: boolean }[]
  completed: boolean
}

function dismissKey(tenantId: string | null): string {
  return `bokito-onboarding-dismissed:${tenantId ?? 'default'}`
}

export function useOnboardingStatus(): {
  status: OnboardingStatus | null
  loading: boolean
  error: string | null
  retry: () => void
  dismissed: boolean
  dismiss: () => void
} {
  const { token, user } = useAuth()
  const tenantId = user?.organisationId ?? null
  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadNonce, setLoadNonce] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const retry = useCallback(() => setLoadNonce((n) => n + 1), [])

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(dismissKey(tenantId)) === '1')
    } catch {
      setDismissed(false)
    }
  }, [tenantId])

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(dismissKey(tenantId), '1')
    } catch {
      // ignore storage failures
    }
    setDismissed(true)
  }, [tenantId])

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    appScopedGet<OnboardingStatus>(appRoutes.onboarding.status, token)
      .then((res) => {
        if (!cancelled) setStatus(res)
      })
      .catch(() => {
        if (!cancelled) {
          setStatus(null)
          setError('LOAD_FAILED')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, loadNonce])

  return { status, loading, error, retry, dismissed, dismiss }
}

const STEP_META: Record<OnboardingStepId, { to: string }> = {
  email: { to: '/settings/channels' },
  company: { to: '/knowledge' },
  assistant: { to: '/communication/new' },
  first_decision: { to: '/communication' },
  team: { to: '/settings/members' },
}

export function useDemoThread(): { start: () => void; starting: boolean } {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [starting, setStarting] = useState(false)

  const start = useCallback(() => {
    if (!token || starting) return
    setStarting(true)
    appScopedPost<{ signal_id?: string }>(appRoutes.onboarding.demoThread, {}, token)
      .then((res) => {
        if (res?.signal_id) {
          navigate(inboxPath('open', res.signal_id))
        }
      })
      .catch(() => undefined)
      .finally(() => setStarting(false))
  }, [token, starting, navigate])

  return { start, starting }
}

const ASSISTANT_SETUP_TO = `/communication/new?prefill=${encodeURIComponent(
  'Help me set up this workspace. Walk me through it step by step.',
)}`

function NextStepCta({ step }: { step: { id: OnboardingStepId; done: boolean } }) {
  const { t } = useTranslation('communication')
  const { start, starting } = useDemoThread()
  const meta = STEP_META[step.id]

  if (step.id === 'first_decision') {
    return (
      <button
        type="button"
        onClick={start}
        disabled={starting}
        className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-60"
      >
        {t(`onboarding.steps.${step.id}.cta`)}
      </button>
    )
  }
  return (
    <Link
      to={meta.to}
      className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
    >
      {t(`onboarding.steps.${step.id}.cta`)}
    </Link>
  )
}

/** Full first-run card: one next action + Setup guide + assistant. */
export default function OnboardingChecklist({
  status,
  onDismiss,
}: {
  status: OnboardingStatus
  onDismiss?: () => void
}) {
  const { t } = useTranslation('communication')
  const doneCount = status.steps.filter((step) => step.done).length
  const nextStep = status.steps.find((step) => !step.done)

  return (
    <div className="relative mx-auto w-full max-w-[520px] space-y-4 py-10 px-4 text-center">
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          title={t('onboarding.dismiss')}
          aria-label={t('onboarding.dismiss')}
          className="absolute right-2 top-4 flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
        >
          <X size={14} />
        </button>
      ) : null}
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/12 text-accent">
        <Sparkles size={20} />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-text-heading">{t('onboarding.continueTitle')}</h2>
        <p className="text-sm text-text-secondary">{t('onboarding.continueSubtitle')}</p>
        <p className="text-xs text-text-muted">
          {t('onboarding.progress', { done: doneCount, total: status.steps.length })}
        </p>
      </div>
      {nextStep ? (
        <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-bg-elevated/50 p-4 text-left">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            {nextStep.id === 'email' ? <Mail size={16} /> : <MessageSquare size={16} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-heading">
              {t(`onboarding.steps.${nextStep.id}.title`)}
            </p>
            <p className="text-xs text-text-secondary">
              {t(`onboarding.steps.${nextStep.id}.description`)}
            </p>
          </div>
          <NextStepCta step={nextStep} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link
          to="/settings/setup"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
        >
          {t('onboarding.openGuide')}
          <ArrowRight size={12} />
        </Link>
        <Link
          to={ASSISTANT_SETUP_TO}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3.5 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
        >
          <Bot size={13} />
          {t('onboarding.talkAssistant')}
        </Link>
      </div>
    </div>
  )
}

/** Compact dismissible banner (Cockpit). */
export function OnboardingCompactCard() {
  const { t } = useTranslation('communication')
  const { status, dismissed, dismiss } = useOnboardingStatus()

  if (!status || status.completed || dismissed) return null
  const doneCount = status.steps.filter((step) => step.done).length
  const nextStep = status.steps.find((step) => !step.done)

  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-border/60 bg-bg-elevated/50 px-4 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
        <ListChecks size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-heading">{t('onboarding.continueTitle')}</p>
        <p className="truncate text-xs text-text-secondary">
          {t('onboarding.progress', { done: doneCount, total: status.steps.length })}
          {nextStep ? ` - ${t(`onboarding.steps.${nextStep.id}.title`)}` : ''}
        </p>
      </div>
      <Link
        to="/settings/setup"
        className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
      >
        {t('onboarding.openGuide')}
      </Link>
      {nextStep ? <NextStepCta step={nextStep} /> : null}
      <button
        type="button"
        onClick={dismiss}
        title={t('onboarding.dismiss')}
        aria-label={t('onboarding.dismiss')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
      >
        <X size={14} />
      </button>
    </div>
  )
}
