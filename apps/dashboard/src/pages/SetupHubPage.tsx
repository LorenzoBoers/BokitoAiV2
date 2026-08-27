import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  BarChart3,
  Bot,
  CalendarClock,
  Check,
  FolderKanban,
  Loader2,
  Mail,
  MessageSquare,
  Palette,
  Sparkles,
} from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import { PageIntro } from '../components/layout/PageIntro'
import { KnowledgeMark } from '../components/knowledge/KnowledgeMark'
import { IntegrationHostLogo } from '../components/integrations/IntegrationHostLogo'
import { resolveProviderBrand } from '../lib/integration-brand'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { appScopedGet } from '../lib/api'
import { appRoutes } from '../api/routes/app.routes'
import { listAgents } from '../lib/agents-api'
import { listTriggers, updateTrigger } from '../lib/orchestration-api'
import {
  enabledAutomationCount,
  platformCheckInTrigger,
  talkToAssistantPath,
} from '../lib/talk-to-assistant'
import { listCustomMetrics } from '../lib/metrics-api'
import { listProjects } from '../lib/projects-api'
import type { OnboardingStatus } from '../components/onboarding/OnboardingChecklist'

type PillarState = {
  id: string
  title: string
  description: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  done: boolean
  detail: string
  actions: { label: string; to?: string; onClick?: () => void; primary?: boolean; busy?: boolean }[]
  logos?: string[]
  knowledge?: boolean
}

function ProviderLogoStrip({ providers }: { providers: string[] }) {
  return (
    <span className="flex items-center gap-1.5">
      {providers.map((provider) => {
        const brand = resolveProviderBrand(provider)
        return (
          <IntegrationHostLogo
            key={provider}
            logoUrl={brand.logoUrl}
            logoDarkUrl={brand.logoDarkUrl}
            initials={brand.initials}
            color={brand.color}
            name={brand.name}
            hostSlug={brand.hostSlug}
            size="sm"
            className="rounded-md"
          />
        )
      })}
    </span>
  )
}

/**
 * Guided workspace setup along the six pillars of the platform:
 * communication, intelligence, automations, branding, KPIs and projects.
 * Progress is derived from live workspace data on every visit — nothing is stored.
 */
export default function SetupHubPage() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const { currentWorkspace } = useWorkspace()
  const [loading, setLoading] = useState(true)
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null)
  const [agentCount, setAgentCount] = useState(0)
  const [automationCount, setAutomationCount] = useState(0)
  const [checkIn, setCheckIn] = useState<{ id: string; enabled: boolean } | null>(null)
  const [enablingWatch, setEnablingWatch] = useState(false)
  const [metricCount, setMetricCount] = useState(0)
  const [projectCount, setProjectCount] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [status, agents, triggers, metrics, projects] = await Promise.all([
        token
          ? appScopedGet<OnboardingStatus>(appRoutes.onboarding.status, token).catch(() => null)
          : Promise.resolve(null),
        listAgents().catch(() => []),
        listTriggers().catch(() => []),
        listCustomMetrics().catch(() => []),
        listProjects().catch(() => []),
      ])
      setOnboarding(status)
      setAgentCount(agents.length)
      setAutomationCount(enabledAutomationCount(triggers))
      const heartbeat = platformCheckInTrigger(triggers)
      setCheckIn(heartbeat ? { id: heartbeat.id, enabled: heartbeat.enabled } : null)
      setMetricCount(metrics.length)
      setProjectCount(projects.length)
    } finally {
      setLoading(false)
    }
  }, [token])

  const enableCheckIn = useCallback(async () => {
    if (!checkIn || checkIn.enabled) return
    setEnablingWatch(true)
    try {
      await updateTrigger(checkIn.id, { enabled: true })
      await load()
    } finally {
      setEnablingWatch(false)
    }
  }, [checkIn, load])

  useEffect(() => {
    void load()
  }, [load])

  const stepDone = useCallback(
    (id: string) => onboarding?.steps.some((s) => s.id === id && s.done) ?? false,
    [onboarding],
  )

  const brandingDone = Boolean(currentWorkspace?.logo || currentWorkspace?.brand_color)

  const assistantPrompt = t('setupGuidePage.assistantPrompt')

  const pillars = useMemo<PillarState[]>(() => {
    const emailDone = stepDone('email')
    const firstDecisionDone = stepDone('first_decision')
    const teamDone = stepDone('team')
    const companyDone = stepDone('company')
    const assistantDone = stepDone('assistant')
    return [
      {
        id: 'communication',
        title: t('setupGuidePage.communication.title'),
        description: t('setupGuidePage.communication.description'),
        icon: Mail,
        done: emailDone && firstDecisionDone,
        detail: [
          emailDone ? t('setupGuidePage.communication.done') : t('setupGuidePage.communication.todo'),
          firstDecisionDone
            ? t('setupGuidePage.communication.decisionDone')
            : t('setupGuidePage.communication.decisionTodo'),
          teamDone ? t('setupGuidePage.communication.teamDone') : t('setupGuidePage.communication.teamTodo'),
        ].join(' · '),
        logos: ['bokito', 'gmail', 'outlook'],
        actions: [
          { label: t('setupGuidePage.communication.viewAddress'), to: '/settings/channels', primary: !emailDone },
          { label: t('setupGuidePage.communication.connectMailbox'), to: '/settings/channels' },
          { label: t('setupGuidePage.communication.browseChannels'), to: '/settings/marketplace?kind=inbox' },
          { label: t('setupGuidePage.communication.aiReplySettings'), to: '/settings/communication' },
          ...(teamDone
            ? []
            : [{ label: t('setupGuidePage.communication.inviteTeam'), to: '/settings/members' }]),
        ],
      },
      {
        id: 'intelligence',
        title: t('setupGuidePage.intelligence.title'),
        description: t('setupGuidePage.intelligence.description'),
        icon: MessageSquare,
        done: companyDone && assistantDone && agentCount > 0,
        detail: [
          companyDone ? t('setupGuidePage.intelligence.knowledgeDone') : t('setupGuidePage.intelligence.knowledgeTodo'),
          agentCount > 0
            ? t('setupGuidePage.intelligence.agentsCount', { count: agentCount })
            : t('setupGuidePage.intelligence.noAgents'),
        ].join(' - '),
        knowledge: true,
        actions: [
          {
            label: t('setupGuidePage.intelligence.setupAssistant'),
            to: talkToAssistantPath(assistantPrompt),
            primary: !(companyDone && assistantDone),
          },
          { label: t('setupGuidePage.intelligence.openKnowledge'), to: '/knowledge' },
          { label: t('setupGuidePage.intelligence.manageAgents'), to: '/agents' },
          { label: t('setupGuidePage.intelligence.organizeProjects'), to: '/projects' },
        ],
      },
      {
        id: 'automations',
        title: t('setupGuidePage.automations.title'),
        description: t('setupGuidePage.automations.description'),
        icon: CalendarClock,
        done: automationCount > 0,
        detail:
          checkIn && !checkIn.enabled
            ? t('setupGuidePage.automations.checkInOff')
            : automationCount > 0
              ? t('setupGuidePage.automations.done', { count: automationCount })
              : t('setupGuidePage.automations.todo'),
        actions: [
          ...(checkIn && !checkIn.enabled
            ? [
                {
                  label: enablingWatch
                    ? t('setupGuidePage.automations.enablingCheckIn')
                    : t('setupGuidePage.automations.enableCheckIn'),
                  onClick: () => void enableCheckIn(),
                  primary: true,
                  busy: enablingWatch,
                },
              ]
            : []),
          {
            label: t('setupGuidePage.automations.askAssistant'),
            to: talkToAssistantPath(t('setupGuidePage.automations.assistantPrompt')),
            primary: !checkIn || checkIn.enabled,
          },
          { label: t('setupGuidePage.automations.openAgenda'), to: '/agenda?view=automations' },
        ],
      },
      {
        id: 'branding',
        title: t('setupGuidePage.branding.title'),
        description: t('setupGuidePage.branding.description'),
        icon: Palette,
        done: brandingDone,
        detail: brandingDone ? t('setupGuidePage.branding.done') : t('setupGuidePage.branding.todo'),
        actions: [
          { label: t('setupGuidePage.branding.branding'), to: '/settings/branding', primary: !brandingDone },
          { label: t('setupGuidePage.branding.installWidget'), to: '/ai/assistant/external/installation' },
        ],
      },
      {
        id: 'kpis',
        title: t('setupGuidePage.kpis.title'),
        description: t('setupGuidePage.kpis.description'),
        icon: BarChart3,
        done: metricCount > 0,
        detail:
          metricCount > 0
            ? t('setupGuidePage.kpis.done', { count: metricCount })
            : t('setupGuidePage.kpis.todo'),
        actions: [
          { label: t('setupGuidePage.kpis.openCockpit'), to: '/cockpit?addMetric=1', primary: metricCount === 0 },
          { label: t('setupGuidePage.kpis.openUsage'), to: '/cockpit/usage' },
        ],
      },
      {
        id: 'projects',
        title: t('setupGuidePage.projects.title'),
        description: t('setupGuidePage.projects.description'),
        icon: FolderKanban,
        done: projectCount > 0,
        detail:
          projectCount > 0
            ? t('setupGuidePage.projects.done', { count: projectCount })
            : t('setupGuidePage.projects.todo'),
        actions: [
          { label: t('setupGuidePage.projects.openProjects'), to: '/projects', primary: projectCount === 0 },
        ],
      },
    ]
  }, [
    stepDone,
    agentCount,
    automationCount,
    brandingDone,
    metricCount,
    projectCount,
    t,
    assistantPrompt,
    checkIn,
    enablingWatch,
    enableCheckIn,
  ])

  const doneCount = pillars.filter((p) => p.done).length

  return (
    <PageContent>
      <PageIntro description={t('pageHeaders.setupGuide')} className="mb-4" />

      <div className="mx-auto max-w-3xl space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-bg-surface px-4 py-5 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('setupGuidePage.checking')}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-bg-surface px-4 py-3 shadow-card">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
                <Sparkles size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-heading">
                  {t('setupGuidePage.pillarsReady', { done: doneCount, total: pillars.length })}
                </p>
                <p className="text-xs text-text-secondary">
                  {t('setupGuidePage.preferTalking')}
                </p>
              </div>
              <Link
                to={talkToAssistantPath(assistantPrompt)}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
              >
                <Bot size={13} />
                {t('setupGuidePage.startAssistant')}
              </Link>
            </div>

            <ol className="space-y-3">
              {pillars.map((pillar) => {
                const Icon = pillar.icon
                return (
                  <li
                    key={pillar.id}
                    className={`rounded-xl border p-4 shadow-card transition-colors ${
                      pillar.done
                        ? 'border-border/60 bg-bg-elevated/30'
                        : 'border-border/60 bg-bg-surface hover:border-accent/30'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                          pillar.done
                            ? 'bg-status-success/15 text-status-success'
                            : pillar.knowledge
                              ? 'bg-violet-500/10 text-violet-500 dark:text-violet-300'
                              : 'bg-bg-hover/70 text-text-muted'
                        }`}
                      >
                        {pillar.done ? (
                          <Check size={17} />
                        ) : pillar.knowledge ? (
                          <KnowledgeMark size={17} />
                        ) : (
                          <Icon size={17} />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-sm font-semibold text-text-heading">{pillar.title}</h2>
                          {pillar.logos ? <ProviderLogoStrip providers={pillar.logos} /> : null}
                        </div>
                        <p className="mt-0.5 text-[12.5px] text-text-secondary">{pillar.description}</p>
                        <p className="mt-1 text-[11px] text-text-muted">{pillar.detail}</p>
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          {pillar.actions.map((action) =>
                            action.onClick ? (
                              <button
                                key={action.label}
                                type="button"
                                disabled={action.busy}
                                onClick={action.onClick}
                                className={
                                  action.primary
                                    ? 'inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60'
                                    : 'inline-flex items-center gap-1 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary disabled:opacity-60'
                                }
                              >
                                {action.busy ? <Loader2 size={11} className="animate-spin" /> : null}
                                {action.label}
                              </button>
                            ) : (
                              <Link
                                key={(action.to ?? '') + action.label}
                                to={action.to ?? '/'}
                                className={
                                  action.primary
                                    ? 'inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover'
                                    : 'inline-flex items-center gap-1 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary'
                                }
                              >
                                {action.label}
                                <ArrowRight size={11} />
                              </Link>
                            ),
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>

            <p className="text-xs text-text-muted">
              {t('setupGuidePage.advancedHint')}{' '}
              <Link to="/settings/integrations" className="text-accent hover:underline">
                {t('setupGuidePage.advancedLink')}
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </PageContent>
  )
}
