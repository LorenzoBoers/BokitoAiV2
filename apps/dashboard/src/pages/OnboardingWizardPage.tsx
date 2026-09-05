import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { AiAvatar } from '../components/ui/AiAvatar'
import { Switch } from '../components/ui/switch'
import {
  AGENT_AVATAR_ICON_KEYS,
  AGENT_AVATAR_ICONS,
  DEFAULT_AGENT_AVATAR_COLOR,
} from '../lib/agent-avatar'
import { bokitoUpdateAgent } from '../lib/bokito-api'
import { applyUiLanguageLocally, persistUiLanguage } from '../lib/language-preference'
import {
  canonicalizeNotificationRows,
  DEFAULT_NOTIFICATION_ROWS,
  type NotificationPrefRow,
} from '../lib/notification-rows'
import {
  getOnboardingWizard,
  patchOnboardingWizard,
  type OnboardingWizardState,
  type WizardIntake,
} from '../lib/onboarding-wizard-api'
import { setPosture, type AutonomyPostureId } from '../lib/govern-api'
import { APP_API_BASE } from '../lib/api.config'
import { policyRoutes } from '../api/routes/policy.routes'
import { appRoutes } from '../api/routes/app.routes'
import { cn } from '../lib/utils'
import { markTourPendingAfterWizard } from '../lib/tour-handoff'

type OwnerStep = 'intake' | 'languages' | 'notifications' | 'govern' | 'agent' | 'channel'
type MemberStep = 'languages' | 'notifications'

const OWNER_STEPS: OwnerStep[] = [
  'intake',
  'languages',
  'notifications',
  'govern',
  'agent',
  'channel',
]
const MEMBER_STEPS: MemberStep[] = ['languages', 'notifications']
const POSTURES: AutonomyPostureId[] = ['manual', 'assisted', 'autonomous']
const WORKSPACE_LANGS = ['nl', 'en', 'de', 'fr', 'es'] as const

const INTAKE_SOURCES = ['search', 'referral', 'social', 'partner', 'other'] as const
const ORG_SIZES = ['1', '2-10', '11-50', '51-200', '200+'] as const
const USE_CASES = ['inbox', 'support', 'sales', 'ops', 'agency', 'other'] as const

function ChoiceGrid({
  options,
  value,
  onChange,
  labelFor,
}: {
  options: readonly string[]
  value: string
  onChange: (v: string) => void
  labelFor: (id: string) => string
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {options.map((id) => {
        const selected = value === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-pressed={selected}
            className={cn(
              'rounded-xl border px-3.5 py-2.5 text-left text-[13px] font-medium transition-colors',
              selected
                ? 'border-accent/50 bg-accent/10 text-text-heading'
                : 'border-border/60 bg-bg-elevated/40 text-text-secondary hover:border-border hover:text-text-heading',
            )}
          >
            {labelFor(id)}
          </button>
        )
      })}
    </div>
  )
}

export default function OnboardingWizardPage() {
  const { t, i18n } = useTranslation('onboarding')
  const { t: tg } = useTranslation('govern')
  const { token, logout, currentTenantRole } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const isOwnerScope = currentTenantRole === 'owner' || currentTenantRole === 'admin'

  const [state, setState] = useState<OnboardingWizardState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)

  const [intake, setIntake] = useState<WizardIntake>({ source: '', org_size: '', use_case: '' })
  const [uiLang, setUiLang] = useState<'en' | 'nl'>('nl')
  const [workspaceLang, setWorkspaceLang] = useState('nl')
  const [posture, setPostureLocal] = useState<AutonomyPostureId>('assisted')
  const [agentName, setAgentName] = useState('')
  const [avatarKind, setAvatarKind] = useState<'initials' | 'icon'>('icon')
  const [avatarIcon, setAvatarIcon] = useState('bot')
  const [notifRows, setNotifRows] = useState<NotificationPrefRow[]>(DEFAULT_NOTIFICATION_ROWS)

  const steps = isOwnerScope ? OWNER_STEPS : MEMBER_STEPS
  const step = steps[stepIndex] ?? steps[0]

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setLoading(true)
    void getOnboardingWizard(token)
      .then((res) => {
        if (cancelled) return
        setState(res)
        setIntake(res.intake)
        setWorkspaceLang(res.ai_workspace_language || 'nl')
        setPostureLocal((res.autonomy_posture as AutonomyPostureId) || 'assisted')
        if (res.lead_agent) {
          setAgentName(res.lead_agent.name || '')
          const kind = (res.lead_agent.avatar_kind || '').toLowerCase()
          setAvatarKind(kind === 'icon' ? 'icon' : 'initials')
          setAvatarIcon(res.lead_agent.avatar_icon || 'bot')
        }
        const currentUi = i18n.resolvedLanguage === 'en' ? 'en' : 'nl'
        setUiLang(currentUi)
      })
      .catch(() => {
        if (!cancelled) toast.error(t('loadError'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, t, i18n.resolvedLanguage])

  useEffect(() => {
    if (!token) return
    void fetch(`${APP_API_BASE}${policyRoutes.notificationPreferences()}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { rows?: NotificationPrefRow[] } | null) => {
        if (Array.isArray(data?.rows) && data.rows.length > 0) {
          const next = canonicalizeNotificationRows(data.rows)
          setNotifRows(next.length > 0 ? next : DEFAULT_NOTIFICATION_ROWS)
        }
      })
      .catch(() => undefined)
  }, [token])

  const needsGate = useMemo(() => {
    if (!state) return false
    if (isOwnerScope) return state.needs_wizard
    return state.needs_personal_wizard
  }, [state, isOwnerScope])

  const persistNotifications = async () => {
    if (!token) return
    const res = await fetch(`${APP_API_BASE}${policyRoutes.notificationPreferences()}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ rows: notifRows }),
    })
    if (!res.ok) throw new Error('notif')
  }

  const saveLanguages = async () => {
    if (!token) return
    applyUiLanguageLocally(i18n, uiLang)
    await persistUiLanguage(token, uiLang)
    if (isOwnerScope) {
      const next = await patchOnboardingWizard(token, {
        ai_workspace_language: workspaceLang,
      })
      setState(next)
    }
  }

  const saveCurrentStep = async (): Promise<boolean> => {
    if (!token) return false
    setBusy(true)
    try {
      if (step === 'intake') {
        const next = await patchOnboardingWizard(token, { intake })
        setState(next)
      } else if (step === 'languages') {
        await saveLanguages()
      } else if (step === 'notifications') {
        await persistNotifications()
      } else if (step === 'govern') {
        await setPosture(posture)
        const next = await patchOnboardingWizard(token, { autonomy_posture: posture })
        setState(next)
      } else if (step === 'agent') {
        const agentId = state?.lead_agent?.id
        if (agentId) {
          const name = agentName.trim() || state.lead_agent?.name || 'Assistant'
          await bokitoUpdateAgent(token, agentId, {
            name,
            avatar_kind: avatarKind,
            avatar_icon: avatarKind === 'icon' ? avatarIcon : null,
            avatar_color: DEFAULT_AGENT_AVATAR_COLOR,
            avatar_image_url: null,
          })
        }
      }
      return true
    } catch {
      toast.error(t('saveError'))
      return false
    } finally {
      setBusy(false)
    }
  }

  const completeAndEnterApp = async (dest: string) => {
    if (!token) return
    if (isOwnerScope) {
      const next = await patchOnboardingWizard(token, { complete: true })
      setState(next)
    } else {
      await fetch(`${APP_API_BASE}${appRoutes.me.preferences}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ personal_wizard_completed: true }),
      })
    }
    markTourPendingAfterWizard()
    navigate(dest, { replace: true })
  }

  const finish = async () => {
    setBusy(true)
    try {
      await saveCurrentStep()
      await completeAndEnterApp('/communication/inbox/open')
    } catch {
      toast.error(t('saveError'))
    } finally {
      setBusy(false)
    }
  }

  const goNext = async () => {
    const ok = await saveCurrentStep()
    if (!ok) return
    if (stepIndex >= steps.length - 1) {
      await finish()
      return
    }
    setStepIndex((i) => i + 1)
  }

  const goBack = () => setStepIndex((i) => Math.max(0, i - 1))

  const updateNotifDesktop = (rowId: string, checked: boolean) => {
    setNotifRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? { ...row, channels: { ...row.channels, desktop: checked } }
          : row,
      ),
    )
  }

  if (loading || !state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base text-text-muted">
        <Loader2 className="animate-spin" size={22} />
      </div>
    )
  }

  if (!needsGate && params.get('force') !== '1') {
    return <Navigate to="/communication/inbox/open" replace />
  }

  return (
    <div className="app-atmosphere flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border/40 px-5 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">Bokito</p>
          <h1 className="text-[15px] font-semibold text-text-heading">
            {isOwnerScope ? t('title') : t('memberTitle')}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-lg px-2.5 py-1.5 text-[12px] text-text-muted hover:bg-bg-hover/60 hover:text-text-primary"
        >
          {t('logout')}
        </button>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-5 py-8">
        <p className="text-[12px] text-text-muted">
          {t('progress', { current: stepIndex + 1, total: steps.length })}
        </p>
        <div className="mt-2 mb-6 flex gap-1">
          {steps.map((s, idx) => (
            <span
              key={s}
              className={cn(
                'h-1 flex-1 rounded-full',
                idx <= stepIndex ? 'bg-accent' : 'bg-border/70',
              )}
            />
          ))}
        </div>

        {step === 'intake' ? (
          <section className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-text-heading">{t('intake.title')}</h2>
              <p className="mt-1 text-[13px] text-text-secondary">{t('intake.subtitle')}</p>
            </div>
            <div className="space-y-2">
              <p className="text-[12px] font-medium text-text-secondary">{t('intake.source')}</p>
              <ChoiceGrid
                options={INTAKE_SOURCES}
                value={intake.source}
                onChange={(source) => setIntake((p) => ({ ...p, source }))}
                labelFor={(id) => t(`intake.sources.${id}`)}
              />
            </div>
            <div className="space-y-2">
              <p className="text-[12px] font-medium text-text-secondary">{t('intake.orgSize')}</p>
              <ChoiceGrid
                options={ORG_SIZES}
                value={intake.org_size}
                onChange={(org_size) => setIntake((p) => ({ ...p, org_size }))}
                labelFor={(id) => t(`intake.sizes.${id}`)}
              />
            </div>
            <div className="space-y-2">
              <p className="text-[12px] font-medium text-text-secondary">{t('intake.useCase')}</p>
              <ChoiceGrid
                options={USE_CASES}
                value={intake.use_case}
                onChange={(use_case) => setIntake((p) => ({ ...p, use_case }))}
                labelFor={(id) => t(`intake.useCases.${id}`)}
              />
            </div>
          </section>
        ) : null}

        {step === 'languages' ? (
          <section className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-text-heading">{t('languages.title')}</h2>
              <p className="mt-1 text-[13px] text-text-secondary">{t('languages.subtitle')}</p>
            </div>
            <div className="space-y-2">
              <p className="text-[12px] font-medium text-text-secondary">{t('languages.uiLabel')}</p>
              <div className="flex gap-2">
                {(['nl', 'en'] as const).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    aria-pressed={uiLang === lang}
                    onClick={() => {
                      setUiLang(lang)
                      applyUiLanguageLocally(i18n, lang)
                    }}
                    className={cn(
                      'rounded-xl border px-4 py-2 text-[13px] font-medium',
                      uiLang === lang
                        ? 'border-accent/50 bg-accent/10 text-text-heading'
                        : 'border-border/60 text-text-secondary',
                    )}
                  >
                    {lang === 'en' ? t('languages.uiEn') : t('languages.uiNl')}
                  </button>
                ))}
              </div>
            </div>
            {isOwnerScope ? (
              <div className="space-y-2">
                <p className="text-[12px] font-medium text-text-secondary">
                  {t('languages.workspaceLabel')}
                </p>
                <p className="text-[12px] text-text-muted">{t('languages.workspaceHint')}</p>
                <div className="flex flex-wrap gap-2">
                  {WORKSPACE_LANGS.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      aria-pressed={workspaceLang === lang}
                      onClick={() => setWorkspaceLang(lang)}
                      className={cn(
                        'rounded-xl border px-3 py-1.5 text-[12.5px] font-medium uppercase',
                        workspaceLang === lang
                          ? 'border-accent/50 bg-accent/10 text-text-heading'
                          : 'border-border/60 text-text-secondary',
                      )}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {step === 'notifications' ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-text-heading">{t('notifications.title')}</h2>
              <p className="mt-1 text-[13px] text-text-secondary">{t('notifications.subtitle')}</p>
            </div>
            <ul className="divide-y divide-border/40 rounded-xl border border-border/50 bg-bg-surface">
              {notifRows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 px-3.5 py-3">
                  <span className="text-[13px] text-text-heading">{row.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-text-muted">{t('notifications.desktop')}</span>
                    <Switch
                      checked={Boolean(row.channels.desktop)}
                      onCheckedChange={(checked) => updateNotifDesktop(row.id, checked)}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-[12px] text-text-muted">{t('notifications.hint')}</p>
          </section>
        ) : null}

        {step === 'govern' ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-text-heading">{t('govern.title')}</h2>
              <p className="mt-1 text-[13px] text-text-secondary">{t('govern.subtitle')}</p>
            </div>
            <div className="space-y-2">
              {POSTURES.map((id) => {
                const selected = posture === id
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setPostureLocal(id)}
                    className={cn(
                      'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                      selected
                        ? 'border-accent/50 bg-accent/10'
                        : 'border-border/60 bg-bg-elevated/30 hover:border-border',
                    )}
                  >
                    <span className="block text-[13.5px] font-semibold text-text-heading">
                      {tg(`posture.${id}.label`)}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] text-text-secondary">
                      {tg(`posture.${id}.summary`)}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        ) : null}

        {step === 'agent' ? (
          <section className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-text-heading">{t('agent.title')}</h2>
              <p className="mt-1 text-[13px] text-text-secondary">{t('agent.subtitle')}</p>
            </div>
            <div className="flex items-center gap-3">
              <AiAvatar
                name={agentName || 'A'}
                seed={state.lead_agent?.id || 'agent'}
                size={48}
                kind={avatarKind}
                icon={avatarKind === 'icon' ? avatarIcon : null}
                color={DEFAULT_AGENT_AVATAR_COLOR}
              />
              <label className="flex-1">
                <span className="text-[12px] font-medium text-text-secondary">{t('agent.nameLabel')}</span>
                <input
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder={t('agent.namePlaceholder')}
                  className="mt-1 w-full rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px] text-text-heading outline-none focus:border-accent/50"
                />
              </label>
            </div>
            <div className="flex gap-2">
              {(['initials', 'icon'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={avatarKind === kind}
                  onClick={() => setAvatarKind(kind)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-[12px] font-medium',
                    avatarKind === kind
                      ? 'border-accent/50 bg-accent/10 text-text-heading'
                      : 'border-border/60 text-text-secondary',
                  )}
                >
                  {kind === 'icon' ? t('agent.icon') : t('agent.initials')}
                </button>
              ))}
            </div>
            {avatarKind === 'icon' ? (
              <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
                {AGENT_AVATAR_ICON_KEYS.map((key) => {
                  const Icon = AGENT_AVATAR_ICONS[key]
                  const selected = avatarIcon === key
                  return (
                    <button
                      key={key}
                      type="button"
                      title={key}
                      aria-pressed={selected}
                      onClick={() => setAvatarIcon(key)}
                      className={cn(
                        'inline-flex h-9 w-9 items-center justify-center rounded-lg border',
                        selected
                          ? 'border-ai/40 bg-ai/10 text-ai-ink'
                          : 'border-border/60 text-text-secondary hover:text-text-heading',
                      )}
                    >
                      <Icon size={16} aria-hidden />
                    </button>
                  )
                })}
              </div>
            ) : null}
          </section>
        ) : null}

        {step === 'channel' ? (
          <section className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-text-heading">{t('channel.title')}</h2>
              <p className="mt-1 text-[13px] text-text-secondary">{t('channel.subtitle')}</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true)
                  try {
                    await completeAndEnterApp('/settings/channels')
                  } catch {
                    toast.error(t('saveError'))
                  } finally {
                    setBusy(false)
                  }
                })()
              }}
              className="w-full rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-[13px] font-semibold text-text-heading hover:bg-accent/15 disabled:opacity-60"
            >
              {t('channel.openChannels')}
            </button>
            <p className="text-center text-[12px] text-text-muted">{t('channel.later')}</p>
          </section>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-3 pt-8">
          <button
            type="button"
            onClick={goBack}
            disabled={stepIndex === 0 || busy}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[12.5px] font-medium text-text-muted disabled:opacity-40 hover:bg-bg-hover/60 hover:text-text-primary"
          >
            <ArrowLeft size={13} />
            {t('back')}
          </button>
          <button
            type="button"
            onClick={() => void goNext()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[12.5px] font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
          >
            {busy ? t('saving') : stepIndex >= steps.length - 1 ? t('finish') : t('next')}
            {!busy ? <ArrowRight size={13} /> : <Loader2 size={13} className="animate-spin" />}
          </button>
        </div>
      </main>
    </div>
  )
}
