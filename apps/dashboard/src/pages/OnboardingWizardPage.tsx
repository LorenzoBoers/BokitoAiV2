import { Card } from '../components/ui/card'
import { Pressable } from '../components/ui/pressable'
import { Button } from '../components/ui/button'
import { Avatar } from '../components/ui/avatar'
import { Spinner } from '../components/ui/spinner'
import { PageHeader } from '../components/ui/page-header'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { WizardSkeleton } from '../components/ui/skeleton'
import { OptionCard, OptionCardGrid } from '../components/ui/option-card'
import { SegmentedControl } from '../components/ui/segmented-control'
import { Switch } from '../components/ui/switch'
import {
  resolveAgentAvatarColor,
  resolveAgentAvatarShape,
} from '../lib/agent-avatar'
import { DEFAULT_BOT_ORB_COLOR } from '../lib/bot-orb-shapes'
import { AgentVisualEditor } from '../components/workforce/AgentVisualEditor'
import { applyUiLanguageLocally, persistUiLanguage } from '../lib/language-preference'
import { setPref } from '../lib/preferences'
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
import { cn } from '../lib/utils'
import { markTourPendingAfterWizard } from '../lib/tour-handoff'

const DEFAULT_LEAD_SHAPE = 'blob'

function visualKind(value: string | null | undefined): 'initials' | 'orb' {
  return (value || '').trim().toLowerCase() === 'initials' ? 'initials' : 'orb'
}

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
    layers: [],
    ceilings: [],
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
  const [agentJobTitle, setAgentJobTitle] = useState(() => t('agent.jobTitleDefault'))
  const [agentDescription, setAgentDescription] = useState('')
  const [avatarKind, setAvatarKind] = useState<'initials' | 'orb'>('orb')
  const [avatarColor, setAvatarColor] = useState(DEFAULT_BOT_ORB_COLOR)
  const [avatarShape, setAvatarShape] = useState(DEFAULT_LEAD_SHAPE)
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
          const suggested = res.suggested_agent_name || ''
          const company = suggested.replace(/ assistant$/, '')
          const storedName = res.lead_agent.name || ''
          setAgentName(!storedName || storedName === company ? suggested : storedName)
          const storedTitle = (res.lead_agent.job_title || '').trim()
          const legacyTitle = !storedTitle || storedTitle === 'Assistent' || storedTitle === 'Assistant' || storedTitle === 'Onboarding specialist'
          setAgentJobTitle(legacyTitle ? t('agent.jobTitleDefault') : storedTitle)
          setAgentDescription(res.lead_agent.description || '')
          setAvatarKind(visualKind(res.lead_agent.avatar_kind))
          setAvatarColor(resolveAgentAvatarColor(res.lead_agent.avatar_color))
          const storedShape = res.lead_agent.avatar_shape
          setAvatarShape(
            !storedShape || storedShape === 'bokito' ? DEFAULT_LEAD_SHAPE : resolveAgentAvatarShape(storedShape),
          )
        } else {
          setAgentName(res.suggested_agent_name || '')
          setAgentJobTitle(t('agent.jobTitleDefault'))
          setAgentDescription('')
          setAvatarKind('orb')
          setAvatarColor(DEFAULT_BOT_ORB_COLOR)
          setAvatarShape(DEFAULT_LEAD_SHAPE)
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
        const name = agentName.trim()
        const jobTitle = agentJobTitle.trim()
        if (!name) {
          toast.error(t('agent.nameRequired'))
          return false
        }
        if (!jobTitle) {
          toast.error(t('agent.jobTitleRequired'))
          return false
        }
        const next = await patchOnboardingWizard(token, {
          lead_agent: {
            name,
            job_title: jobTitle,
            description: agentDescription.trim(),
            avatar_kind: avatarKind,
            avatar_color: avatarKind === 'orb' ? avatarColor : null,
            avatar_shape: avatarKind === 'orb' ? avatarShape : null,
          },
        })
        setState(next)
      }
      return true
    } catch {
      toast.error(t('saveError'))
      return false
    } finally {
      setBusy(false)
    }
  }

  const completeAndEnterApp = async (dest: string, opts?: { tour?: boolean }) => {
    if (!token) return
    if (isOwnerScope) {
      const next = await patchOnboardingWizard(token, { complete: true })
      setState(next)
    } else {
      await setPref('personal_wizard_completed', true, token)
    }
    if (opts?.tour !== false) markTourPendingAfterWizard()
    navigate(dest, { replace: true })
  }

  const finish = async () => {
    setBusy(true)
    try {
      const saved = await saveCurrentStep()
      if (!saved) return
      const agentId = state?.lead_agent?.id
      if (isOwnerScope && agentId) {
        await completeAndEnterApp(
          `/communication/new?intent=agent&agent=${encodeURIComponent(agentId)}&setup=1`,
          { tour: false },
        )
        return
      }
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
      <WizardSkeleton />
    )
  }

  if (!needsGate && params.get('force') !== '1') {
    return <Navigate to="/communication/inbox/for_you" replace />
  }

  return (
    <div className="app-atmosphere flex min-h-screen flex-col">
      <header className="border-b border-border px-5 py-3">
        <p className="text-xs font-semibold text-accent">Bokito</p>
        <PageHeader
          className="mb-0 items-center"
          title={isOwnerScope ? t('title') : t('memberTitle')}
          primaryAction={
            <Button variant="ghost" size="xs"
              type="button"
              onClick={() => void logout()}
             
            >
              {t('logout')}
            </Button>
          }
        />
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
            <Card asChild>
              <ul className="divide-y divide-border/40">
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
            </Card>
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
            <div className="flex flex-col items-center pt-2">
              <Avatar
                kind="agent"
                decorative={false}
                agent={{
                  name: agentName || 'A',
                  seed: state.lead_agent?.id || 'agent',
                  avatar_kind: avatarKind,
                  avatar_icon: null,
                  avatar_color: avatarKind === 'orb' ? avatarColor : null,
                  avatar_shape: avatarKind === 'orb' ? avatarShape : null,
                  avatar_image_url: null,
                }}
                size={96}
                mode="live"
                baseMotion="idle"
              />
              <input
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                aria-label={t('agent.nameLabel')}
                placeholder={t('agent.namePlaceholder')}
                className="mt-4 w-full max-w-sm bg-transparent text-center text-lg font-semibold text-text-heading outline-none border-b border-transparent focus:border-accent/50"
              />
              <input
                value={agentJobTitle}
                onChange={(e) => setAgentJobTitle(e.target.value.slice(0, 32))}
                aria-label={t('agent.jobTitleLabel')}
                placeholder={t('agent.jobTitlePlaceholder')}
                maxLength={32}
                className="mt-1 w-full max-w-sm bg-transparent text-center text-sm text-text-secondary outline-none border-b border-transparent focus:border-accent/40"
              />
            </div>
            <label className="block">
              <span className="text-xs font-medium text-text-secondary">{t('agent.descriptionLabel')}</span>
              <textarea
                value={agentDescription}
                onChange={(e) => setAgentDescription(e.target.value.slice(0, 280))}
                placeholder={t('agent.descriptionPlaceholder')}
                rows={3}
                maxLength={280}
                className="mt-1 w-full resize-none rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text-heading outline-none focus:border-accent/50"
              />
            </label>
            <AgentVisualEditor
              kind={avatarKind}
              color={avatarColor}
              shape={avatarShape}
              busy={busy}
              compactShapes
              showMotion={false}
              onKindChange={setAvatarKind}
              onColorChange={setAvatarColor}
              onShapeChange={setAvatarShape}
            />
          </section>
        ) : null}

        {step === 'channel' ? (
          <section className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-text-heading">{t('channel.title')}</h2>
              <p className="mt-1 text-sm text-text-secondary">{t('channel.subtitle')}</p>
            </div>
            <Pressable
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
            </Pressable>
            <p className="text-center text-xs text-text-muted">{t('channel.later')}</p>
          </section>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-3 pt-8">
          <Button variant="ghost" size="md"
            type="button"
            onClick={goBack}
            disabled={stepIndex === 0 || busy}
           
          >
            <ArrowLeft size={14} />
            {t('back')}
          </Button>
          <Button size="md"
            type="button"
            onClick={() => void goNext()}
            disabled={busy}
           
          >
            {busy ? t('saving') : stepIndex >= steps.length - 1 ? t('finish') : t('next')}
            {!busy ? <ArrowRight size={14} /> : <Spinner size="md" />}
          </Button>
        </div>
      </main>
    </div>
  )
}
