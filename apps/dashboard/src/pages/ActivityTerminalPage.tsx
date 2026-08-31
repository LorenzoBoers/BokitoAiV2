import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronUp, Pause, Play, RefreshCw } from 'lucide-react'
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
  if (Number.isNaN(d.getTime())) return '--:--:--'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
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

const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-emerald-400',
  error: 'text-red-400',
  progress: 'text-sky-400',
  human: 'text-amber-300/90',
  muted: 'text-zinc-500',
}

/**
 * Terminal-style live activity history for the whole AI workforce.
 *
 * One chronological log of everything agents (and people) did, streamed live,
 * filterable per agent via `?agent=` — the single home for "what is my AI
 * doing", pinned at the bottom of the Communication sidebar.
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

  // Live tail from the gateway.
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
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 md:p-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-border/60 p-0.5">
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
        <input
          value={query}
          onChange={(e) => patchParams({ q: e.target.value })}
          placeholder={t('activityPage.filterPlaceholder')}
          className="h-8 w-full max-w-[240px] rounded-lg border border-border/60 bg-bg-input px-3 text-[12.5px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
        />
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

      {/* Terminal log */}
      <div
        ref={logRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/60 bg-[#0c1017] px-3 py-2 font-mono text-[12px] leading-[1.7] shadow-card"
      >
        {hasMore && entries.length > 0 ? (
          <button
            type="button"
            onClick={() => void loadOlder()}
            disabled={loadingOlder}
            className="mb-1 flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300"
          >
            <ChevronUp size={11} />
            {loadingOlder ? t('activityPage.loadingOlder') : t('activityPage.loadOlder')}
          </button>
        ) : null}
        {visible.length === 0 ? (
          <p className="py-6 text-zinc-500">
            {loading
              ? t('activityPage.loading')
              : entries.length > 0
                ? t('activityPage.emptyFiltered')
                : t('activityPage.empty')}
          </p>
        ) : (
          visible.map((entry, index) => {
            const day = activityDayBucket(entry.createdAt)
            const prevDay = index > 0 ? activityDayBucket(visible[index - 1]!.createdAt) : null
            const tone = toneFor(entry)
            const actor =
              entry.actorName ||
              (entry.agentId ? agentNames.get(entry.agentId) : null) ||
              (entry.kind === 'audit' ? t('activityPage.teamMember') : 'system')
            const message =
              activityEventMessage(entry.message, t) || activityEventTypeLabel(entry.eventType, t)
            const clickable = Boolean(entry.signalId || (entry.agentId && entry.runId))
            return (
              <div key={entry.id}>
                {day !== prevDay ? (
                  <p className="mt-2 select-none text-zinc-600">
                    ── {day === 'today'
                      ? t('activityPage.dayToday')
                      : day === 'yesterday'
                        ? t('activityPage.dayYesterday')
                        : formatAppDate(new Date(entry.createdAt), i18n.language)} ──
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => openEntry(entry)}
                  disabled={!clickable}
                  className={cn(
                    'block w-full whitespace-pre-wrap break-words text-left',
                    clickable ? 'hover:bg-white/[0.045]' : 'cursor-default',
                  )}
                >
                  <span className="text-zinc-600">{clock(entry.createdAt)} </span>
                  <span className={entry.kind === 'audit' ? 'text-amber-300/90' : 'text-violet-400'}>
                    [{actor}]
                  </span>
                  <span className={cn('ml-1', TONE_TEXT[tone])}>
                    {activityEventTypeLabel(entry.eventType, t) || entry.eventType}
                  </span>
                  {message ? <span className="ml-1 text-zinc-300">{message}</span> : null}
                  {entry.live ? <span className="ml-1 animate-pulse text-emerald-400">●</span> : null}
                </button>
              </div>
            )
          })
        )}
        {follow ? (
          <p className="select-none text-emerald-500/80">
            {'> '}
            <span className="inline-block h-[13px] w-[7px] translate-y-[2px] animate-pulse bg-emerald-500/80" />
          </p>
        ) : null}
      </div>
    </div>
  )
}
