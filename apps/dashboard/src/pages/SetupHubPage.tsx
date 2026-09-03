import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Bot,
  CalendarClock,
  Check,
  Loader2,
  Mail,
  MessageSquare,
  Sparkles,
} from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import { PageIntro } from '../components/layout/PageIntro'
import { useAuth } from '../context/AuthContext'
import { appScopedGet } from '../lib/api'
import { appRoutes } from '../api/routes/app.routes'
import { listTriggers, updateTrigger } from '../lib/orchestration-api'
import { platformCheckInTrigger, talkToAssistantPath } from '../lib/talk-to-assistant'
import {
  useDemoThread,
  type OnboardingStatus,
} from '../components/onboarding/OnboardingChecklist'

type CoreStepId = 'email' | 'assistant' | 'first_decision' | 'watching'

type CoreStep = {
  id: CoreStepId
  title: string
  description: string
  done: boolean
  icon: React.ComponentType<{ size?: number; className?: string }>
  actions: { label: string; to?: string; onClick?: () => void; primary?: boolean; busy?: boolean }[]
}

type LaterLink = { label: string; to: string }

export default function SetupHubPage() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [loading, setLoading] = useState(true)
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null)
  const [checkIn, setCheckIn] = useState<{ id: string; enabled: boolean } | null>(null)
  const [enablingWatch, setEnablingWatch] = useState(false)
  const { start: startDemo, starting: demoStarting } = useDemoThread()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [status, triggers] = await Promise.all([
        token
          ? appScopedGet<OnboardingStatus>(appRoutes.onboarding.status, token).catch(() => null)
          : Promise.resolve(null),
        listTriggers().catch(() => []),
      ])
      setOnboarding(status)
      const heartbeat = platformCheckInTrigger(triggers)
      setCheckIn(heartbeat ? { id: heartbeat.id, enabled: heartbeat.enabled } : null)
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

  const assistantPrompt = t('setupGuidePage.assistantPrompt')

  const steps = useMemo<CoreStep[]>(() => {
    const emailDone = stepDone('email')
    const assistantDone = stepDone('assistant') || stepDone('company')
    const decisionDone = stepDone('first_decision')
    const watchDone = stepDone('watching') || Boolean(checkIn?.enabled)
    return [
      {
        id: 'email',
        title: t('setupGuidePage.core.channel.title', {
          defaultValue: 'Connect a channel',
        }),
        description: t('setupGuidePage.core.channel.description', {
          defaultValue: 'Create a Bokito address or connect a mailbox so mail can arrive.',
        }),
        done: emailDone,
        icon: Mail,
        actions: [
          {
            label: t('setupGuidePage.communication.viewAddress'),
            to: '/settings/channels',
            primary: !emailDone,
          },
          {
            label: t('setupGuidePage.communication.connectMailbox'),
            to: '/settings/channels',
          },
        ],
      },
      {
        id: 'assistant',
        title: t('setupGuidePage.core.assistant.title', {
          defaultValue: 'Talk with the assistant',
        }),
        description: t('setupGuidePage.core.assistant.description', {
          defaultValue: 'A short chat fills company knowledge and sets up the rest with you.',
        }),
        done: assistantDone,
        icon: MessageSquare,
        actions: [
          {
            label: t('setupGuidePage.intelligence.setupAssistant'),
            to: talkToAssistantPath(assistantPrompt),
            primary: !assistantDone,
          },
        ],
      },
      {
        id: 'first_decision',
        title: t('setupGuidePage.core.decision.title', {
          defaultValue: 'Approve one decision',
        }),
        description: t('setupGuidePage.core.decision.description', {
          defaultValue: 'See how a decision card works in a thread.',
        }),
        done: decisionDone,
        icon: Check,
        actions: [
          {
            label: t('setupGuidePage.communication.decisionTodo'),
            onClick: () => startDemo(),
            primary: !decisionDone,
            busy: demoStarting,
          },
        ],
      },
      {
        id: 'watching',
        title: t('setupGuidePage.core.watch.title', {
          defaultValue: 'Turn on check-in',
        }),
        description: t('setupGuidePage.core.watch.description', {
          defaultValue: 'Let the assistant watch the workspace and tell you when something needs you.',
        }),
        done: watchDone,
        icon: CalendarClock,
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
            : [
                {
                  label: t('setupGuidePage.automations.askAssistant'),
                  to: talkToAssistantPath(t('setupGuidePage.automations.assistantPrompt')),
                  primary: !watchDone,
                },
              ]),
        ],
      },
    ]
  }, [
    assistantPrompt,
    checkIn,
    demoStarting,
    enableCheckIn,
    enablingWatch,
    startDemo,
    stepDone,
    t,
  ])

  const later = useMemo<LaterLink[]>(
    () => [
      { label: t('setupGuidePage.later.branding', { defaultValue: 'Branding' }), to: '/settings/branding' },
      { label: t('setupGuidePage.later.team', { defaultValue: 'Invite the team' }), to: '/settings/members' },
      {
        label: t('setupGuidePage.later.modules', { defaultValue: 'Add a field of work' }),
        to: '/connections',
      },
      { label: t('setupGuidePage.later.projects', { defaultValue: 'Projects' }), to: '/projects' },
      { label: t('setupGuidePage.later.kpis', { defaultValue: 'Numbers on Cockpit' }), to: '/cockpit' },
      { label: t('setupGuidePage.later.govern', { defaultValue: 'Govern' }), to: '/settings/govern' },
    ],
    [t],
  )

  const doneCount = steps.filter((step) => step.done).length

  return (
    <PageContent>
      <PageIntro description={t('pageHeaders.setupGuide')} className="mb-4" />

      <div className="mx-auto max-w-3xl space-y-6">
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
                  {t('setupGuidePage.stepsReady', {
                    defaultValue: '{{done}} of {{total}} setup steps done',
                    done: doneCount,
                    total: steps.length,
                  })}
                </p>
                <p className="text-xs text-text-secondary">{t('setupGuidePage.preferTalking')}</p>
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
              {steps.map((step, index) => {
                const Icon = step.icon
                return (
                  <li
                    key={step.id}
                    className={`rounded-xl border p-4 shadow-card ${
                      step.done
                        ? 'border-border/60 bg-bg-elevated/30'
                        : 'border-border/60 bg-bg-surface'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                          step.done
                            ? 'bg-status-success/15 text-status-success'
                            : 'bg-bg-hover/70 text-text-muted'
                        }`}
                      >
                        {step.done ? <Check size={17} /> : <Icon size={17} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h2 className="text-sm font-semibold text-text-heading">
                          {index + 1}. {step.title}
                        </h2>
                        <p className="mt-0.5 text-[12.5px] text-text-secondary">{step.description}</p>
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          {step.actions.map((action) =>
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

            <section>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                {t('setupGuidePage.later.title', { defaultValue: 'Later' })}
              </h2>
              <ul className="divide-y divide-border/50 rounded-xl border border-border/60 bg-bg-surface">
                {later.map((item) => (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      className="flex items-center justify-between px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover/40 hover:text-text-primary"
                    >
                      {item.label}
                      <ArrowRight size={12} className="text-text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <p className="text-xs text-text-muted">
              {t('setupGuidePage.advancedHint')}{' '}
              <Link to="/connections/connected" className="text-accent hover:underline">
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
