import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { AiAvatar } from '../components/ui/AiAvatar'
import { OptionCard, OptionCardGrid } from '../components/ui/option-card'
import { SegmentedControl } from '../components/ui/segmented-control'
import { Switch } from '../components/ui/switch'
import {
  AGENT_AVATAR_ICON_KEYS,
  AGENT_AVATAR_ICONS,
} from '../lib/agent-avatar'
import { bokitoUpdateAgent } from '../lib/bokito-api'
import { applyUiLanguageLocally, persistUiLanguage } from '../lib/language-preference'
import {
  defaultNotificationPrefs,
  NOTIFICATION_TIERS,
  normalizeNotificationPrefs,
  setTierChannel,
  type NotificationChannel,
  type NotificationPrefs,
  type NotificationTier,
} from '../lib/notification-prefs'
import {
  getOnboardingWizard,
  patchOnboardingWizard,
  type OnboardingWizardState,
  type WizardIntake,
} from '../lib/onboarding-wizard-api'
import { setPosture, type AutonomyPostureId } from '../lib/govern-api'
import AiHandlingPicker from '../components/ai/AiHandlingPicker'
import type { AiHandling, AiHandlingMode } from '../lib/ai-handling'
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
/** Synthetic workspace handling so the onboarding cards match Settings → AI handling. */
function postureAsHandling(posture: AutonomyPostureId): AiHandling {
  return {
    effective: posture,
    requested: posture,
    source: 'workspace',
    sourceLabel: '',
    ceiling: posture,
    clampedBy: null,
    reason: null,
    untilClose: false,
    inherited: posture,
    inheritedSource: 'default',
    inheritedSourceLabel: '',
    own: posture,
  }
}
const WORKSPACE_LANGS = ['nl', 'en', 'de', 'fr', 'es'] as const

const INTAKE_SOURCES = ['search', 'referral', 'social', 'partner', 'other'] as const
const ORG_SIZES = ['1', '2-10', '11-50', '51-200', '200+'] as const
const USE_CASES = ['inbox', 'support', 'sales', 'ops', 'agency', 'other'] as const
/** The one switch per tier offered at onboarding; the rest lives in Notification settings. */
const ONBOARDING_TIER_CHANNEL: Record<NotificationTier, NotificationChannel> = {
  '1': 'push',
  '2': 'inapp',
  '3': 'email',
}

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
    <OptionCardGrid columns={2} className="gap-2">
      {options.map((id) => (
        <OptionCard
          key={id}
          selected={value === id}
          onClick={() => onChange(id)}
          title={labelFor(id)}
          className="py-2.5"
        />
      ))}
    </OptionCardGrid>
  )
}

export default function OnboardingWizardPage() {
  const { t, i18n } = useTranslation('onboarding')
  const { t: tn } = useTranslation('nav')
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
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(defaultNotificationPrefs)

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
      .then((data: unknown) => {
        if (data) setNotifPrefs(normalizeNotificationPrefs(data))
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
      body: JSON.stringify(notifPrefs),
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
      await completeAndEnterApp('/communication/inbox/for_you')
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

  const updateNotifTier = (tier: NotificationTier, checked: boolean) => {
    setNotifPrefs((prev) => setTierChannel(prev, tier, ONBOARDING_TIER_CHANNEL[tier], checked))
  }

  if (loading || !state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base text-text-muted">
        <Loader2 className="animate-spin" size={22} />
      </div>
    )
  }

  if (!needsGate && params.get('force') !== '1') {
    return <Navigate to="/communication/inbox/for_you" replace />
  }

  return (
    <div className="app-atmosphere flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border/40 px-5 py-3">
        <div>
          <p className="text-xs font-semibold text-accent">Bokito</p>
          <h1 className="text-lg font-semibold text-text-heading">
            {isOwnerScope ? t('title') : t('memberTitle')}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-lg px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-hover/60 hover:text-text-primary"
        >
          {t('logout')}
        </button>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-5 py-8">
        <p className="text-xs text-text-muted">
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
              <p className="mt-1 text-sm text-text-secondary">{t('intake.subtitle')}</p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-text-secondary">{t('intake.source')}</p>
              <ChoiceGrid
                options={INTAKE_SOURCES}
                value={intake.source}
                onChange={(source) => setIntake((p) => ({ ...p, source }))}
                labelFor={(id) => t(`intake.sources.${id}`)}
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-text-secondary">{t('intake.orgSize')}</p>
              <ChoiceGrid
                options={ORG_SIZES}
                value={intake.org_size}
                onChange={(org_size) => setIntake((p) => ({ ...p, org_size }))}
                labelFor={(id) => t(`intake.sizes.${id}`)}
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-text-secondary">{t('intake.useCase')}</p>
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
              <p className="mt-1 text-sm text-text-secondary">{t('languages.subtitle')}</p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-text-secondary">{t('languages.uiLabel')}</p>
              <SegmentedControl
                value={uiLang}
                onChange={(lang) => {
                  setUiLang(lang)
                  applyUiLanguageLocally(i18n, lang)
                }}
                options={(['nl', 'en'] as const).map((lang) => ({
                  value: lang,
                  label: lang === 'en' ? t('languages.uiEn') : t('languages.uiNl'),
                }))}
              />
            </div>
            {isOwnerScope ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-text-secondary">
                  {t('languages.workspaceLabel')}
                </p>
                <p className="text-xs text-text-muted">{t('languages.workspaceHint')}</p>
                <SegmentedControl
                  value={workspaceLang}
                  onChange={setWorkspaceLang}
                  options={WORKSPACE_LANGS.map((lang) => ({
                    value: lang,
                    label: t(`languages.lang.${lang}`, { defaultValue: lang }),
                  }))}
                />
              </div>
            ) : null}
          </section>
        ) : null}

        {step === 'notifications' ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-text-heading">{t('notifications.title')}</h2>
              <p className="mt-1 text-sm text-text-secondary">{t('notifications.subtitle')}</p>
            </div>
            <ul className="panel divide-y divide-border/40">
              {NOTIFICATION_TIERS.map((tier) => (
                <li key={tier} className="flex items-center justify-between gap-3 px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-text-heading">{tn(`notificationsPage.tiers.${tier}.title`)}</p>
                    <p className="text-xs text-text-muted">{tn(`notificationsPage.tiers.${tier}.hint`)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-text-muted">{t(`notifications.tierChannel.${tier}`)}</span>
                    <Switch
                      checked={notifPrefs.tiers[tier][ONBOARDING_TIER_CHANNEL[tier]]}
                      onCheckedChange={(checked) => updateNotifTier(tier, checked)}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-text-muted">{t('notifications.hint')}</p>
          </section>
        ) : null}

        {step === 'govern' ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-text-heading">{t('govern.title')}</h2>
              <p className="mt-1 text-sm text-text-secondary">{t('govern.subtitle')}</p>
            </div>
            <AiHandlingPicker
              variant="cards"
              scope="workspace"
              handling={postureAsHandling(posture)}
              canRaise
              hideSettingsLink
              onChange={(mode: AiHandlingMode | null) => {
                if (mode) setPostureLocal(mode)
              }}
              testId="onboarding-ai-handling"
            />
          </section>
        ) : null}

        {step === 'agent' ? (
          <section className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-text-heading">{t('agent.title')}</h2>
              <p className="mt-1 text-sm text-text-secondary">{t('agent.subtitle')}</p>
            </div>
            <div className="flex items-center gap-3">
              <AiAvatar
                name={agentName || 'A'}
                seed={state.lead_agent?.id || 'agent'}
                size={48}
                kind={avatarKind}
                icon={avatarKind === 'icon' ? avatarIcon : null}
              />
              <label className="flex-1">
                <span className="text-xs font-medium text-text-secondary">{t('agent.nameLabel')}</span>
                <input
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder={t('agent.namePlaceholder')}
                  className="mt-1 w-full rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-sm text-text-heading outline-none focus:border-accent/50"
                />
              </label>
            </div>
            <SegmentedControl
              size="sm"
              value={avatarKind}
              onChange={setAvatarKind}
              options={(['initials', 'icon'] as const).map((kind) => ({
                value: kind,
                label: kind === 'icon' ? t('agent.icon') : t('agent.initials'),
              }))}
            />
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
              <p className="mt-1 text-sm text-text-secondary">{t('channel.subtitle')}</p>
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
              className="w-full rounded-lg border border-border-light bg-bg-hover px-4 py-3 text-sm font-semibold text-text-heading hover:bg-accent/15 disabled:opacity-60"
            >
              {t('channel.openChannels')}
            </button>
            <p className="text-center text-xs text-text-muted">{t('channel.later')}</p>
          </section>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-3 pt-8">
          <button
            type="button"
            onClick={goBack}
            disabled={stepIndex === 0 || busy}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-text-muted disabled:opacity-40 hover:bg-bg-hover/60 hover:text-text-primary"
          >
            <ArrowLeft size={13} />
            {t('back')}
          </button>
          <button
            type="button"
            onClick={() => void goNext()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
          >
            {busy ? t('saving') : stepIndex >= steps.length - 1 ? t('finish') : t('next')}
            {!busy ? <ArrowRight size={13} /> : <Loader2 size={13} className="animate-spin" />}
          </button>
        </div>
      </main>
    </div>
  )
}
