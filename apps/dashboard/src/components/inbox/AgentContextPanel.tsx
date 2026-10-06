import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { AgentPassport } from '../../lib/workforce-api'
import { agentStatusOf } from '../../lib/presence'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  Activity,
  Blocks,
  ChevronDown,
  ChevronRight,
  Cpu,
  Loader2,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { listSignalThreads } from '../../lib/signals-api'
import { getAllowances, listAgentPassports } from '../../lib/govern-api'
import { BrandMark } from '../integrations/BrandMark'
import {
  listIntegrationConnections,
  listIntegrationProviders,
  type IntegrationConnectionRow,
  type IntegrationModuleRow,
} from '../../lib/integrations-api'
import { moduleHomePath, moduleIsOn, moduleNavIcon } from '../../lib/integration-modules'
import type { GovernToolRow } from '../../lib/govern-api'
import type { InboxThread } from '../../lib/inbox-api'
import type { RuntimeAgent } from '../../lib/workforce-api'
import { threadStatusLabel } from '../../lib/status-labels'
import { toAiAvatarProps } from '../../lib/agent-avatar'
import { formatAgentModelLine } from '../../lib/model-label'
import { agentChatPath } from '../../lib/messages-paths'
import { withNavReveal } from '../../lib/nav-reveal'
import { openEntityPath } from '../../lib/open-entity'
import { threadHubPath } from '../../lib/message-composer'
import { translateDecisionText } from '../../lib/activity-labels'
import { AiAvatar } from '../ui/AiAvatar'
import { ThreadStatusDot } from '../ui/ThreadStatusDot'
import { ConversationWorkSection } from './ConversationWorkSection'
import { AgentActiveLine } from './IdentitySeenLine'
import { timeAgo } from '../../lib/time-ago'
import { useAgentLive, withAgentLive } from '../../hooks/useAgentPresence'

const COUNT_CAP = 999

function formatCappedCount(n: number): string {
  return n > COUNT_CAP ? `${COUNT_CAP}+` : String(n)
}

type Props = {
  thread: InboxThread
  agent: RuntimeAgent | null
  onThreadUpdated?: () => void
  closeAction?: ReactNode
}

function SectionHeading({ title }: { title: string }) {
  return (
    <h3 className="mb-2 text-xs font-semibold text-text-muted">{title}</h3>
  )
}

function DisclosureRow({
  summary,
  children,
}: {
  summary: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left text-xs text-text-secondary hover:text-text-primary"
      >
        <Blocks size={12} className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate-fade">{summary}</span>
        {open ? (
          <ChevronDown size={11} className="shrink-0 text-text-muted" />
        ) : (
          <ChevronRight size={11} className="shrink-0 text-text-muted" />
        )}
      </button>
      {open ? <div className="pb-1.5 pt-1">{children}</div> : null}
    </div>
  )
}

export default function AgentContextPanel({ thread, agent, onThreadUpdated, closeAction }: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [passport, setPassport] = useState<AgentPassport | null>(null)
  const [toolCatalog, setToolCatalog] = useState<GovernToolRow[]>([])
  const [modules, setModules] = useState<IntegrationModuleRow[]>([])
  const [connections, setConnections] = useState<IntegrationConnectionRow[]>([])
  const [providerSlugById, setProviderSlugById] = useState<Record<string, string>>({})
  const [recent, setRecent] = useState<InboxThread[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  const agentId = agent?.id && agent.id !== 'unknown' ? agent.id : null

  const load = useCallback(async () => {
    setLoading(true)
    // Individual sections degrade to empty on failure, but surface that a
    // failure happened so an empty panel is distinguishable from "no data".
    let failed = false
    const fallback = <T,>(value: T) => {
      failed = true
      return value
    }
    const [passports, allowances, catalog, connectionRows, threads] = await Promise.all([
      listAgentPassports()
        .then((r) => r.items)
        .catch(() => fallback([] as AgentPassport[])),
      getAllowances()
        .then((r) => r.tools)
        .catch(() => fallback([] as GovernToolRow[])),
      listIntegrationProviders().catch(() =>
        fallback({
          providers: [],
          modules: [],
          connection_counts: { by_provider_id: {}, email_outlook: 0, email_gmail: 0 },
        }),
      ),
      listIntegrationConnections().catch(() => fallback([] as IntegrationConnectionRow[])),
      agentId
        ? listSignalThreads(token ?? '', { agentId, perPage: 8 })
            .then((r) => r.items)
            .catch(() => fallback([] as InboxThread[]))
        : Promise.resolve([] as InboxThread[]),
    ])
    setPassport(agentId ? (passports.find((p) => p.id === agentId) ?? null) : null)
    setToolCatalog(allowances)
    setModules(
      (catalog.modules ?? []).filter((module) => module.status !== 'coming_soon' && moduleIsOn(module)),
    )
    setConnections(connectionRows.filter((row) => row.status !== 'revoked'))
    const slugs: Record<string, string> = {}
    for (const provider of catalog.providers ?? []) {
      if (provider.id) slugs[provider.id] = provider.slug
    }
    setProviderSlugById(slugs)
    setRecent(threads.filter((t) => String(t.id) !== String(thread.id)))
    setLoadFailed(failed)
    setLoading(false)
  }, [agentId, token, thread.id])

  useEffect(() => {
    void load()
  }, [load])

  const allowedTools = passport?.tools ?? []
  const unrestricted = allowedTools.length === 0
  const toolCount = unrestricted ? toolCatalog.length : allowedTools.length
  const moduleCount = modules.length
  const connectionCount = connections.length
  const stackSummary = [
    t('agentContext.moduleCount', { count: moduleCount, formatted: formatCappedCount(moduleCount) }),
    t('agentContext.connectionCount', {
      count: connectionCount,
      formatted: formatCappedCount(connectionCount),
    }),
    t('agentContext.toolCount', { count: toolCount, formatted: formatCappedCount(toolCount) }),
  ].join(' | ')

  const model = agent?.model ?? null
  const provider = agent?.provider ?? null
  const live = useAgentLive(agentId)
  const view = agent ? withAgentLive(agent) : null
  const workState = view ? agentStatusOf(view) : 'standby'
  const presence = live?.status ?? (workState === 'working' ? 'working' : workState === 'error' ? 'error' : 'standby')
  const corner = view ? agentStatusOf(view) : undefined
  const workHref =
    agentId && presence === 'working' ? openEntityPath({ type: 'agent', id: agentId, live }) : agentId ? openEntityPath({ type: 'agent', id: agentId }) : null
  const summary = view?.current_activity_summary || live?.summary || null

  return (
    <div className="flex flex-col">
      <div className="border-b border-border/40 px-4 pb-3 pt-3">
        <div className="flex items-start gap-2.5">
          {view && agentId && workHref ? (
            <Link to={workHref} className="shrink-0 rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/50">
              <AiAvatar
                {...toAiAvatarProps(view, t('agentContext.workspaceAssistant'))}
                size={36}
                decorative
                activity={corner}
              />
            </Link>
          ) : (
            <AiAvatar
              {...toAiAvatarProps(view ?? agent, t('agentContext.workspaceAssistant'))}
              size={36}
              decorative
            />
          )}
          <div className="min-w-0 flex-1">
            {view && agentId && workHref ? (
              <Link
                to={workHref}
                className="block truncate-fade text-base font-semibold text-text-heading hover:text-accent"
              >
                {view.name}
              </Link>
            ) : (
              <p className="truncate-fade text-base font-semibold text-text-heading">
                {view?.name || agent?.name || t('agentContext.workspaceAssistant')}
              </p>
            )}
            <p className="mt-0.5 text-xs text-text-secondary">{t('agentContext.kindAiAgent')}</p>
            <AgentActiveLine at={view?.last_active_at ?? agent?.last_active_at} working={presence === 'working'} />
            {summary ? (
              workHref && presence === 'working' ? (
                <Link
                  to={workHref}
                  className="mt-1.5 flex items-start gap-1.5 text-xs text-text-secondary hover:text-text-heading"
                >
                  <Activity size={11} className="mt-0.5 shrink-0 text-text-muted" />
                  <span className="line-clamp-3">{summary}</span>
                </Link>
              ) : (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-text-secondary">
                <Activity size={11} className="mt-0.5 shrink-0 text-text-muted" />
                <span className="line-clamp-3">{summary}</span>
              </p>
              )
            ) : null}
          </div>
          {closeAction}
        </div>
        {model ? (
          <Link
            to="/settings/models"
            className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary"
          >
            <Cpu size={12} className="shrink-0 text-text-muted" />
            <span className="min-w-0 truncate-fade">{formatAgentModelLine(model, provider, t)}</span>
          </Link>
        ) : null}
        <div className="mt-2">
          <DisclosureRow summary={stackSummary}>
            {modules.length > 0 || connections.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[18px]">
                {modules.map((module) => {
                  const Icon = moduleNavIcon(module.slug)
                  return (
                    <Link
                      key={module.slug}
                      to={moduleHomePath(module)}
                      className="inline-flex max-w-full items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary"
                    >
                      <Icon size={12} className="shrink-0 text-text-muted" aria-hidden />
                      <span className="min-w-0 truncate-fade">{module.name}</span>
                    </Link>
                  )
                })}
                {connections.map((row) => (
                  <Link
                    key={row.id}
                    to="/connections"
                    className="inline-flex max-w-full items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary"
                  >
                    <BrandMark
                      slug={row.provider || providerSlugById[row.provider_id] || row.provider_id}
                      size={14}
                    />
                    <span className="min-w-0 truncate-fade">{row.display_name}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="pl-[18px] text-xs text-text-muted">{t('agentContext.noModulesOrConnections')}</p>
            )}
            {agentId ? (
              <Link
                to={`/agents/${agentId}`}
                className="mt-1 inline-flex pl-[18px] text-xs text-text-muted hover:text-text-primary"
              >
                {t('agentContext.openAgent')}
              </Link>
            ) : null}
          </DisclosureRow>
        </div>
      </div>

      {loadFailed && !loading ? (
        <div className="mx-4 mt-3 flex items-center justify-between gap-2 rounded-lg border border-status-warning/40 bg-status-warning/5 px-3 py-2">
          <span className="text-xs text-text-secondary">{t('agentContext.loadFailed')}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="shrink-0 text-xs font-medium text-accent hover:underline"
          >
            {t('agentContext.retry')}
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('agentContext.loading')}
        </div>
      ) : null}

      <ConversationWorkSection thread={thread} />

      {/* Recent conversations */}
      <div className="px-4 py-3">
        <SectionHeading title={t('agentContext.recentConversations')} />
        {recent.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 px-3 py-3">
            <p className="text-xs text-text-muted">{t('agentContext.noOtherConversations')}</p>
            {agent?.id ? (
              <Link
                to={withNavReveal(agentChatPath(agent.id))}
                className="mt-1.5 inline-block text-xs font-medium text-accent hover:underline"
              >
                {t('agentContext.chatWithAgent')}
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1">
            {recent.slice(0, 5).map((thread) => (
              <Link
                key={String(thread.id)}
                to={threadHubPath(thread)}
                className="flex items-center gap-2 rounded-md border border-transparent px-2.5 py-1.5 transition-colors hover:bg-bg-hover/70"
              >
                <ThreadStatusDot status={thread.status} unread={thread.hasUnread} title={threadStatusLabel(thread.status, t)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate-fade text-xs font-medium text-text-primary">
                    {translateDecisionText(thread.emailSubject, t) || t('listItem.noSubject')}
                  </span>
                  <span className="block truncate-fade text-2xs text-text-muted">
                    {threadStatusLabel(thread.status, t)}
                    {thread.lastMessageAt ? ` - ${timeAgo(thread.lastMessageAt, t)}` : ''}
                  </span>
                </span>
              </Link>
            ))}
            {recent.length > 5 && agentId ? (
              <Link
                to={`/agents/${agentId}#conversations`}
                className="mt-1 block px-2.5 py-1 text-xs font-medium text-accent hover:underline"
              >
                {t('agentContext.showMore')}
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
