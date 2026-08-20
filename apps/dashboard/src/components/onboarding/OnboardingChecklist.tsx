import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Brain, Check, ListChecks, Mail, MessageSquare, Sparkles, Users, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { appScopedGet, appScopedPost } from '../../lib/api'
import { appRoutes } from '../../api/routes/app.routes'

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
          setError('Could not load your setup checklist.')
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

const STEP_META: Record<OnboardingStepId, { icon: typeof Brain; to: string }> = {
  email: { icon: Mail, to: '/settings/channels' },
  // Completion is measured by `company.md` content, which lives in Knowledge —
  // so this step carries the knowledge brain identity.
  company: {
    icon: Brain,
    to: '/knowledge',
  },
  assistant: { icon: MessageSquare, to: '/communication/assistant' },
  // CTA seeds the demo thread and jumps into it (see useDemoThread).
  first_decision: { icon: Sparkles, to: '/communication' },
  team: { icon: Users, to: '/settings/members' },
}

/** Seed the onboarding demo thread and navigate into it. */
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
          navigate(`/communication/inbox/all/t/${res.signal_id}`)
        }
      })
      .catch(() => {
        // Best-effort: the checklist stays visible so the user can retry.
      })
      .finally(() => setStarting(false))
  }, [token, starting, navigate])

  return { start, starting }
}

function StepCta({ step }: { step: { id: OnboardingStepId; done: boolean } }) {
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

export default function OnboardingChecklist({
  status,
  onDismiss,
}: {
  status: OnboardingStatus
  onDismiss?: () => void
}) {
  const { t } = useTranslation('communication')
  const doneCount = status.steps.filter((step) => step.done).length

  return (
    <div className="relative mx-auto w-full max-w-[560px] space-y-4 py-8 px-4">
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
      <div className="space-y-1 text-center">
        <h2 className="text-lg font-semibold text-text-heading">{t('onboarding.title')}</h2>
        <p className="text-sm text-text-secondary">{t('onboarding.subtitle')}</p>
        <p className="text-xs text-text-muted">
          {t('onboarding.progress', { done: doneCount, total: status.steps.length })}
        </p>
      </div>
      <div className="space-y-2">
        {status.steps.map((step) => {
          const meta = STEP_META[step.id]
          if (!meta) return null
          const Icon = meta.icon
          return (
            <div
              key={step.id}
              className={`flex items-center gap-3 rounded-xl border p-4 transition-colors ${
                step.done
                  ? 'border-border/60 bg-bg-elevated/30 opacity-70'
                  : 'border-border/60 bg-bg-elevated/50'
              }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  step.done ? 'bg-accent/15 text-accent' : 'bg-bg-hover/70 text-text-muted'
                }`}
              >
                {step.done ? <Check size={18} /> : <Icon size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-heading">
                  {t(`onboarding.steps.${step.id}.title`)}
                </p>
                <p className="text-xs text-text-secondary">
                  {t(`onboarding.steps.${step.id}.description`)}
                </p>
              </div>
              {!step.done ? <StepCta step={step} /> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Compact dismissible checklist banner (used on the Cockpit). */
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
        <p className="truncate text-sm font-medium text-text-heading">{t('onboarding.title')}</p>
        <p className="truncate text-xs text-text-secondary">
          {t('onboarding.progress', { done: doneCount, total: status.steps.length })}
          {nextStep ? ` - ${t(`onboarding.steps.${nextStep.id}.title`)}` : ''}
        </p>
      </div>
      {nextStep ? <StepCta step={nextStep} /> : null}
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
