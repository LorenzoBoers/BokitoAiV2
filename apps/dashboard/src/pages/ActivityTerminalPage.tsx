import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronUp,
  CircleDot,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  UserRound,
  Wrench,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { onGatewayEvent, type GatewayEvent } from '../lib/gateway'
import { bokitoGetCockpitActivity, type CockpitActivityEvent } from '../lib/bokito-api'
import { bokitoListChatTargets, type ChatTarget } from '../lib/signals-api'
import { activityEventMessage, activityEventTypeLabel } from '../lib/activity-labels'
import { activityDayBucket } from '../lib/activity-day'
import { agentRunsPath } from '../lib/messages-paths'
import { threadHubPath } from '../lib/message-composer'
import { agentWorkforceRunUrl } from '../lib/workforce-run-urls'
import { formatAppDate } from '../lib/app-locale'
import { cn } from '../lib/utils'
import ContentHeader from '../components/shell/ContentHeader'
import { PageContent } from '../components/layout/PageContent'
import { AiMark } from '../components/ai/AiMark'

type Entry = {
  id: string
  kind: string
  eventType: string
  message: string
  actorName: string | null
  createdAt: string
  live: boolean
  runId: string | null
  agentId: string | null
  signalId: string | null
}

const MAX_ENTRIES = 1000
const HISTORY_PAGE = 150

function fromCockpit(ev: CockpitActivityEvent, idx: number): Entry {
  return {
    id: ev.id ?? `hist-${ev.created_at}-${idx}`,
    kind: ev.kind,
    eventType: ev.event_type,
    message: ev.message || '',
    actorName: ev.actor_name ?? null,
    createdAt: ev.created_at,
    live: false,
    runId: ev.run_id ?? null,
    agentId: ev.agent_id ?? null,
    signalId: ev.signal_id ?? null,
  }
}

function fromGateway(event: GatewayEvent): Entry {
  const data = event.data
  const message =
    typeof data.message === 'string' ? data.message : typeof data.subject === 'string' ? data.subject : ''
  return {
    id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: event.event || 'event',
    eventType:
      typeof data.event_type === 'string'
        ? data.event_type
        : typeof data.status === 'string'
          ? data.status
          : event.event,
    message,
    actorName: typeof data.agent_name === 'string' ? data.agent_name : null,
    createdAt: event.ts ?? new Date().toISOString(),
    live: true,
    runId: typeof data.run_id === 'string' ? data.run_id : null,
    agentId: typeof data.agent_id === 'string' ? data.agent_id : null,
    signalId: typeof data.signal_id === 'string' ? data.signal_id : null,
  }
}

function clock(iso: string): string {
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`)
  if (Number.isNaN(d.getTime())) return '--:--'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

type Tone = 'ok' | 'error' | 'progress' | 'human' | 'muted'

function toneFor(entry: Entry): Tone {
  if (entry.kind === 'audit') return 'human'
  const key = `${entry.eventType} ${entry.message}`.toLowerCase()
  if (/fail|error|cancel/.test(key)) return 'error'
  if (/complet|done|approved|sent|result/.test(key)) return 'ok'
  if (entry.live || /start|running|tool|think/.test(key)) return 'progress'
  return 'muted'
}

const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-status-success text-status-success',
  error: 'bg-status-error text-status-error',
  progress: 'bg-sky-500 text-sky-500',
  human: 'bg-amber-500 text-amber-600',
  muted: 'bg-border text-text-muted',
}

const TONE_ICON_BG: Record<Tone, string> = {
  ok: 'bg-status-success/12 text-status-success',
  error: 'bg-status-error/12 text-status-error',
  progress: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
  human: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
  muted: 'bg-bg-hover text-text-muted',
}

function iconFor(entry: Entry, tone: Tone): ComponentType<{ size?: number; className?: string }> {
  if (entry.kind === 'audit') return UserRound
  const key = `${entry.eventType} ${entry.message}`.toLowerCase()
  if (/fail|error|cancel/.test(key)) return AlertCircle
  if (/complet|done|approved|sent|result/.test(key)) return CheckCircle2
  if (/tool|lookup|search|opzoek/.test(key)) return Wrench
  if (/think|nadenk|spark|decision/.test(key)) return Sparkles
  if (tone === 'progress' || entry.live) return Loader2
  if (entry.agentId) return Bot
  return CircleDot
}

/**
 * Workspace activity timeline — live history of agent and human work.
 * Full page (not nested in the Communication hub), same chrome as Contacts.
 */
export default function ActivityTerminalPage() {
  const { t, i18n } = useTranslation('nav')
  const { token } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const agentFilter = searchParams.get('agent')
  const query = searchParams.get('q') ?? ''

  const [entries, setEntries] = useState<Entry[]>([])
  const [agents, setAgents] = useState<ChatTarget[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [follow, setFollow] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)

  const patchParams = useCallback(
    (patch: { agent?: string | null; q?: string }) => {
      const next = new URLSearchParams(searchParams)
      if (patch.agent !== undefined) {
        if (patch.agent) next.set('agent', patch.agent)
        else next.delete('agent')
      }
      if (patch.q !== undefined) {
        if (patch.q) next.set('q', patch.q)
        else next.delete('q')
      }
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setLoadError('')
    try {
      const rows = await bokitoGetCockpitActivity(token, HISTORY_PAGE)
      setEntries(rows.map(fromCockpit).reverse())
      setHasMore(rows.length >= HISTORY_PAGE)
    } catch {
      setEntries([])
      setLoadError(t('activityPage.loadError'))
    } finally {
      setLoading(false)
    }
  }, [token, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void bokitoListChatTargets(token)
      .then((data) => {
        if (!cancelled) setAgents(data.items.filter((item) => item.kind === 'company'))
      })
      .catch(() => {
        if (!cancelled) setAgents([])
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const loadOlder = useCallback(async () => {
    if (!token || loadingOlder || !hasMore) return
    const oldest = entries.find((e) => !e.live)
    if (!oldest) return
    setLoadingOlder(true)
    try {
      const rows = await bokitoGetCockpitActivity(token, HISTORY_PAGE, oldest.createdAt)
      if (rows.length < HISTORY_PAGE) setHasMore(false)
      if (rows.length) {
        const older = rows.map(fromCockpit).reverse()
        setEntries((prev) => {
          const seen = new Set(prev.map((e) => e.id))
          return [...older.filter((e) => !seen.has(e.id)), ...prev]
        })
      }
    } catch {
      setHasMore(false)
    } finally {
      setLoadingOlder(false)
    }
  }, [token, loadingOlder, hasMore, entries])

  useEffect(() => {
    if (!token) return
    const push = (event: GatewayEvent) => {
      setEntries((prev) => {
        const next = [...prev, fromGateway(event)]
        return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next
      })
    }
    const unsubs = [onGatewayEvent('runs', push), onGatewayEvent('decisions', push)]
    return () => unsubs.forEach((u) => u())
  }, [token])

  useEffect(() => {
    if (!follow) return
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries, follow, agentFilter, query])

  const agentNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const agent of agents) map.set(agent.id, agent.name)
    return map
  }, [agents])

  const visible = useMemo(() => {
    let rows = entries
    if (agentFilter) rows = rows.filter((e) => e.agentId === agentFilter)
    const q = query.trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (e) =>
          e.message.toLowerCase().includes(q) ||
          e.eventType.toLowerCase().includes(q) ||
          (e.actorName ?? '').toLowerCase().includes(q),
      )
    }
    return rows
  }, [entries, agentFilter, query])

  const openEntry = useCallback(
    (entry: Entry) => {
      if (entry.signalId) {
        navigate(
          entry.kind === 'audit'
            ? threadHubPath({ id: entry.signalId, channel: 'email' })
            : agentRunsPath('all', entry.signalId),
        )
        return
      }
      if (entry.agentId && entry.runId) navigate(agentWorkforceRunUrl(entry.agentId, entry.runId))
    },
    [navigate],
  )

  return (
    <div ref={logRef} className="h-full min-h-0 overflow-y-auto">
      <PageContent width="lg" className="space-y-4 pb-8">
        <ContentHeader
          title={t('support.activity.label')}
          subtitle={t('support.activity.hint')}
          meta={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setFollow((v) => !v)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                  follow
                    ? 'border-accent/45 bg-accent/10 text-accent'
                    : 'border-border/60 text-text-secondary hover:bg-bg-hover/60',
                )}
              >
                {follow ? <Pause size={12} /> : <Play size={12} />}
                {t('activityPage.autoFollow')}
              </button>
              <button
                type="button"
                onClick={() => void load()}
                className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
              >
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                {t('activityPage.refresh')}
              </button>
            </div>
          }
        />

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-border/60 bg-bg-surface p-0.5">
              <button
                type="button"
                onClick={() => patchParams({ agent: null })}
                className={cn(
                  'shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                  !agentFilter ? 'bg-accent/12 text-accent' : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {t('activityPage.allAgents')}
              </button>
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => patchParams({ agent: agentFilter === agent.id ? null : agent.id })}
                  className={cn(
                    'shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                    agentFilter === agent.id
                      ? 'bg-ai/15 text-ai-ink'
                      : 'text-text-secondary hover:text-text-primary',
                  )}
                >
                  {agent.name}
                </button>
              ))}
            </div>
            <div className="relative min-w-[200px] max-w-[280px] flex-1">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
              />
              <input
                value={query}
                onChange={(e) => patchParams({ q: e.target.value })}
                placeholder={t('activityPage.filterPlaceholder')}
                className="h-8 w-full rounded-lg border border-border/60 bg-bg-input pl-8 pr-3 text-[12.5px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
              />
            </div>
            <span className="ml-auto text-[11px] text-text-muted">
              {t('activityPage.events', { count: visible.length })}
            </span>
          </div>

          {loadError ? (
            <div className="flex items-center justify-between rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-[12.5px] text-status-error">
              <span>{loadError}</span>
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-md border border-status-error/40 px-2 py-0.5 text-[11.5px] font-medium hover:bg-status-error/15"
              >
                {t('activityPage.retry')}
              </button>
            </div>
          ) : null}

          <div className="min-h-[420px] rounded-xl border border-border/50 bg-bg-surface/80 px-3 py-4 shadow-sm md:px-5">
            {hasMore && entries.length > 0 ? (
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="mb-4 flex items-center gap-1.5 text-[12px] font-medium text-text-muted transition-colors hover:text-text-primary"
              >
                <ChevronUp size={13} />
                {loadingOlder ? t('activityPage.loadingOlder') : t('activityPage.loadOlder')}
              </button>
            ) : null}

            {visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-bg-hover text-text-muted">
                  <AiMark size={18} />
                </div>
                <p className="text-[13px] text-text-secondary">
                  {loading
                    ? t('activityPage.loading')
                    : entries.length > 0
                      ? t('activityPage.emptyFiltered')
                      : t('activityPage.empty')}
                </p>
              </div>
            ) : (
              <ol className="relative m-0 list-none p-0">
                {visible.map((entry, index) => {
                  const day = activityDayBucket(entry.createdAt)
                  const prevDay = index > 0 ? activityDayBucket(visible[index - 1]!.createdAt) : null
                  const tone = toneFor(entry)
                  const Icon = iconFor(entry, tone)
                  const actor =
                    entry.actorName ||
                    (entry.agentId ? agentNames.get(entry.agentId) : null) ||
                    (entry.kind === 'audit' ? t('activityPage.teamMember') : t('activityPage.system'))
                  const message =
                    activityEventMessage(entry.message, t) ||
                    activityEventTypeLabel(entry.eventType, t)
                  const label = activityEventTypeLabel(entry.eventType, t) || entry.eventType
                  const clickable = Boolean(entry.signalId || (entry.agentId && entry.runId))
                  const isLast = index === visible.length - 1

                  return (
                    <li key={entry.id} className="relative">
                      {day !== prevDay ? (
                        <div className="sticky top-0 z-10 mb-3 mt-1 flex justify-center first:mt-0">
                          <span className="rounded-full border border-border/50 bg-bg-elevated px-3 py-0.5 text-[11px] font-medium text-text-secondary shadow-sm">
                            {day === 'today'
                              ? t('activityPage.dayToday')
                              : day === 'yesterday'
                                ? t('activityPage.dayYesterday')
                                : formatAppDate(new Date(entry.createdAt), i18n.language)}
                          </span>
                        </div>
                      ) : null}

                      <div className="flex gap-3">
                        <div className="relative flex w-9 shrink-0 flex-col items-center">
                          {!isLast ? (
                            <span
                              aria-hidden
                              className="absolute top-9 bottom-0 w-px bg-border/70"
                            />
                          ) : null}
                          <span
                            className={cn(
                              'relative z-[1] flex h-8 w-8 items-center justify-center rounded-full border border-border/40',
                              TONE_ICON_BG[tone],
                            )}
                          >
                            <Icon
                              size={14}
                              className={entry.live && tone === 'progress' ? 'animate-spin' : undefined}
                            />
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => openEntry(entry)}
                          disabled={!clickable}
                          className={cn(
                            'mb-3 min-w-0 flex-1 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors',
                            clickable
                              ? 'hover:border-border/60 hover:bg-bg-hover/50'
                              : 'cursor-default',
                          )}
                        >
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="text-[11px] tabular-nums text-text-muted">
                              {clock(entry.createdAt)}
                            </span>
                            <span className="text-[12.5px] font-medium text-text-primary">{actor}</span>
                            {entry.live ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-status-success">
                                <span className={cn('h-1.5 w-1.5 rounded-full', TONE_DOT[tone].split(' ')[0])} />
                                {t('activityPage.live')}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-[12.5px] font-medium text-text-secondary">{label}</p>
                          {message && message !== label ? (
                            <p className="mt-0.5 line-clamp-2 text-[12.5px] text-text-muted">{message}</p>
                          ) : null}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
      </PageContent>
    </div>
  )
}
