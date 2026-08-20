import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
import { OnboardingCompactCard } from '../components/onboarding/OnboardingChecklist'
import { PageContent } from '../components/layout/PageContent'
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
import { agentRunsPath, inboxPath } from '../lib/messages-paths'
import { listContacts, type ContactRow } from '../lib/contacts-api'
import { humanizeLabel } from '../lib/labels'
import { listAgendaOccurrences, type AgendaItem } from '../lib/orchestration-api'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'

const POSTURE_LABELS: Record<AutonomyPostureId, string> = {
  manual: 'Manual',
  assisted: 'Assisted',
  autonomous: 'Autonomous',
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)
}

function formatCost(cents: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

function timeAgo(iso: string): string {
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
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
      .catch((err) => setError(formatApiErrorMessage(err, 'Could not load overview.')))
      .finally(() => setLoading(false))
  }, [token])

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
      <ContentHeader
        title="Cockpit"
        subtitle="Workspace health at a glance"
        meta={
          <>
            <ConnectionStatus />
            <button
              type="button"
              onClick={load}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </>
        }
      />

      <CockpitTabs />

      <OnboardingCompactCard />

      {error ? <ApiErrorBanner message={error} onRetry={load} /> : null}
      {!error && partialFailures.length > 0 ? (
        <ApiErrorBanner
          message={`Some overview data failed to load: ${partialFailures.join(', ')}.`}
          onRetry={load}
        />
      ) : null}

      {/* Snapshot */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        <StatCard
          label="Conversations 7d"
          value={summary ? formatNumber(summary.volume_week) : '-'}
          icon={MessageSquare}
          to="/communication/inbox/mine"
        />
        <StatCard
          label="Awaiting decision"
          value={summary ? formatNumber(summary.open_decisions) : '-'}
          icon={Inbox}
          to="/communication/runs/awaiting-decision"
        />
        <StatCard
          label="Autonomy rate"
          value={summary ? `${formatNumber(summary.autonomy_rate_pct)}%` : '-'}
          icon={Gauge}
          to="/settings/autonomy"
        />
        <StatCard
          label="Posture"
          value={posture ? POSTURE_LABELS[posture] : '-'}
          icon={ShieldCheck}
          to="/settings/autonomy"
        />
        <StatCard
          label="Time saved 7d"
          value={summary ? `${formatNumber(summary.time_saved_minutes_week)}m` : '-'}
          icon={Timer}
          to="/agenda"
        />
        <StatCard
          label="CSAT 30d"
          value={summary && summary.csat_score != null ? `${formatNumber(summary.csat_score)}/5` : '-'}
          sub={
            summary && summary.csat_responses > 0
              ? `${formatNumber(summary.csat_responses)} response${summary.csat_responses === 1 ? '' : 's'}`
              : 'No ratings yet'
          }
          icon={Star}
        />
        <StatCard
          label="Usage 30d"
          value={summary ? formatNumber(summary.tokens_month) : '-'}
          sub={summary ? formatCost(summary.cost_cents_month) : undefined}
          icon={Sparkles}
          to="/cockpit/usage"
        />
      </div>

      {/* Attention + event log */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[14px] font-semibold text-text-heading">Needs attention</h2>
              <p className="text-[12px] text-text-muted">Decisions and drafts waiting on a human</p>
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
              <p className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-[12px] text-text-muted">
                Nothing needs your attention right now.
              </p>
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
                        {thread.emailSubject || thread.contactName || 'Decision needed'}
                      </span>
                      <span className="block truncate text-[11px] text-text-muted">
                        {thread.contactName || thread.channel || 'thread'}
                        {thread.lastMessageAt ? ` - ${timeAgo(thread.lastMessageAt)}` : ''}
                      </span>
                    </span>
                    <ArrowRight size={12} className="shrink-0 text-text-muted group-hover:text-accent" />
                  </Link>
                ))}
                {pendingChanges > 0 ? (
                  <Link
                    to="/settings/autonomy"
                    className="group flex items-center gap-2.5 rounded-lg border border-border/40 bg-bg-elevated/45 px-3 py-2 transition-colors hover:border-accent/40"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium text-text-primary">
                        {pendingChanges} platform change{pendingChanges === 1 ? '' : 's'} awaiting review
                      </span>
                      <span className="block text-[11px] text-text-muted">Review drafts in Autonomy settings</span>
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
              <h2 className="text-[14px] font-semibold text-text-heading">Recent events</h2>
              <p className="text-[12px] text-text-muted">Latest agent runs and workstream steps</p>
            </div>
            <Link to="/cockpit/activity" className="text-[12px] font-medium text-accent hover:underline">
              Open Activity
            </Link>
          </div>
          <div className="mt-3 max-h-[340px] space-y-px overflow-y-auto">
            {events.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-[12px] text-text-muted">
                No recent events. Agent runs will show up here.
              </p>
            ) : (
              events.map((ev, idx) => (
                <div key={`${ev.created_at}-${idx}`} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5">
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
                      {ev.message || humanizeLabel(ev.event_type)}
                    </span>
                    <span className="block text-[10px] text-text-muted">
                      {humanizeLabel(ev.kind)} - {humanizeLabel(ev.event_type)} - {timeAgo(ev.created_at)}
                    </span>
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Agenda + contacts */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[14px] font-semibold text-text-heading">Today on the agenda</h2>
              <p className="text-[12px] text-text-muted">Upcoming agent wakes, tasks and events</p>
            </div>
            <Link to="/agenda" className="text-[12px] font-medium text-accent hover:underline">
              Open Agenda
            </Link>
          </div>
          <div className="mt-3 space-y-1.5">
            {agendaItems.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-[12px] text-text-muted">
                Nothing scheduled for the next 24 hours.
              </p>
            ) : (
              agendaItems.map((item) => (
                <Link
                  key={item.id}
                  to="/agenda"
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
                      {item.agent_name ? ` - ${item.agent_name}` : ''} - {humanizeLabel(item.kind)}
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
              <h2 className="text-[14px] font-semibold text-text-heading">Recent contacts</h2>
              <p className="text-[12px] text-text-muted">People recently active across your channels</p>
            </div>
            <Link to="/contacts" className="text-[12px] font-medium text-accent hover:underline">
              Open Contacts
            </Link>
          </div>
          <div className="mt-3 space-y-1.5">
            {recentContacts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-[12px] text-text-muted">
                No contacts yet. They appear when customers message you.
              </p>
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
                      {contact.lastSeenAt ? ` - ${timeAgo(contact.lastSeenAt)}` : ''}
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
