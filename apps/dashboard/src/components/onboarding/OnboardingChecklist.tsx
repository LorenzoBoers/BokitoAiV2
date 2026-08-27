import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Bot, CalendarClock, ListChecks, Mail, MessageSquare, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { appScopedGet, appScopedPost } from '../../lib/api'
import { appRoutes } from '../../api/routes/app.routes'
import { inboxPath } from '../../lib/messages-paths'
import { talkToAssistantPath } from '../../lib/talk-to-assistant'
import { readOnboardingDismissed, writeOnboardingDismissed } from '../../lib/onboarding-dismiss'

export type OnboardingStepId = 'email' | 'company' | 'assistant' | 'watching' | 'first_decision' | 'team'

export interface OnboardingStatus {
  steps: { id: OnboardingStepId; done: boolean }[]
  completed: boolean
}

export function useOnboardingStatus(): {
  status: OnboardingStatus | null
  loading: boolean
  error: string | null
  retry: () => void
  dismissed: boolean
  dismiss: () => void
  undismiss: () => void
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
    setDismissed(readOnboardingDismissed(tenantId))
  }, [tenantId])

  const dismiss = useCallback(() => {
    writeOnboardingDismissed(tenantId, true)
    setDismissed(true)
  }, [tenantId])

  const undismiss = useCallback(() => {
    writeOnboardingDismissed(tenantId, false)
    setDismissed(false)
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

  return { status, loading, error, retry, dismissed, dismiss, undismiss }
}

const STEP_META: Record<OnboardingStepId, { to: string }> = {
  email: { to: '/settings/channels' },
  company: { to: '/knowledge' },
  assistant: { to: talkToAssistantPath('Help me set up this workspace. Walk me through it step by step.') },
  watching: { to: '/settings/setup' },
  first_decision: { to: inboxPath('open') },
  team: { to: '/settings/members#member-invite' },
}

export function useDemoThread(): { start: () => void; starting: boolean } {
  const { token } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation('communication')
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
      .catch(() => {
        toast.error(t('onboarding.steps.first_decision.error'))
      })
      .finally(() => setStarting(false))
  }, [token, starting, navigate, t])

  return { start, starting }
}

const ASSISTANT_SETUP_TO = talkToAssistantPath(
  'Help me set up this workspace. Walk me through it step by step.',
)

const nextStepCtaClass =
  'inline-flex w-full items-center justify-center rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60 sm:w-auto'

function NextStepCta({ step }: { step: { id: OnboardingStepId; done: boolean } }) {
  const { t } = useTranslation('communication')
  const { start, starting } = useDemoThread()
  const meta = STEP_META[step.id]

  if (step.id === 'first_decision') {
    return (
      <button type="button" onClick={start} disabled={starting} className={nextStepCtaClass}>
        {t(`onboarding.steps.${step.id}.cta`)}
      </button>
    )
  }
  return (
    <Link to={meta.to} className={nextStepCtaClass}>
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
    <div className="relative mx-auto w-full max-w-[440px] space-y-6 px-4 py-12 text-center">
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
      <div className="space-y-3">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/12 text-accent">
          <Sparkles size={20} />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight text-text-heading">
            {t('onboarding.continueTitle')}
          </h2>
          <p className="text-sm leading-relaxed text-text-secondary">{t('onboarding.continueSubtitle')}</p>
          <p className="text-xs text-text-muted">
            {t('onboarding.progress', { done: doneCount, total: status.steps.length })}
          </p>
        </div>
      </div>
      {nextStep ? (
        <div className="space-y-4 rounded-2xl border border-border/60 bg-bg-elevated/50 p-5 text-left">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
              {nextStep.id === 'email' ? (
                <Mail size={18} />
              ) : nextStep.id === 'watching' ? (
                <CalendarClock size={18} />
              ) : (
                <MessageSquare size={18} />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-semibold leading-snug text-text-heading">
                {t(`onboarding.steps.${nextStep.id}.title`)}
              </p>
              <p className="text-sm leading-relaxed text-text-secondary">
                {t(`onboarding.steps.${nextStep.id}.description`)}
              </p>
            </div>
          </div>
          <NextStepCta step={nextStep} />
        </div>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Link
          to="/settings/setup"
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/60 px-3.5 py-2 text-sm font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
        >
          {t('onboarding.openGuide')}
          <ArrowRight size={13} />
        </Link>
        <Link
          to={ASSISTANT_SETUP_TO}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/60 px-3.5 py-2 text-sm font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
        >
          <Bot size={14} />
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
      {nextStep && nextStep.id !== 'watching' ? <NextStepCta step={nextStep} /> : null}
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
