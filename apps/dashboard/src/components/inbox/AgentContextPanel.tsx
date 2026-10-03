import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Cpu,
  Loader2,
  Plug,
  Settings,
  Wrench,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { listSignalThreads } from '../../lib/signals-api'
import { getAllowances, listAgentPassports } from '../../lib/govern-api'
import { listMcpIntegrationRows, type McpIntegrationRow } from '../../lib/mcp-integrations'
import { listAgentTasks, type AgentTask } from '../../lib/orchestration-api'
import type { GovernToolRow } from '../../lib/govern-api'
import type { InboxThread } from '../../lib/inbox-api'
import type { RuntimeAgent } from '../../lib/workforce-api'
import { agentRuntimeStatusLabel, threadStatusLabel, workLogStatusLabel } from '../../lib/status-labels'
import { humanizeLabel } from '../../lib/labels'
import { formatAgentModelLine } from '../../lib/model-label'
import { agentChatPath, inboxPath } from '../../lib/messages-paths'
import { threadHubPath } from '../../lib/message-composer'
import { translateDecisionText } from '../../lib/activity-labels'
import { permissionScopeLabel } from '../../lib/permission-scope-label'
import { AiAvatar } from '../ui/AiAvatar'
import { ThreadStatusDot } from '../ui/ThreadStatusDot'
import { ConversationWorkSection } from './ConversationWorkSection'
import { IdentitySeenLine, timeAgo } from './IdentitySeenLine'

type Props = {
  thread: InboxThread
  agent: RuntimeAgent | null
  onThreadUpdated?: () => void
  closeAction?: ReactNode
}

type AgentPassport = {
  id: string
  name: string
  role: string
  autonomy_level: string | number | null
  allowed_tools: string[]
  permission_scopes: string[]
  is_active: boolean
  runtime_status: string | null
}

/** Task statuses worth surfacing inline (still in flight or needs a human). */
const ACTIVE_TASK_STATUSES = new Set([
  'running',
  'queued',
  'paused',
  'awaiting_human',
  'analyzing',
  'planned',
  'verifying',
])

function SectionHeading({ title }: { title: string }) {
  return (
    <h3 className="mb-2 text-xs font-semibold text-text-muted">{title}</h3>
  )
}

function DisclosureRow({
  label,
  count,
  countLabel,
  children,
}: {
  label: string
  count: number
  /** Optional text shown instead of the numeric badge (e.g. "Unrestricted"). */
  countLabel?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const empty = count === 0 && !countLabel
  return (
    <div>
      <button
        type="button"
        disabled={empty}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-7 w-full items-center justify-between gap-3 text-left disabled:cursor-default disabled:opacity-50"
      >
        <span className="shrink-0 text-xs text-text-muted">{label}</span>
        <span className="flex min-w-0 items-center gap-1 text-xs text-text-heading">
          <span className="truncate-fade">{countLabel ?? count}</span>
          {!empty ? (
            open ? (
              <ChevronDown size={11} className="shrink-0 text-text-muted" />
            ) : (
              <ChevronRight size={11} className="shrink-0 text-text-muted" />
            )
          ) : null}
        </span>
      </button>
      {open && !empty ? <div className="pb-1.5 pt-1">{children}</div> : null}
    </div>
  )
}

export default function AgentContextPanel({ thread, agent, onThreadUpdated, closeAction }: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [passport, setPassport] = useState<AgentPassport | null>(null)
  const [toolCatalog, setToolCatalog] = useState<GovernToolRow[]>([])
  const [mcpRows, setMcpRows] = useState<McpIntegrationRow[]>([])
  const [recent, setRecent] = useState<InboxThread[]>([])
  const [task, setTask] = useState<AgentTask | null>(null)
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
    const [passports, allowances, mcp, threads, tasks] = await Promise.all([
      listAgentPassports()
        .then((r) => r.items as AgentPassport[])
        .catch(() => fallback([] as AgentPassport[])),
      getAllowances()
        .then((r) => r.tools)
        .catch(() => fallback([] as GovernToolRow[])),
      listMcpIntegrationRows().catch(() => fallback([] as McpIntegrationRow[])),
      agentId
        ? listSignalThreads(token ?? '', { agentId, perPage: 8 })
            .then((r) => r.items)
            .catch(() => fallback([] as InboxThread[]))
        : Promise.resolve([] as InboxThread[]),
      listAgentTasks({ signalId: String(thread.id) }).catch(() => fallback([] as AgentTask[])),
    ])
    setPassport(agentId ? (passports.find((p) => p.id === agentId) ?? null) : null)
    setToolCatalog(allowances)
    setMcpRows(mcp)
    setRecent(threads.filter((t) => String(t.id) !== String(thread.id)))
    setTask(tasks.find((t) => ACTIVE_TASK_STATUSES.has(t.status)) ?? null)
    setLoadFailed(failed)
    setLoading(false)
  }, [agentId, token, thread.id])

  useEffect(() => {
    void load()
  }, [load])

  const allowedTools = passport?.allowed_tools ?? []
  const unrestricted = allowedTools.length === 0
  const toolCount = unrestricted ? toolCatalog.length : allowedTools.length
  const scopes = passport?.permission_scopes ?? []

  const toolDescription = useMemo(() => {
    const map = new Map<string, GovernToolRow>()
    for (const t of toolCatalog) map.set(t.name, t)
    return map
  }, [toolCatalog])

  const model = agent?.model ?? null
  const provider = agent?.provider ?? null
  const status = agent?.status ?? passport?.runtime_status ?? null

  return (
    <div className="flex flex-col">
      <div className="border-b border-border/40 px-4 pb-3 pt-3">
        <div className="flex items-start gap-2.5">
          {agent && agentId ? (
            <Link to={`/agents/${agentId}`} className="shrink-0 rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/50">
              <AiAvatar
                name={agent.name}
                seed={agentId}
                size={36}
                kind={agent.avatar_kind}
                icon={agent.avatar_icon}
                imageUrl={agent.avatar_image_url}
                decorative
              />
            </Link>
          ) : (
            <AiAvatar
              name={agent?.name || t('agentContext.workspaceAssistant')}
              seed={agentId ?? 'assistant'}
              size={36}
              decorative
            />
          )}
          <div className="min-w-0 flex-1">
            {agent && agentId ? (
              <Link
                to={`/agents/${agentId}`}
                className="block truncate-fade text-base font-semibold text-text-heading hover:text-accent"
              >
                {agent.name}
              </Link>
            ) : (
              <p className="truncate-fade text-base font-semibold text-text-heading">
                {agent?.name || t('agentContext.workspaceAssistant')}
              </p>
            )}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-2xs font-semibold text-ai-ink">{t('agentContext.kindAiAgent')}</span>
              {status ? (
                <span className="text-xs text-text-muted">{agentRuntimeStatusLabel(status, t)}</span>
              ) : null}
            </div>
            <IdentitySeenLine at={agent?.updated_at || thread.lastMessageAt} />
            {agent?.current_activity_summary ? (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-text-secondary">
                <Activity size={11} className="mt-0.5 shrink-0 text-text-muted" />
                <span className="line-clamp-3">{agent.current_activity_summary}</span>
              </p>
            ) : null}
          </div>
          {closeAction}
        </div>
        {model ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary">
            <Cpu size={12} className="shrink-0 text-text-muted" />
            <span className="min-w-0 truncate-fade">{formatAgentModelLine(model, provider, t)}</span>
          </p>
        ) : null}
        <div className="mt-2 space-y-0.5">
          <DisclosureRow
            label={t('agentContext.toolsAndIntegrations')}
            count={toolCount + mcpRows.length}
            countLabel={unrestricted ? t('agentContext.unrestricted') : undefined}
          >
            {mcpRows.length > 0 ? (
              <div className="mb-2">
                <p className="mb-1 flex items-center gap-1 text-2xs font-semibold text-text-muted">
                  <Plug size={10} />
                  {t('agentContext.integrations')}
                </p>
                <div className="space-y-1">
                  {mcpRows.map((row) => (
                    <Link
                      key={row.id}
                      to="/connections/connected"
                      className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-bg-hover/70"
                    >
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-2xs font-semibold text-white"
                        style={{ backgroundColor: row.brandColor }}
                      >
                        {row.initials}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate-fade text-xs text-text-primary">{row.displayName}</span>
                        {row.endpoint ? (
                          <span className="block truncate-fade text-2xs text-text-muted">{row.endpoint}</span>
                        ) : null}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
            <div>
              <p className="mb-1 flex items-center gap-1 text-2xs font-semibold text-text-muted">
                <Wrench size={10} />
                {t('agentContext.tools')}
              </p>
              {unrestricted ? (
                <div className="flex flex-wrap gap-1">
                  {toolCatalog.map((row) => (
                    <span
                      key={row.name}
                      title={row.description}
                      className="rounded-md bg-bg-elevated px-1.5 py-px text-2xs text-text-secondary"
                    >
                      {row.name}
                    </span>
                  ))}
                  {toolCatalog.length === 0 ? (
                    <span className="text-xs text-text-muted">{t('agentContext.allToolsAvailable')}</span>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {allowedTools.map((name) => (
                    <span
                      key={name}
                      title={toolDescription.get(name)?.description}
                      className="rounded-md bg-bg-elevated px-1.5 py-px text-2xs text-text-secondary"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </DisclosureRow>
          <DisclosureRow
            label={t('agentContext.mayDo')}
            count={scopes.length}
            countLabel={scopes.length === 0 ? t('agentContext.roleDefaults') : undefined}
          >
            <div className="flex flex-wrap gap-1">
              {scopes.map((scope) => (
                <span
                  key={scope}
                  className="rounded-md bg-bg-elevated px-1.5 py-px text-2xs text-text-secondary"
                >
                  {permissionScopeLabel(scope, t)}
                </span>
              ))}
            </div>
          </DisclosureRow>
        </div>
        {agentId ? (
          <Link
            to={`/agents/${agentId}`}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
          >
            <Settings size={11} />
            {t('agentContext.configure')}
          </Link>
        ) : null}
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

      {/* Active task (minimal) */}
      {task ? (
        <div className="border-b border-border/40 px-4 py-3">
          <SectionHeading title={t('agentContext.activeTask')} />
          <Link
            to={inboxPath('all', task.signal_id || String(thread.id))}
            className="block rounded-lg border border-border/60 bg-bg-elevated/50 px-3 py-2 transition-colors hover:border-border-light"
          >
            <p className="truncate-fade text-sm font-medium text-text-primary">{task.title}</p>
            <p className="mt-0.5 text-xs text-text-muted">
              {workLogStatusLabel(task.status, t)}
              {task.pause_reason ? ` (${humanizeLabel(task.pause_reason)})` : ''}
              {' · '}{t('agentContext.openRun')}
            </p>
          </Link>
        </div>
      ) : null}

      {/* Recent conversations */}
      <div className="px-4 py-3">
        <SectionHeading title={t('agentContext.recentConversations')} />
        {recent.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 px-3 py-3">
            <p className="text-xs text-text-muted">{t('agentContext.noOtherConversations')}</p>
            {agent?.id ? (
              <Link
                to={agentChatPath(agent.id)}
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
