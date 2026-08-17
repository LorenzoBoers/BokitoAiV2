import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Check, Inbox, Mail, MessageSquare, Users, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { appScopedGet } from '../../lib/api'
import { appRoutes } from '../../api/routes/app.routes'

export type OnboardingStepId = 'email' | 'company' | 'assistant' | 'channel' | 'team'

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

const STEP_META: Record<OnboardingStepId, { icon: typeof Building2; to: string }> = {
  email: { icon: Mail, to: '/settings/channels' },
  // Completion is measured by `company.md` content, which lives in Knowledge.
  company: {
    icon: Building2,
    to: '/knowledge',
  },
  assistant: { icon: MessageSquare, to: '/communication/assistant' },
  channel: { icon: Inbox, to: '/settings/channels' },
  team: { icon: Users, to: '/settings/members' },
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
                  ? 'border-border/50 bg-bg-elevated/30 opacity-70'
                  : 'border-border/70 bg-bg-elevated/50'
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
              {!step.done ? (
                <Link
                  to={meta.to}
                  className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
                >
                  {t(`onboarding.steps.${step.id}.cta`)}
                </Link>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
