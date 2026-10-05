import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronUp, Pause, Play, RefreshCw, Search } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useActivityFeed } from '../hooks/useActivityFeed'
import { bokitoListChatTargets, type ChatTarget } from '../lib/signals-api'
import { cn } from '../lib/utils'
import ContentHeader from '../components/shell/ContentHeader'
import { PageContent } from '../components/layout/PageContent'
import { AiMark } from '../components/ai/AiMark'
import { ActivityFeed } from '../components/activity/ActivityFeed'

/**
 * Workspace activity timeline — live history of agent and human work.
 * Full page (not nested in the Communication hub), same chrome as Contacts.
 */
export default function ActivityTerminalPage() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const agentFilter = searchParams.get('agent')
  const query = searchParams.get('q') ?? ''

  const { entries, loading, loadingOlder, hasMore, failed, load, loadOlder } = useActivityFeed()
  const [agents, setAgents] = useState<ChatTarget[]>([])
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
                  'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                  follow
                    ? 'border-border-light bg-bg-hover text-text-heading'
                    : 'border-border/60 text-text-secondary hover:bg-bg-hover/60',
                )}
              >
                {follow ? <Pause size={12} /> : <Play size={12} />}
                {t('activityPage.autoFollow')}
              </button>
              <button
                type="button"
                onClick={() => void load()}
                className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
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
                  'shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
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
                    'shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
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
                className="h-8 w-full rounded-lg border border-border/60 bg-bg-input pl-8 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
              />
            </div>
            <span className="ml-auto text-xs text-text-muted">
              {t('activityPage.events', { count: visible.length })}
            </span>
          </div>

          {failed ? (
            <div className="flex items-center justify-between rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error">
              <span>{t('activityPage.loadError')}</span>
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-md border border-status-error/40 px-2 py-0.5 text-xs font-medium hover:bg-status-error/15"
              >
                {t('activityPage.retry')}
              </button>
            </div>
          ) : null}

          <div className="min-h-[420px] rounded-lg border border-border/50 bg-bg-surface/80 px-3 py-4 md:px-5">
            {hasMore && entries.length > 0 ? (
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="mb-4 flex items-center gap-1.5 text-xs font-medium text-text-muted transition-colors hover:text-text-primary"
              >
                <ChevronUp size={13} />
                {loadingOlder ? t('activityPage.loadingOlder') : t('activityPage.loadOlder')}
              </button>
            ) : null}

            <ActivityFeed
              entries={visible}
              agentNames={agentNames}
              empty={
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-bg-hover text-text-muted">
                    <AiMark size={18} />
                  </div>
                  <p className="text-sm text-text-secondary">
                    {loading
                      ? t('activityPage.loading')
                      : entries.length > 0
                        ? t('activityPage.emptyFiltered')
                        : t('activityPage.empty')}
                  </p>
                </div>
              }
            />
          </div>
      </PageContent>
    </div>
  )
}
