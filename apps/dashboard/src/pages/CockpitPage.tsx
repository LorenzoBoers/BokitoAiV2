import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarClock,
  CalendarDays,
  Gauge,
  Inbox,
  Mail,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  Timer,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import ContentHeader from '../components/shell/ContentHeader'
import ConnectionStatus from '../components/shell/ConnectionStatus'
import CockpitTabs from '../components/shell/CockpitTabs'
import CustomMetricsSection from '../components/cockpit/CustomMetricsSection'
import { OnboardingCompactCard, useOnboardingStatus } from '../components/onboarding/OnboardingChecklist'
import { PageContent } from '../components/layout/PageContent'
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
import { useAuth } from '../context/AuthContext'
import { onGatewayEvent } from '../lib/gateway'
import {
  bokitoGetCockpitActivity,
  bokitoGetCockpitSummary,
  type CockpitActivityEvent,
  type CockpitSummary,
} from '../lib/bokito-api'
import { getPosture, listGovernChanges, type AutonomyPostureId } from '../lib/govern-api'
import { listThreads, type InboxThread } from '../lib/inbox-api'
import { patchSignalThread } from '../lib/signals-api'
import { snoozeUntilIso, SNOOZE_PRESETS } from '../lib/snooze'
import { translateDecisionText } from '../lib/activity-labels'
import { agentRunsPath, attentionThreadPath, channelPath, decisionsPath, inboxPath } from '../lib/messages-paths'
import { isPageGuideDismissed } from '../lib/page-guides'
import { agentWorkforceRunUrl } from '../lib/workforce-run-urls'
import { enrichContactsFromThreads, listContacts, type ContactRow } from '../lib/contacts-api'
import {
  activityEventMessage,
  activityEventTypeLabel,
  collapseCockpitEvents,
  isCockpitHeadlineEvent,
} from '../lib/activity-labels'
import { listAgendaOccurrences, listTriggers, updateTrigger, type AgendaItem } from '../lib/orchestration-api'
import { platformCheckInTrigger, talkToAssistantPath } from '../lib/talk-to-assistant'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { PersonAvatar } from '../components/ui/PersonAvatar'
import { ChannelGlyph, channelKind } from '../components/ui/ChannelGlyph'
import { formatAppDate, formatAppTime } from '../lib/app-locale'
import { formatAppNumber, formatAppUsdCents } from '../lib/app-number'
import { greetingBucket, greetingFirstName } from '../lib/cockpit-greeting'
import { WEBSITE_WIDGET_PATH } from '../lib/assistant-settings-path'
import { humanizeContactName, isGenericVisitorName, isPlaceholderContactAddress } from '../lib/contact-label'
import { canComposeToAddress, composeEmailPath } from '../lib/compose-intent'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import { humanizeLabel } from '../lib/labels'
import { agendaKindLabel } from '../lib/status-labels'

function timeAgo(iso: string, t: (key: string, opts?: { count: number }) => string): string {
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return t('cockpitPage.now')
  if (mins < 60) return t('cockpitPage.minutesAgo', { count: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('cockpitPage.hoursAgo', { count: hours })
  return t('cockpitPage.daysAgo', { count: Math.floor(hours / 24) })
}

const LOOP_HINT_KEY = 'bokito.ui.hideLoopHint'

function PlatformWatchCard() {
  const { t } = useTranslation('nav')
  const [checkIn, setCheckIn] = useState<{ id: string; enabled: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listTriggers()
      .then((rows) => {
        if (cancelled) return
        const row = platformCheckInTrigger(rows)
        setCheckIn(row ? { id: row.id, enabled: row.enabled } : null)
      })
      .catch(() => {
        if (!cancelled) setCheckIn(null)
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!ready || !checkIn || checkIn.enabled) return null

  return (
    <section className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[14px] font-semibold text-text-heading">{t('cockpitPage.watchTitle')}</p>
        <p className="mt-0.5 text-[12px] text-text-muted">{t('cockpitPage.watchHint')}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void updateTrigger(checkIn.id, { enabled: true })
              .then(() => setCheckIn({ ...checkIn, enabled: true }))
              .finally(() => setBusy(false))
          }}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? t('cockpitPage.watchEnabling') : t('cockpitPage.watchEnable')}
        </button>
        <Link
          to={talkToAssistantPath(t('cockpitPage.watchAskPrefill'))}
          className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover/60"
        >
          {t('cockpitPage.watchAsk')}
        </Link>
        <Link
          to="/agenda?view=automations"
          className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover/60"
        >
          {t('cockpitPage.watchOpenAgenda')}
        </Link>
      </div>
    </section>
  )
}

function HowItFitsCard() {
  const { t } = useTranslation('nav')
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(LOOP_HINT_KEY) === '1'
    } catch {
      return false
    }
  })
  if (hidden || !isPageGuideDismissed('cockpit')) return null
  const steps = [
    {
      to: inboxPath('open'),
      icon: MessageSquare,
      title: t('cockpitPage.loopMessages'),
      hint: t('cockpitPage.loopMessagesHint'),
    },
    {
      to: '/agents',
      icon: Bot,
      title: t('cockpitPage.loopAgents'),
      hint: t('cockpitPage.loopAgentsHint'),
    },
    {
      to: '/agenda',
      icon: CalendarDays,
      title: t('cockpitPage.loopAgenda'),
      hint: t('cockpitPage.loopAgendaHint'),
    },
    {
      to: '/settings/govern',
      icon: ShieldCheck,
      title: t('cockpitPage.loopGovern'),
      hint: t('cockpitPage.loopGovernHint'),
    },
  ]
  return (
    <section className="mb-4 rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-text-heading">{t('cockpitPage.loopTitle')}</h2>
          <p className="mt-0.5 text-[12px] text-text-muted">{t('cockpitPage.loopHint')}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(LOOP_HINT_KEY, '1')
            } catch {
              // ignore
            }
            setHidden(true)
          }}
          className="rounded-md p-1 text-text-muted hover:bg-bg-hover/60 hover:text-text-primary"
          title={t('cockpitPage.loopDismiss')}
          aria-label={t('cockpitPage.loopDismiss')}
        >
          <X size={14} />
        </button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => {
          const Icon = step.icon
          return (
            <Link
              key={step.to}
              to={step.to}
              className="group rounded-lg border border-border/40 bg-bg-elevated/45 px-3 py-2.5 transition-colors hover:border-accent/40"
            >
              <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-primary">
                <Icon size={13} className="text-text-muted group-hover:text-accent" />
                {step.title}
              </span>
              <span className="mt-1 block text-[11px] leading-snug text-text-muted">{step.hint}</span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

function StatCard({
  label,
  value,
  sub,
  to,
  icon: Icon,
  index = 0,
}: {
  label: string
  value: string
  sub?: string
  to?: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  index?: number
}) {
  const body = (
    <div
      className="hover-lift flex h-full flex-col rounded-xl border border-border/60 bg-bg-surface px-4 py-3.5 shadow-card stagger-in"
      style={{ '--stagger': index } as CSSProperties}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">{label}</p>
        <Icon size={13} className="text-text-muted transition-colors duration-200 group-hover:text-accent" />
      </div>
      <p className="mt-2 text-[22px] font-semibold leading-none tracking-tight text-text-heading">
        <span key={value} className="count-pop tabular-nums">
          {value}
        </span>
      </p>
      {sub ? <p className="mt-1.5 text-[11px] text-text-muted">{sub}</p> : null}
    </div>
  )
  return to ? (
    <Link to={to} className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      {body}
    </Link>
  ) : (
    body
  )
}

export default function CockpitPage() {
  const { t, i18n } = useTranslation(['nav', 'communication'])
  const { token, user } = useAuth()
  const { activeConnections } = useMailboxConnections()
  const mailboxReady = activeConnections.length > 0
  const [summary, setSummary] = useState<CockpitSummary | null>(null)
  const [posture, setPosture] = useState<AutonomyPostureId | null>(null)
  const [pendingChanges, setPendingChanges] = useState(0)
  const [attentionThreads, setAttentionThreads] = useState<InboxThread[]>([])
  const [events, setEvents] = useState<CockpitActivityEvent[]>([])
  const headlineEvents = useMemo(
    () => collapseCockpitEvents(events.filter(isCockpitHeadlineEvent)).slice(0, 16),
    [events],
  )
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([])
  const [recentContacts, setRecentContacts] = useState<ContactRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [partialFailures, setPartialFailures] = useState<string[]>([])
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const { status: onboardingStatus, dismissed: onboardingDismissed, undismiss } = useOnboardingStatus()
  const onboardingVisible = Boolean(onboardingStatus && !onboardingStatus.completed && !onboardingDismissed)
  const greetingName = greetingFirstName(user?.name)
  const greetingBucketId = greetingBucket()
  const greetingKey = greetingName
    ? greetingBucketId === 'morning'
      ? 'cockpitPage.greetingMorning'
      : greetingBucketId === 'afternoon'
        ? 'cockpitPage.greetingAfternoon'
        : 'cockpitPage.greetingEvening'
    : greetingBucketId === 'morning'
      ? 'cockpitPage.greetingMorningPlain'
      : greetingBucketId === 'afternoon'
        ? 'cockpitPage.greetingAfternoonPlain'
        : 'cockpitPage.greetingEveningPlain'

  const load = useCallback(() => {
    if (!token) return
    setLoading(true)
    setError(null)
    // Slice failures degrade to empty widgets but are collected so the page
    // can show a "partially loaded" warning instead of pretending all is fine.
    const failures: string[] = []
    const slice = <T,>(promise: Promise<T>, fallback: T, label: string): Promise<T> =>
      promise.catch(() => {
        failures.push(label)
        return fallback
      })
    Promise.all([
      slice(bokitoGetCockpitSummary(token), null as CockpitSummary | null, t('cockpitPage.sliceSummary')),
      slice(getPosture().then((r) => r.posture), null as AutonomyPostureId | null, t('cockpitPage.slicePosture')),
      slice(
        listGovernChanges('pending_review').then((rows) =>
          Array.isArray(rows.items) ? rows.items.length : 0,
        ),
        0,
        t('cockpitPage.sliceDrafts'),
      ),
      slice(
        listThreads(token, { view: 'awaiting_decision', perPage: 6 }).then((r) => r.items),
        [] as InboxThread[],
        t('cockpitPage.sliceDecisions'),
      ),
      slice(bokitoGetCockpitActivity(token, 30), [] as CockpitActivityEvent[], t('cockpitPage.sliceActivity')),
      slice(
        listAgendaOccurrences({
          from: new Date().toISOString(),
          to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }),
        [] as AgendaItem[],
        t('cockpitPage.sliceAgenda'),
      ),
      slice(listContacts(token), [] as ContactRow[], t('cockpitPage.sliceContacts')),
      slice(listThreads(token, { perPage: 80 }).then((r) => r.items), [] as InboxThread[], t('cockpitPage.sliceInbox')),
    ])
      .then(([summaryResp, postureResp, changes, threads, activity, agenda, contacts, inboxThreads]) => {
        setSummary(summaryResp)
        setPosture(postureResp)
        setPendingChanges(changes)
        setAttentionThreads(threads.filter((thread) => thread.channel !== 'assistant'))
        setEvents(activity)
        setAgendaItems(
          agenda
            .filter((i) => i.status === 'planned')
            .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
            .slice(0, 5),
        )
        setRecentContacts(
          [...enrichContactsFromThreads(contacts, inboxThreads)]
            .filter(
              (contact) =>
                !isPlaceholderContactAddress(contact.address) &&
                !isGenericVisitorName(contact.displayName),
            )
            .sort(
              (a, b) =>
                new Date(b.lastSeenAt ?? b.createdAt).getTime() -
                new Date(a.lastSeenAt ?? a.createdAt).getTime(),
            )
            .slice(0, 5),
        )
      })
      .then(() => setPartialFailures(failures))
      .catch((err) => setError(formatApiErrorMessage(err, t('cockpitPage.loadError'))))
      .finally(() => {
        setLoading(false)
        setRefreshedAt(new Date())
      })
  }, [token, t])

  useEffect(() => {
    load()
  }, [load])

  // Refresh on live decision/run events (debounced via simple timeout).
  useEffect(() => {
    if (!token) return
    let timer: number | null = null
    const trigger = () => {
      if (timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        load()
      }, 2_000)
    }
    const unsubs = [onGatewayEvent('decisions', trigger), onGatewayEvent('runs', trigger)]
    return () => {
      unsubs.forEach((u) => u())
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [token, load])

  const snoozeAttention = useCallback(
    async (threadId: InboxThread['id']) => {
      if (!token) return
      const tomorrow = SNOOZE_PRESETS.find((preset) => preset.key === 'tomorrow')
      if (!tomorrow) return
      try {
        await patchSignalThread(token, String(threadId), {
          status: 'pending',
          snoozedUntil: snoozeUntilIso(tomorrow),
        })
        setAttentionThreads((prev) => prev.filter((row) => String(row.id) !== String(threadId)))
        toast.success(t('cockpitPage.snoozedUntilTomorrow'))
      } catch (err) {
        toast.error(formatApiErrorMessage(err, t('cockpitPage.snoozeFailed')))
      }
    },
    [token, t],
  )

  const attentionCount = attentionThreads.length + pendingChanges
  const firstAttention = attentionThreads[0]
  const decisionHref = firstAttention
    ? attentionThreadPath(firstAttention)
    : decisionsPath()
  // Prefer live attention list when summary lags (e.g. internal agent-run decisions).
  const openDecisionCount = Math.max(summary?.open_decisions ?? 0, attentionThreads.length)
  const freshAttention = attentionThreads.filter((thread) => {
    const days = thread.lastMessageAt
      ? Math.floor((Date.now() - new Date(thread.lastMessageAt).getTime()) / 86_400_000)
      : 0
    return days < 14
  })
  const staleAttention = attentionThreads.filter((thread) => {
    const days = thread.lastMessageAt
      ? Math.floor((Date.now() - new Date(thread.lastMessageAt).getTime()) / 86_400_000)
      : 0
    return days >= 14
  })

  return (
    <PageContent width="xl">
      {!onboardingVisible ? <PageGuideBanner page="cockpit" className="mb-4" /> : null}
      <ContentHeader
        title={t('tabs.cockpit.title')}
        subtitle={`${t(greetingKey, { name: greetingName })} · ${formatAppDate(new Date(), i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}`}
        meta={
          <>
            <ConnectionStatus />
            {refreshedAt ? (
              <span className="text-[11px] text-text-muted">
                {t('cockpitPage.refreshedAt', { time: formatAppTime(refreshedAt, i18n.language) })}
              </span>
            ) : null}
            <button
              type="button"
              onClick={load}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              {t('cockpitPage.refresh')}
            </button>
          </>
        }
      />

      <CockpitTabs />

      <OnboardingCompactCard />
      {onboardingStatus && !onboardingStatus.completed && onboardingDismissed ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border/60 px-4 py-2.5">
          <p className="text-[12.5px] text-text-muted">{t('communication:onboarding.dismissedHint')}</p>
          <button
            type="button"
            onClick={undismiss}
            className="shrink-0 text-[12px] font-medium text-accent hover:underline"
          >
            {t('cockpitPage.showSetupAgain')}
          </button>
        </div>
      ) : null}
      {!onboardingVisible ? <PlatformWatchCard /> : null}
      <HowItFitsCard />

      {error ? <ApiErrorBanner message={error} onRetry={load} /> : null}
      {!error && partialFailures.length > 0 ? (
        <ApiErrorBanner
          message={t('cockpitPage.partialLoadError', { items: partialFailures.join(', ') })}
          onRetry={load}
        />
      ) : null}

      {/* Snapshot */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        <StatCard
          index={0}
          label={t('cockpitPage.conversations')}
          value={summary ? formatAppNumber(summary.volume_week, i18n.language) : '-'}
          sub={
            summary
              ? summary.volume_week === 0
                ? t('cockpitPage.conversationsEmptyHint')
                : t('cockpitPage.conversationsHint')
              : undefined
          }
          icon={MessageSquare}
          to={inboxPath('open')}
        />
        <StatCard
          index={1}
          label={t('cockpitPage.awaitingDecision')}
          value={summary ? formatAppNumber(openDecisionCount, i18n.language) : '-'}
          sub={
            summary
              ? openDecisionCount === 0
                ? t('cockpitPage.awaitingDecisionEmptyHint')
                : t('cockpitPage.awaitingDecisionHint')
              : undefined
          }
          icon={Inbox}
          to={decisionHref}
        />
        <StatCard
          index={2}
          label={t('cockpitPage.autonomyRate')}
          value={summary ? `${formatAppNumber(summary.autonomy_rate_pct, i18n.language)}%` : '-'}
          sub={
            summary && summary.autonomy_rate_pct === 0
              ? t('cockpitPage.autonomyEmptyHint')
              : t('cockpitPage.autonomyHint')
          }
          icon={Gauge}
          to="/settings/govern?tab=policy"
        />
        <StatCard
          index={3}
          label={t('cockpitPage.posture')}
          value={
            posture === 'manual'
              ? t('cockpitPage.postureManual')
              : posture === 'assisted'
                ? t('cockpitPage.postureAssisted')
                : posture === 'autonomous'
                  ? t('cockpitPage.postureAutonomous')
                  : '-'
          }
          icon={ShieldCheck}
          to="/settings/govern?tab=policy"
        />
        <StatCard
          index={4}
          label={t('cockpitPage.timeSaved')}
          value={summary ? `${formatAppNumber(summary.time_saved_minutes_week, i18n.language)}m` : '-'}
          sub={
            summary && summary.time_saved_minutes_week === 0
              ? t('cockpitPage.timeSavedEmptyHint')
              : undefined
          }
          icon={Timer}
          to={
            summary && summary.time_saved_minutes_week === 0 ? '/agents' : '/cockpit/usage'
          }
        />
        <StatCard
          index={5}
          label={t('cockpitPage.csat')}
          value={summary && summary.csat_score != null ? `${formatAppNumber(summary.csat_score, i18n.language)}/5` : '-'}
          sub={
            summary && summary.csat_responses > 0
              ? t('cockpitPage.csatResponses', { count: summary.csat_responses })
              : t('cockpitPage.noRatings')
          }
          icon={Star}
          to={
            summary && summary.csat_responses > 0
              ? channelPath('webchat')
              : WEBSITE_WIDGET_PATH
          }
        />
        <StatCard
          index={6}
          label={t('cockpitPage.usage')}
          value={summary ? formatAppNumber(summary.tokens_month, i18n.language) : '-'}
          sub={
            summary
              ? summary.cost_cents_month === 0
                ? t('cockpitPage.usageEmptyHint')
                : formatAppUsdCents(summary.cost_cents_month, i18n.language)
              : undefined
          }
          icon={Sparkles}
          to="/cockpit/usage"
        />
      </div>

      {/* Tenant-defined KPIs, fillable by users and agents */}
      <CustomMetricsSection />

      {/* Attention + event log */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[14px] font-semibold text-text-heading">{t('cockpitPage.needsAttention')}</h2>
              <p className="text-[12px] text-text-muted">{t('cockpitPage.needsAttentionHint')}</p>
            </div>
            {attentionCount > 0 ? (
              <div className="flex items-center gap-2">
                {firstAttention ? (
                  <Link
                    to={attentionThreadPath(firstAttention)}
                    className="text-[12px] font-medium text-accent hover:underline"
                  >
                    {t('cockpitPage.openFirst')}
                  </Link>
                ) : pendingChanges > 0 ? (
                  <Link
                    to="/settings/govern?tab=drafts"
                    className="text-[12px] font-medium text-accent hover:underline"
                  >
                    {t('cockpitPage.openFirst')}
                  </Link>
                ) : null}
                <span className="inline-flex items-center gap-1 rounded-full bg-status-warning/15 px-2 py-0.5 text-[11px] font-semibold text-status-warning">
                  <AlertTriangle size={11} />
                  {attentionCount}
                </span>
              </div>
            ) : null}
          </div>
          <div className="mt-3 space-y-1.5">
            {attentionThreads.length === 0 && pendingChanges === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center">
                <p className="text-[12px] text-text-muted">{t('cockpitPage.nothingAttention')}</p>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                  <Link
                    to={inboxPath('open')}
                    className="text-[12px] font-medium text-accent hover:underline"
                  >
                    {t('cockpitPage.openCommunication')}
                  </Link>
                  <Link
                    to="/agenda"
                    className="text-[12px] font-medium text-accent hover:underline"
                  >
                    {t('cockpitPage.openAgenda')}
                  </Link>
                  <Link
                    to="/settings/govern?tab=drafts"
                    className="text-[12px] font-medium text-accent hover:underline"
                  >
                    {t('cockpitPage.openGovernDrafts')}
                  </Link>
                </div>
              </div>
            ) : (
              <>
                {[...freshAttention, ...staleAttention].map((thread, index) => {
                  const waitingDays = thread.lastMessageAt
                    ? Math.floor((Date.now() - new Date(thread.lastMessageAt).getTime()) / 86_400_000)
                    : 0
                  const showStaleHeading = staleAttention.length > 0 && index === freshAttention.length
                  return (
                  <div key={String(thread.id)}>
                    {showStaleHeading ? (
                      <p className="mb-1.5 mt-2 text-[11px] font-medium text-text-muted">
                        {t('cockpitPage.staleAttention')}
                      </p>
                    ) : null}
                  <div className="row-interactive group flex items-center gap-1 rounded-lg border border-border/40 bg-bg-elevated/45 px-2 py-1.5 hover:border-accent/40">
                    <Link
                      to={attentionThreadPath(thread)}
                      title={String(thread.id)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 px-1 py-0.5"
                    >
                    <span className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-status-warning" />
                    <ChannelGlyph channel={thread.channel ?? 'email'} size={12} className="shrink-0 text-text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-text-primary">
                        {translateDecisionText(
                          thread.emailSubject || thread.contactName,
                          t,
                        ) || t('cockpitPage.decisionNeeded')}
                      </span>
                      <span className="block truncate text-[11px] text-text-muted">
                        {waitingDays >= 7
                          ? t('cockpitPage.waitingDays', { count: waitingDays })
                          : `${thread.contactName ||
                              (thread.channel
                                ? t(`contactsPage.channels.${channelKind(thread.channel)}`, {
                                    defaultValue: humanizeLabel(thread.channel),
                                  })
                                : t('cockpitPage.threadFallback'))}${
                              thread.lastMessageAt ? ` - ${timeAgo(thread.lastMessageAt, t)}` : ''
                            }`}
                      </span>
                    </span>
                    <ArrowRight size={12} className="shrink-0 text-text-muted group-hover:text-accent" />
                    </Link>
                    <button
                      type="button"
                      title={t('cockpitPage.snoozeTomorrow')}
                      aria-label={t('cockpitPage.snoozeTomorrow')}
                      onClick={() => void snoozeAttention(thread.id)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary"
                    >
                      <CalendarClock size={13} />
                    </button>
                  </div>
                  </div>
                  )
                })}
                {pendingChanges > 0 ? (
                  <Link
                    to="/settings/govern?tab=drafts"
                    className="row-interactive group flex items-center gap-2.5 rounded-lg border border-border/40 bg-bg-elevated/45 px-3 py-2 hover:border-accent/40"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium text-text-primary">
                        {t('cockpitPage.changesAwaiting', { count: pendingChanges })}
                      </span>
                      <span className="block text-[11px] text-text-muted">{t('cockpitPage.reviewGovern')}</span>
                    </span>
                    <ArrowRight size={12} className="shrink-0 text-text-muted group-hover:text-accent" />
                  </Link>
                ) : null}
              </>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[14px] font-semibold text-text-heading">{t('cockpitPage.recentEvents')}</h2>
              <p className="text-[12px] text-text-muted">{t('cockpitPage.recentEventsHint')}</p>
            </div>
            <Link to="/cockpit/activity" className="text-[12px] font-medium text-accent hover:underline">
              {t('cockpitPage.openActivity')}
            </Link>
          </div>
          <div className="mt-3 max-h-[340px] space-y-px overflow-y-auto">
            {headlineEvents.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center">
                <p className="text-[12px] text-text-muted">{t('cockpitPage.noEvents')}</p>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  <Link
                    to={inboxPath('open')}
                    className="text-[12px] font-medium text-accent hover:underline"
                  >
                    {t('cockpitPage.openCommunication')}
                  </Link>
                  <Link
                    to="/agents"
                    className="text-[12px] font-medium text-accent hover:underline"
                  >
                    {t('cockpitPage.openAgents')}
                  </Link>
                  <Link
                    to="/settings/setup"
                    className="text-[12px] font-medium text-accent hover:underline"
                  >
                    {t('cockpitPage.openSetup')}
                  </Link>
                </div>
              </div>
            ) : (
              headlineEvents.map((ev, idx) => {
                // Deep-link an event to its thread, or to the run detail.
                const target = ev.signal_id
                  ? ev.kind === 'agent_run'
                    ? agentRunsPath('all', ev.signal_id)
                    : inboxPath('open', ev.signal_id)
                  : ev.agent_id && ev.run_id
                    ? agentWorkforceRunUrl(ev.agent_id, ev.run_id)
                    : ev.agent_id
                      ? `/agents/${ev.agent_id}`
                      : '/cockpit/activity'
                const body = (
                  <>
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        ev.event_type === 'failed' || ev.event_type === 'error'
                          ? 'bg-status-error'
                          : ev.kind === 'agent_run'
                            ? 'bg-accent'
                            : 'bg-status-info'
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-text-primary">
                        {activityEventMessage(ev.message, t) || activityEventTypeLabel(ev.event_type, t)}
                      </span>
                      <span className="block text-[10px] text-text-muted">
                        {ev.actor_name ? `${ev.actor_name} - ` : ''}
                        {activityEventTypeLabel(ev.event_type, t)} - {timeAgo(ev.created_at, t)}
                        {ev.repeatCount > 1 ? ` · ${t('cockpitPage.eventRepeats', { count: ev.repeatCount })}` : ''}
                      </span>
                    </span>
                  </>
                )
                return target ? (
                  <Link
                    key={`${ev.created_at}-${idx}`}
                    to={target}
                    className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-bg-hover/50"
                  >
                    {body}
                  </Link>
                ) : (
                  <div key={`${ev.created_at}-${idx}`} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5">
                    {body}
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>

      {/* Agenda + contacts */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[14px] font-semibold text-text-heading">{t('cockpitPage.todayAgenda')}</h2>
              <p className="text-[12px] text-text-muted">{t('cockpitPage.todayAgendaHint')}</p>
            </div>
            <Link to="/agenda" className="text-[12px] font-medium text-accent hover:underline">
              {t('cockpitPage.openAgenda')}
            </Link>
          </div>
          <div className="mt-3 space-y-1.5">
            {agendaItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center">
                <p className="text-[12px] text-text-muted">{t('cockpitPage.nothingScheduled')}</p>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
                  <Link to="/agenda" className="text-[12px] font-medium text-accent hover:underline">
                    {t('cockpitPage.openAgenda')}
                  </Link>
                  <Link to="/agenda?view=list" className="text-[12px] font-medium text-accent hover:underline">
                    {t('cockpitPage.planAutomation')}
                  </Link>
                </div>
              </div>
            ) : (
              agendaItems.map((item) => (
                <Link
                  key={item.id}
                  to={item.trigger_id ? `/agenda?trigger=${item.trigger_id}` : '/agenda'}
                  className="group flex items-center gap-2.5 rounded-lg border border-border/40 bg-bg-elevated/45 px-3 py-2 transition-colors hover:border-accent/40"
                >
                  <CalendarDays size={13} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-text-primary">
                      {translateDecisionText(item.name, t) || item.name}
                    </span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {formatAppTime(
                        new Date(item.at.endsWith('Z') ? item.at : `${item.at}Z`),
                        i18n.language,
                      )}
                      {item.agent_name ? ` - ${item.agent_name}` : ''} - {agendaKindLabel(item.kind, t)}
                    </span>
                  </span>
                  <ArrowRight size={12} className="shrink-0 text-text-muted group-hover:text-accent" />
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[14px] font-semibold text-text-heading">{t('cockpitPage.recentContacts')}</h2>
              <p className="text-[12px] text-text-muted">{t('cockpitPage.recentContactsHint')}</p>
            </div>
            <Link to="/contacts" className="text-[12px] font-medium text-accent hover:underline">
              {t('cockpitPage.openContacts')}
            </Link>
          </div>
          <div className="mt-3 space-y-1.5">
            {recentContacts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center">
                <p className="text-[12px] text-text-muted">
                  {t('cockpitPage.noContacts')}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  <Link
                    to="/settings/channels"
                    className="text-[12px] font-medium text-accent hover:underline"
                  >
                    {t('cockpitPage.connectEmail')}
                  </Link>
                  <Link
                    to="/ai/assistant/external/installation"
                    className="text-[12px] font-medium text-accent hover:underline"
                  >
                    {t('cockpitPage.installWidget')}
                  </Link>
                  <Link to="/settings/setup" className="text-[12px] font-medium text-accent hover:underline">
                    {t('cockpitPage.openSetup')}
                  </Link>
                </div>
              </div>
            ) : (
              recentContacts.map((contact) => (
                <div
                  key={contact.id}
                  className="group flex items-center gap-2.5 rounded-lg border border-border/40 bg-bg-elevated/45 px-3 py-2 transition-colors hover:border-accent/40"
                >
                  <Link to={`/contacts/${contact.id}`} className="flex min-w-0 flex-1 items-center gap-2.5">
                    <PersonAvatar name={contact.displayName} email={contact.address} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-text-primary">
                        {humanizeContactName(
                          contact.displayName,
                          contact.address,
                          t('contactsPage.widgetVisitor'),
                        ) || contact.address}
                      </span>
                      <span className="block truncate text-[11px] text-text-muted">
                        {contact.company ||
                          (contact.channel
                            ? t(`contactsPage.channels.${channelKind(contact.channel)}`, {
                                defaultValue: humanizeLabel(contact.channel),
                              })
                            : '')}
                        {contact.lastSeenAt ? ` - ${timeAgo(contact.lastSeenAt, t)}` : ''}
                      </span>
                    </span>
                  </Link>
                  {mailboxReady && canComposeToAddress(contact.channel, contact.address) ? (
                    <Link
                      to={composeEmailPath({ to: contact.address })}
                      title={t('cockpitPage.writeEmail')}
                      aria-label={t('cockpitPage.writeEmail')}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-accent/10 hover:text-accent"
                    >
                      <Mail size={13} />
                    </Link>
                  ) : (
                    <ArrowRight size={12} className="shrink-0 text-text-muted group-hover:text-accent" />
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </PageContent>
  )
}
