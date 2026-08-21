import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  Bot,
  CalendarClock,
  Check,
  Loader2,
  Mail,
  MessageSquare,
  Palette,
  Sparkles,
} from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import { KnowledgeMark } from '../components/knowledge/KnowledgeMark'
import { IntegrationHostLogo } from '../components/integrations/IntegrationHostLogo'
import { resolveProviderBrand } from '../lib/integration-brand'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { appScopedGet } from '../lib/api'
import { appRoutes } from '../api/routes/app.routes'
import { listAgents } from '../lib/agents-api'
import { listTriggers } from '../lib/orchestration-api'
import { listCustomMetrics } from '../lib/metrics-api'
import type { OnboardingStatus } from '../components/onboarding/OnboardingChecklist'

const ASSISTANT_SETUP_PROMPT =
  'Help me set up this workspace. Walk me through it step by step: ' +
  'first ask what my organization does and record it in the company knowledge, ' +
  'then advise which channels, agents, automations and connected tools fit my ' +
  'way of working, and help me configure them one by one.'

type PillarState = {
  id: string
  title: string
  description: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  done: boolean
  detail: string
  actions: { label: string; to: string; primary?: boolean }[]
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
 * Guided workspace setup along the five pillars of the platform:
 * communication, intelligence, automations, branding and KPIs. Progress is
 * derived from live workspace data on every visit — nothing is stored.
 */
export default function SetupHubPage() {
  const { token } = useAuth()
  const { currentWorkspace } = useWorkspace()
  const [loading, setLoading] = useState(true)
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null)
  const [agentCount, setAgentCount] = useState(0)
  const [automationCount, setAutomationCount] = useState(0)
  const [metricCount, setMetricCount] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [status, agents, triggers, metrics] = await Promise.all([
        token
          ? appScopedGet<OnboardingStatus>(appRoutes.onboarding.status, token).catch(() => null)
          : Promise.resolve(null),
        listAgents().catch(() => []),
        listTriggers().catch(() => []),
        listCustomMetrics().catch(() => []),
      ])
      setOnboarding(status)
      setAgentCount(agents.length)
      setAutomationCount(triggers.length)
      setMetricCount(metrics.length)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const stepDone = useCallback(
    (id: string) => onboarding?.steps.some((s) => s.id === id && s.done) ?? false,
    [onboarding],
  )

  const brandingDone = Boolean(currentWorkspace?.logo || currentWorkspace?.brand_color)

  const pillars = useMemo<PillarState[]>(() => {
    const emailDone = stepDone('email')
    const companyDone = stepDone('company')
    const assistantDone = stepDone('assistant')
    return [
      {
        id: 'communication',
        title: '1. Communication',
        description:
          'Connect the channels where customers reach you. Every workspace starts with a built-in Bokito email address that receives mail instantly — connect Gmail or Outlook when you want your own mailbox in the loop.',
        icon: Mail,
        done: emailDone,
        detail: emailDone ? 'Mailbox connected' : 'Built-in Bokito address ready',
        logos: ['bokito', 'gmail', 'outlook'],
        actions: [
          { label: 'View your Bokito address', to: '/settings/channels', primary: !emailDone },
          { label: 'Connect a mailbox', to: '/settings/channels' },
          { label: 'Browse channels', to: '/settings/marketplace?kind=channel' },
        ],
      },
      {
        id: 'intelligence',
        title: '2. Intelligence',
        description:
          'Teach the platform about your organization and build your agent team. The assistant interviews you and sets things up as you talk.',
        icon: MessageSquare,
        done: companyDone && assistantDone && agentCount > 0,
        detail: [
          companyDone ? 'Company knowledge documented' : 'Company knowledge still empty',
          agentCount > 0 ? `${agentCount} agent${agentCount === 1 ? '' : 's'}` : 'no agents yet',
        ].join(' - '),
        knowledge: true,
        actions: [
          {
            label: 'Set up with the assistant',
            to: `/communication/new?prefill=${encodeURIComponent(ASSISTANT_SETUP_PROMPT)}`,
            primary: !(companyDone && assistantDone),
          },
          { label: 'Open Knowledge', to: '/knowledge' },
          { label: 'Manage agents', to: '/agents' },
        ],
      },
      {
        id: 'automations',
        title: '3. Automations',
        description:
          'Schedule background work: daily digests, periodic checks, webhooks from external systems.',
        icon: CalendarClock,
        done: automationCount > 0,
        detail:
          automationCount > 0
            ? `${automationCount} automation${automationCount === 1 ? '' : 's'} configured`
            : 'No automations yet',
        actions: [{ label: 'Open Agenda', to: '/agenda', primary: automationCount === 0 }],
      },
      {
        id: 'branding',
        title: '4. Branding & widget',
        description:
          'Give the workspace your identity and put the chat widget on your website so visitors can reach your AI.',
        icon: Palette,
        done: brandingDone,
        detail: brandingDone ? 'Branding configured' : 'Branding not configured yet',
        actions: [
          { label: 'Branding', to: '/settings/branding', primary: !brandingDone },
          { label: 'Install widget', to: '/ai/assistant/external/installation' },
        ],
      },
      {
        id: 'kpis',
        title: '5. KPIs & metrics',
        description:
          'Track the numbers that matter to you on the Cockpit. Agents keep them up to date automatically.',
        icon: BarChart3,
        done: metricCount > 0,
        detail:
          metricCount > 0
            ? `${metricCount} custom metric${metricCount === 1 ? '' : 's'}`
            : 'No custom metrics yet',
        actions: [{ label: 'Open Cockpit', to: '/cockpit', primary: metricCount === 0 }],
      },
    ]
  }, [stepDone, agentCount, automationCount, brandingDone, metricCount])

  const doneCount = pillars.filter((p) => p.done).length

  return (
    <PageContent>
      <ContentHeader
        title="Setup"
        subtitle="Set up your AI workspace in five steps - from customer channels to the KPIs on your Cockpit."
      />

      <div className="mx-auto max-w-3xl space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-bg-surface px-4 py-5 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking workspace status...
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-bg-surface px-4 py-3 shadow-card">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
                <Sparkles size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-heading">
                  {doneCount} of {pillars.length} pillars ready
                </p>
                <p className="text-xs text-text-secondary">
                  Prefer talking instead of clicking? The assistant can set everything up with you.
                </p>
              </div>
              <Link
                to={`/communication/new?prefill=${encodeURIComponent(ASSISTANT_SETUP_PROMPT)}`}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
              >
                <Bot size={13} />
                Start with the assistant
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
                          {pillar.actions.map((action) => (
                            <Link
                              key={action.to + action.label}
                              to={action.to}
                              className={
                                action.primary
                                  ? 'inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover'
                                  : 'inline-flex items-center gap-1 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary'
                              }
                            >
                              {action.label}
                              <ArrowRight size={11} />
                            </Link>
                          ))}
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>

            <p className="text-xs text-text-muted">
              Advanced integrations (connected tools, webhooks, API) live under{' '}
              <Link to="/settings/integrations" className="text-accent hover:underline">
                Settings - Integrations
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </PageContent>
  )
}
