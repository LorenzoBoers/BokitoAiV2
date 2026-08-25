import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Gauge,
  Inbox,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  Timer,
  UserRound,
} from 'lucide-react'
import ContentHeader from '../components/shell/ContentHeader'
import ConnectionStatus from '../components/shell/ConnectionStatus'
import CockpitTabs from '../components/shell/CockpitTabs'
import CustomMetricsSection from '../components/cockpit/CustomMetricsSection'
import { OnboardingCompactCard } from '../components/onboarding/OnboardingChecklist'
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
import { agentRunsPath, channelPath, inboxPath } from '../lib/messages-paths'
import { agentWorkforceRunUrl } from '../lib/workforce-run-urls'
import { listContacts, type ContactRow } from '../lib/contacts-api'
import { activityEventMessage, activityEventTypeLabel } from '../lib/activity-labels'
import { listAgendaOccurrences, type AgendaItem } from '../lib/orchestration-api'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)
}

// The usage ledger meters costs in USD (provider pricing); keep the label honest.
function formatCost(cents: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100)
}

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

function StatCard({
  label,
  value,
  sub,
  to,
  icon: Icon,
}: {
  label: string
  value: string
  sub?: string
  to?: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}) {
  const body = (
    <div className="flex h-full flex-col rounded-xl border border-border/60 bg-bg-surface px-4 py-3.5 transition-colors hover:border-accent/35 shadow-card">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">{label}</p>
        <Icon size={13} className="text-text-muted" />
      </div>
      <p className="mt-2 text-[22px] font-semibold leading-none text-text-heading">{value}</p>
      {sub ? <p className="mt-1.5 text-[11px] text-text-muted">{sub}</p> : null}
    </div>
  )
  return to ? (
    <Link to={to} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      {body}
    </Link>
  ) : (
    body
  )
}

export default function CockpitPage() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [summary, setSummary] = useState<CockpitSummary | null>(null)
  const [posture, setPosture] = useState<AutonomyPostureId | null>(null)
  const [pendingChanges, setPendingChanges] = useState(0)
  const [attentionThreads, setAttentionThreads] = useState<InboxThread[]>([])
  const [events, setEvents] = useState<CockpitActivityEvent[]>([])
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([])
  const [recentContacts, setRecentContacts] = useState<ContactRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [partialFailures, setPartialFailures] = useState<string[]>([])

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
      bokitoGetCockpitSummary(token),
      slice(getPosture().then((r) => r.posture), null as AutonomyPostureId | null, 'autonomy posture'),
      slice(
        listGovernChanges('pending_review').then((rows) =>
          Array.isArray(rows.items) ? rows.items.length : 0,
        ),
        0,
        'pending changes',
      ),
      slice(
        listThreads(token, { view: 'awaiting_decision', perPage: 6 }).then((r) => r.items),
        [] as InboxThread[],
        'threads awaiting decision',
      ),
      slice(bokitoGetCockpitActivity(token, 30), [] as CockpitActivityEvent[], 'activity'),
      slice(
        listAgendaOccurrences({
          from: new Date().toISOString(),
          to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }),
        [] as AgendaItem[],
        'agenda',
      ),
      slice(listContacts(token), [] as ContactRow[], 'contacts'),
    ])
      .then(([summaryResp, postureResp, changes, threads, activity, agenda, contacts]) => {
        setSummary(summaryResp)
        setPosture(postureResp)
        setPendingChanges(changes)
        setAttentionThreads(threads)
        setEvents(activity)
        setAgendaItems(
          agenda
            .filter((i) => i.status === 'planned')
            .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
            .slice(0, 5),
        )
        setRecentContacts(
          [...contacts]
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
      .finally(() => setLoading(false))
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

  const attentionCount = attentionThreads.length + pendingChanges

  return (
    <PageContent width="xl">
      <PageGuideBanner page="cockpit" className="mb-4" />
      <ContentHeader
        title={t('tabs.cockpit.title')}
        subtitle={t('pageHeaders.cockpitOverview')}
        meta={
          <>
            <ConnectionStatus />
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
          label={t('cockpitPage.conversations')}
          value={summary ? formatNumber(summary.volume_week) : '-'}
          icon={MessageSquare}
          to="/communication/inbox/all"
        />
        <StatCard
          label={t('cockpitPage.awaitingDecision')}
          value={summary ? formatNumber(summary.open_decisions) : '-'}
          icon={Inbox}
          to="/communication/runs/awaiting-decision"
        />
        <StatCard
          label={t('cockpitPage.autonomyRate')}
          value={summary ? `${formatNumber(summary.autonomy_rate_pct)}%` : '-'}
          icon={Gauge}
          to="/settings/govern?tab=policy"
        />
        <StatCard
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
          label={t('cockpitPage.timeSaved')}
          value={summary ? `${formatNumber(summary.time_saved_minutes_week)}m` : '-'}
          icon={Timer}
          to="/cockpit/usage"
        />
        <StatCard
          label={t('cockpitPage.csat')}
          value={summary && summary.csat_score != null ? `${formatNumber(summary.csat_score)}/5` : '-'}
          sub={
            summary && summary.csat_responses > 0
              ? t('cockpitPage.csatResponses', { count: summary.csat_responses })
              : t('cockpitPage.noRatings')
          }
          icon={Star}
          to={
            summary && summary.csat_responses > 0
              ? channelPath('webchat')
              : '/ai/assistant/external/installation'
          }
        />
        <StatCard
          label={t('cockpitPage.usage')}
          value={summary ? formatNumber(summary.tokens_month) : '-'}
          sub={summary ? formatCost(summary.cost_cents_month) : undefined}
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
              <span className="inline-flex items-center gap-1 rounded-full bg-status-warning/15 px-2 py-0.5 text-[11px] font-semibold text-status-warning">
                <AlertTriangle size={11} />
                {attentionCount}
              </span>
            ) : null}
          </div>
          <div className="mt-3 space-y-1.5">
            {attentionThreads.length === 0 && pendingChanges === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center">
                <p className="text-[12px] text-text-muted">{t('cockpitPage.nothingAttention')}</p>
                <Link
                  to={inboxPath('all')}
                  className="mt-2 inline-block text-[12px] font-medium text-accent hover:underline"
                >
                  {t('cockpitPage.openCommunication')}
                </Link>
              </div>
            ) : (
              <>
                {attentionThreads.map((thread) => (
                  <Link
                    key={String(thread.id)}
                    to={
                      thread.folder === 'internal'
                        ? agentRunsPath('awaiting-decision', String(thread.id))
                        : inboxPath('all', String(thread.id))
                    }
                    className="group flex items-center gap-2.5 rounded-lg border border-border/40 bg-bg-elevated/45 px-3 py-2 transition-colors hover:border-accent/40"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-warning" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-text-primary">
                        {thread.emailSubject || thread.contactName || t('cockpitPage.decisionNeeded')}
                      </span>
                      <span className="block truncate text-[11px] text-text-muted">
                        {thread.contactName || thread.channel || t('cockpitPage.threadFallback')}
                        {thread.lastMessageAt ? ` - ${timeAgo(thread.lastMessageAt, t)}` : ''}
                      </span>
                    </span>
                    <ArrowRight size={12} className="shrink-0 text-text-muted group-hover:text-accent" />
                  </Link>
                ))}
                {pendingChanges > 0 ? (
                  <Link
                    to="/settings/govern?tab=drafts"
                    className="group flex items-center gap-2.5 rounded-lg border border-border/40 bg-bg-elevated/45 px-3 py-2 transition-colors hover:border-accent/40"
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
            {events.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center">
                <p className="text-[12px] text-text-muted">{t('cockpitPage.noEvents')}</p>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  <Link
                    to={inboxPath('all')}
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
              events.map((ev, idx) => {
                // Deep-link an event to its thread, or to the run detail.
                const target = ev.signal_id
                  ? inboxPath('all', ev.signal_id)
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
                    <span className="block truncate text-[12.5px] font-medium text-text-primary">{item.name}</span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {new Date(item.at.endsWith('Z') ? item.at : `${item.at}Z`).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {item.agent_name ? ` - ${item.agent_name}` : ''} - {activityEventTypeLabel(item.kind, t)}
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
                <Link
                  key={contact.id}
                  to={`/contacts/${contact.id}`}
                  className="group flex items-center gap-2.5 rounded-lg border border-border/40 bg-bg-elevated/45 px-3 py-2 transition-colors hover:border-accent/40"
                >
                  <UserRound size={13} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-text-primary">
                      {contact.displayName || contact.address}
                    </span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {contact.company || contact.channel}
                      {contact.lastSeenAt ? ` - ${timeAgo(contact.lastSeenAt, t)}` : ''}
                    </span>
                  </span>
                  <ArrowRight size={12} className="shrink-0 text-text-muted group-hover:text-accent" />
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </PageContent>
  )
}
