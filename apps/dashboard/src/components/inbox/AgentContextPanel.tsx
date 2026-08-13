import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  Bot,
  ChevronDown,
  ChevronRight,
  Cpu,
  Loader2,
  MessageSquare,
  Plug,
  ShieldCheck,
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
import { agentRunsPath } from '../../lib/messages-paths'
import { AiAvatar } from '../ui/AiAvatar'
import { ThreadProjectPicker } from './ThreadProjectPicker'

type Props = {
  thread: InboxThread
  agent: RuntimeAgent | null
  onThreadUpdated?: () => void
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

const STATUS_CLASS: Record<string, string> = {
  active: 'text-status-success',
  standby: 'text-text-muted',
  sleeping: 'text-text-muted',
  inactive: 'text-text-muted',
  error: 'text-status-error',
}

/** Task statuses worth surfacing inline (still in flight or needs a human). */
const ACTIVE_TASK_STATUSES = new Set(['running', 'queued', 'paused', 'awaiting_decision'])

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function SectionHeading({ title }: { title: string }) {
  return (
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{title}</h3>
  )
}

function DisclosureRow({
  icon: Icon,
  label,
  count,
  countLabel,
  defaultOpen = false,
  children,
}: {
  icon: typeof Wrench
  label: string
  count: number
  /** Optional text shown instead of the numeric badge (e.g. "Unrestricted"). */
  countLabel?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const empty = count === 0 && !countLabel
  return (
    <div className="border-b border-border/40">
      <button
        type="button"
        disabled={empty}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-bg-hover/40 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <Icon size={13} className="shrink-0 text-text-muted" />
        <span className="flex-1 text-[12.5px] font-medium text-text-primary">{label}</span>
        <span className="rounded-full bg-bg-elevated px-1.5 py-px text-[10.5px] font-semibold text-text-secondary">
          {countLabel ?? count}
        </span>
        {!empty ? (
          open ? (
            <ChevronDown size={13} className="shrink-0 text-text-muted" />
          ) : (
            <ChevronRight size={13} className="shrink-0 text-text-muted" />
          )
        ) : (
          <span className="w-[13px]" />
        )}
      </button>
      {open && !empty ? <div className="px-4 pb-3">{children}</div> : null}
    </div>
  )
}

export default function AgentContextPanel({ thread, agent, onThreadUpdated }: Props) {
  const { token } = useAuth()
  const [passport, setPassport] = useState<AgentPassport | null>(null)
  const [toolCatalog, setToolCatalog] = useState<GovernToolRow[]>([])
  const [mcpRows, setMcpRows] = useState<McpIntegrationRow[]>([])
  const [recent, setRecent] = useState<InboxThread[]>([])
  const [task, setTask] = useState<AgentTask | null>(null)
  const [loading, setLoading] = useState(true)

  const agentId = agent?.id && agent.id !== 'unknown' ? agent.id : null

  const load = useCallback(async () => {
    setLoading(true)
    const [passports, allowances, mcp, threads, tasks] = await Promise.all([
      listAgentPassports()
        .then((r) => r.items as AgentPassport[])
        .catch(() => [] as AgentPassport[]),
      getAllowances()
        .then((r) => r.tools)
        .catch(() => [] as GovernToolRow[]),
      listMcpIntegrationRows().catch(() => [] as McpIntegrationRow[]),
      agentId
        ? listSignalThreads(token ?? '', { agentId, perPage: 12 })
            .then((r) => r.items)
            .catch(() => [] as InboxThread[])
        : Promise.resolve([] as InboxThread[]),
      listAgentTasks({ signalId: String(thread.id) }).catch(() => [] as AgentTask[]),
    ])
    setPassport(agentId ? (passports.find((p) => p.id === agentId) ?? null) : null)
    setToolCatalog(allowances)
    setMcpRows(mcp)
    setRecent(threads.filter((t) => String(t.id) !== String(thread.id)))
    setTask(tasks.find((t) => ACTIVE_TASK_STATUSES.has(t.status)) ?? null)
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
  const role = agent?.role_name || agent?.role_slug || 'Agent'
  const status = agent?.status ?? passport?.runtime_status ?? null

  return (
    <div className="flex flex-col">
      <ThreadProjectPicker
        threadId={thread.id}
        projectId={thread.projectId ?? null}
        onUpdated={onThreadUpdated}
      />

      {/* Identity */}
      <div className="border-b border-border/40 px-4 pb-3 pt-4">
        <SectionHeading title="Agent" />
        {agent && agentId ? (
          <Link
            to={`/agents/${agentId}`}
            className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-bg-elevated px-3 py-2.5 transition-colors hover:border-accent/50"
          >
            <AiAvatar name={agent.name} seed={agentId} size={32} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-text-heading">{agent.name}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
                <Bot size={11} />
                {role}
              </span>
              {status ? (
                <span
                  className={`mt-1 inline-flex items-center text-[10px] font-semibold capitalize ${
                    STATUS_CLASS[status] ?? 'text-text-muted'
                  }`}
                >
                  {status}
                </span>
              ) : null}
              {agent.current_activity_summary ? (
                <span className="mt-2 flex items-start gap-1.5 text-[11px] text-text-secondary">
                  <Activity size={11} className="mt-0.5 shrink-0 text-text-muted" />
                  <span className="line-clamp-3">{agent.current_activity_summary}</span>
                </span>
              ) : null}
            </span>
          </Link>
        ) : (
          <div className="rounded-lg border border-border/60 bg-bg-elevated px-3 py-2.5">
            <p className="text-sm font-semibold text-text-heading">
              {agent?.name || 'Workspace assistant'}
            </p>
            <p className="mt-1 text-xs text-text-muted">{role}</p>
          </div>
        )}
        {model ? (
          <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-text-secondary">
            <Cpu size={12} className="shrink-0 text-text-muted" />
            <span className="min-w-0 truncate">
              {model}
              {provider ? <span className="text-text-muted"> ({provider})</span> : null}
            </span>
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading agent details...
        </div>
      ) : null}

      {/* Tools & integrations */}
      <DisclosureRow
        icon={Wrench}
        label="Tools & integrations"
        count={toolCount + mcpRows.length}
      >
        {mcpRows.length > 0 ? (
          <div className="mb-2">
            <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              <Plug size={10} />
              Integrations
            </p>
            <div className="space-y-1">
              {mcpRows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-2 rounded-md border border-border/45 bg-bg-elevated/45 px-2 py-1"
                >
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-semibold text-white"
                    style={{ backgroundColor: row.brandColor }}
                  >
                    {row.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] text-text-primary">{row.displayName}</span>
                    {row.endpoint ? (
                      <span className="block truncate text-[10px] text-text-muted">{row.endpoint}</span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div>
          <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            <Wrench size={10} />
            Tools
            {unrestricted ? <span className="ml-1 normal-case text-text-muted">(unrestricted)</span> : null}
          </p>
          {unrestricted ? (
            <div className="flex flex-wrap gap-1">
              {toolCatalog.map((t) => (
                <span
                  key={t.name}
                  title={t.description}
                  className="rounded-md bg-bg-elevated px-1.5 py-px text-[10.5px] text-text-secondary"
                >
                  {t.name}
                </span>
              ))}
              {toolCatalog.length === 0 ? (
                <span className="text-[11px] text-text-muted">All registered tools are available.</span>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {allowedTools.map((name) => (
                <span
                  key={name}
                  title={toolDescription.get(name)?.description}
                  className="rounded-md bg-bg-elevated px-1.5 py-px text-[10.5px] text-text-secondary"
                >
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>
      </DisclosureRow>

      {/* Govern scopes */}
      <DisclosureRow
        icon={ShieldCheck}
        label="Govern scopes"
        count={scopes.length}
        countLabel={scopes.length === 0 ? 'Role defaults' : undefined}
      >
        <div className="flex flex-wrap gap-1">
          {scopes.map((scope) => (
            <span
              key={scope}
              className="rounded-md bg-bg-elevated px-1.5 py-px font-mono text-[10.5px] text-text-secondary"
            >
              {scope}
            </span>
          ))}
        </div>
      </DisclosureRow>

      {/* Active task (minimal) */}
      {task ? (
        <div className="border-b border-border/40 px-4 py-3">
          <SectionHeading title="Active task" />
          <Link
            to={agentRunsPath('all', task.signal_id || String(thread.id))}
            className="block rounded-lg border border-border/55 bg-bg-elevated/50 px-3 py-2 transition-colors hover:border-accent/40"
          >
            <p className="truncate text-[12.5px] font-medium text-text-primary">{task.title}</p>
            <p className="mt-0.5 text-[11px] capitalize text-text-muted">
              {task.status.replace(/_/g, ' ')}
              {task.pause_reason ? ` (${task.pause_reason.replace(/_/g, ' ')})` : ''}
              {' · Open in Activity'}
            </p>
          </Link>
        </div>
      ) : null}

      {/* Recent conversations */}
      <div className="px-4 py-3">
        <SectionHeading title="Recent conversations" />
        {recent.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/50 px-3 py-3 text-[11.5px] text-text-muted">
            No other conversations with this agent.
          </p>
        ) : (
          <div className="space-y-1">
            {recent.slice(0, 8).map((t) => (
              <Link
                key={String(t.id)}
                to={`/communication/${t.folder === 'internal' ? 'agents' : 'customers'}/all/t/${encodeURIComponent(String(t.id))}`}
                className="flex items-center gap-2 rounded-lg border border-border/45 bg-bg-elevated/45 px-2.5 py-1.5 transition-colors hover:border-accent/40"
              >
                <MessageSquare size={12} className="shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-text-primary">
                    {t.emailSubject || '(No subject)'}
                  </span>
                  <span className="block truncate text-[10.5px] text-text-muted">
                    {t.status}
                    {t.lastMessageAt ? ` - ${timeAgo(t.lastMessageAt)}` : ''}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
