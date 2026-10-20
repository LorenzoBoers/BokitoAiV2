import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, AlertTriangle, Archive, CornerUpLeft, Folder, Inbox, Lightbulb, Tag, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { AgentGlow } from '../ui/agent-glow'
import { AgentMark } from '../ui/AgentMark'
import { FlowMark } from './FlowMark'
import { ChannelMark } from '../ui/ChannelMark'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { useAuth } from '../../context/AuthContext'
import { useAgentPresence } from '../../hooks/useAgentPresence'
import { agentProfileAccentColor, resolveAgentAvatarColor } from '../../lib/agent-avatar'
import { stashChatContinue } from '../../lib/chat-auto-continue'
import { agentChatPath } from '../../lib/messages-paths'
import { NO_LABEL_KEY, suggestOrgFlowLabels, type OrgFlow, type OrgFlowNode } from '../../lib/org-flow-api'
import { labelHex, labelKeyOf, pathsOf } from '../../lib/org-flow-layout'
import { WORKS_IN_ADD_HASH } from '../projects/WorksInSection'
import { useGridNames } from './org-flow-names'

type Props = {
  data: OrgFlow
  selectedId: string | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
}

/** Share of unlabeled work above which the card offers "Suggest labels". */
const UNLABELED_SHARE = 0.3

const SUGGEST_KINDS = new Set(['channel', 'agent', 'user', 'unassigned', 'folder'])

/** Agent nodes are `agent:{id}` so the panel can follow that agent's live presence. */
function agentIdOf(node: OrgFlowNode | null): string | null {
  if (!node || node.kind !== 'agent' || !node.id.startsWith('agent:')) return null
  const id = node.id.slice('agent:'.length)
  return id || null
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-2xs font-semibold uppercase leading-4 tracking-[0.08em] text-text-muted">{children}</h3>
}

const ROW_MARK = 18
/** People have no orb color. Titles and the corner wash use this blue. */
const PERSON_ACCENT = '#3b82f6'

function GlyphDisc({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full ${className}`} style={{ width: ROW_MARK, height: ROW_MARK }} aria-hidden>
      {children}
    </span>
  )
}

/** The same face the node wears on the map: channel, agent, flow, or a small kind mark. */
function NodeMark({ node }: { node: OrgFlowNode }) {
  switch (node.kind) {
    case 'channel':
      return <ChannelMark channel={node.channel} size={ROW_MARK} />
    case 'agent':
    case 'user':
      return <AgentMark agent={node.mark ?? { name: node.label }} size={ROW_MARK} mode="static" fallbackName={node.label} decorative />
    case 'flow':
      return <FlowMark node={node} size={ROW_MARK} />
    case 'folder':
      return (
        <GlyphDisc className="bg-status-warning/15 text-status-warning">
          <Folder size={11} strokeWidth={1.7} />
        </GlyphDisc>
      )
    case 'reply':
      return (
        <GlyphDisc className="bg-status-info/15 text-status-info">
          <CornerUpLeft size={11} strokeWidth={1.7} />
        </GlyphDisc>
      )
    case 'knowledge':
      return (
        <GlyphDisc className="bg-bg-elevated text-text-primary">
          <Lightbulb size={11} strokeWidth={1.7} />
        </GlyphDisc>
      )
    case 'unassigned':
      return (
        <GlyphDisc className="bg-status-warning/15 text-status-warning">
          <AlertCircle size={11} strokeWidth={1.8} />
        </GlyphDisc>
      )
    case 'sink_open':
      return (
        <GlyphDisc className="bg-bg-elevated text-text-secondary">
          <Inbox size={11} strokeWidth={1.7} />
        </GlyphDisc>
      )
    case 'sink_closed_without_result':
      return (
        <GlyphDisc className="bg-bg-elevated text-text-secondary">
          <Archive size={11} strokeWidth={1.7} />
        </GlyphDisc>
      )
    default:
      return null
  }
}

/** Bottleneck list: the panel's start view, and the window beside a selected node. */
export function OrgIssuesList({
  data,
  onSelect,
  onHover,
  onClose,
  bare = false,
}: {
  data: OrgFlow
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
  onClose?: () => void
  /** Skip the heading when a parent already shows it, such as the growing warning button. */
  bare?: boolean
}) {
  const { t } = useTranslation('nav')
  const names = useGridNames()
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes])
  return (
    <div className="flex flex-col gap-3" data-testid="grid-issues">
      {bare ? null : (
        <div className="flex items-center justify-between gap-2">
          <SectionTitle>{t('orgCanvas.panel.issues')}</SectionTitle>
          {onClose ? (
            <Button
              variant="ghost"
              size="iconSm"
              type="button"
              aria-label={t('orgCanvas.panel.close')}
              onClick={onClose}
              className="-mr-1 h-6 w-6 text-text-muted"
            >
              <X size={14} />
            </Button>
          ) : null}
        </div>
      )}
      {data.issues.length === 0 ? (
        <p className="text-xs text-text-muted">{t('orgCanvas.panel.noIssues')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {data.issues.map((issue, i) => {
            const target = issue.node_id ? byId.get(issue.node_id) : null
            const params = { ...issue.params, name: target ? names.node(target) : issue.params.name }
            const text = t(`orgCanvas.issue.${issue.message_key}`, params)
            return (
              <li key={`${issue.message_key}:${issue.node_id ?? i}`}>
                {issue.node_id ? (
                  <button
                    type="button"
                    onClick={() => onSelect(issue.node_id)}
                    onMouseEnter={() => onHover(issue.node_id)}
                    onMouseLeave={() => onHover(null)}
                    className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-xs text-text-secondary hover:bg-bg-elevated hover:text-text-heading"
                  >
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-status-warning" />
                    <span>{text}</span>
                  </button>
                ) : (
                  <Link
                    to={issue.href ?? '#'}
                    className="flex items-start gap-2 rounded-md px-1.5 py-1 text-xs text-text-secondary hover:bg-bg-elevated hover:text-text-heading"
                  >
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-status-warning" />
                    <span>{text}</span>
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Right-hand panel of the Grid: bottlenecks first, the selected node after a click. */
export function OrgDetailPanel({ data, selectedId, onSelect, onHover }: Props) {
  const { t, i18n } = useTranslation('nav')
  const names = useGridNames()
  const navigate = useNavigate()
  const { token } = useAuth()
  const [suggesting, setSuggesting] = useState(false)
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes])
  const node = selectedId ? byId.get(selectedId) ?? null : null
  const agentId = agentIdOf(node)
  const activity = useAgentPresence(agentId)

  if (!node) {
    return <OrgIssuesList data={data} onSelect={onSelect} onHover={onHover} />
  }

  const { incoming, outgoing } = pathsOf(node.id, data.paths)
  const isFolder = node.kind === 'folder'
  const isExecutor = node.layer === 'executor'

  // Label split: open work on the node plus the work that flowed through it.
  const split = new Map<string, number>()
  for (const [key, count] of Object.entries(node.open_by_label)) split.set(key, (split.get(key) ?? 0) + count)
  const through = incoming.length ? incoming : outgoing
  for (const p of through) for (const [key, count] of Object.entries(p.by_label)) split.set(key, (split.get(key) ?? 0) + count)
  const splitTotal = [...split.values()].reduce((a, b) => a + b, 0)
  const unlabeled = splitTotal ? (split.get(NO_LABEL_KEY) ?? 0) / splitTotal : 0
  const labelRows = (() => {
    const rows: Array<{ key: string; name: string; color: string; tone: string; icon: string | null; flow: boolean; count: number }> = []
    let other = 0
    for (const label of data.labels) {
      const count = split.get(labelKeyOf(label)) ?? 0
      if (count <= 0) continue
      if (!label.flow_id) {
        other += count
        continue
      }
      rows.push({
        key: labelKeyOf(label),
        name: `#${label.name}`,
        color: labelHex(label.color),
        tone: label.color,
        icon: label.icon || null,
        flow: true,
        count,
      })
    }
    if (other > 0) {
      rows.push({
        key: 'other',
        name: t('orgCanvas.legendFlow.other'),
        color: labelHex('neutral'),
        tone: 'neutral',
        icon: null,
        flow: false,
        count: other,
      })
    }
    return rows.sort((a, b) => b.count - a.count)
  })()

  const zone = isExecutor && node.zones?.length ? data.zones.find((z) => z.id === node.zones![0]) : null
  const distributeHref = isExecutor ? (zone?.href ?? '/workforce?tab=departments') : null

  const kindLine = (() => {
    if (node.kind === 'agent') return t('orgCanvas.node.agent')
    if (node.kind === 'user') return t('orgCanvas.node.person')
    if (node.kind === 'channel') return names.channel(node.channel)
    if (node.kind === 'flow') return node.module?.name ?? t('orgCanvas.node.flow')
    if (isFolder) return node.subtitle ? `${t('orgCanvas.result.folder')} · ${node.subtitle}` : t('orgCanvas.result.folder')
    return t('orgCanvas.node.conversations', { count: node.count })
  })()

  const suggest = async () => {
    if (!token) return
    setSuggesting(true)
    try {
      const created = await suggestOrgFlowLabels(token, {
        node_id: node.id,
        days: data.days,
        lang: i18n.language?.startsWith('nl') ? 'nl' : 'en',
      })
      stashChatContinue(created.id, { mode: 'continue' })
      navigate(agentChatPath(created.agent_id, created.id), { state: { continuePending: true } })
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('orgCanvas.panel.suggestError')))
    } finally {
      setSuggesting(false)
    }
  }

  const pathList = (rows: typeof incoming, end: 'source' | 'target') =>
    rows.length === 0 ? (
      <p className="text-xs text-text-muted">{t('orgCanvas.panel.nothing')}</p>
    ) : (
      <ul className="flex flex-col gap-0.5">
        {[...rows]
          .sort((a, b) => b.count - a.count)
          .map((p) => {
            const other = byId.get(p[end])
            if (!other) return null
            return (
              <li key={`${p.source}->${p.target}`}>
                <button
                  type="button"
                  onClick={() => onSelect(other.id)}
                  onMouseEnter={() => onHover(other.id)}
                  onMouseLeave={() => onHover(null)}
                  className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left text-sm leading-[18px] text-text-primary hover:bg-bg-elevated"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <NodeMark node={other} />
                    <span className="truncate">{names.node(other)}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-text-muted">{p.count}</span>
                </button>
              </li>
            )
          })}
      </ul>
    )

  return (
    <div className="relative isolate flex flex-col gap-4" data-testid="grid-detail" data-node-id={node.id}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {node.kind === 'agent' || node.kind === 'user' ? (
            (() => {
              const accent = agentProfileAccentColor(
                node.kind === 'agent' ? resolveAgentAvatarColor(node.mark?.avatar_color) : PERSON_ACCENT,
              )
              const jobTitle = (node.job_title || '').trim()
              const description = (node.description || '').trim()
              const live = node.kind === 'agent'
              return (
                <div className="mb-1 mt-2" data-testid={live ? 'grid-agent-character' : 'grid-person-character'}>
                  <AgentGlow color={accent} placement="corner-left" className="-left-12 -top-16 -z-10 h-44 w-44" />
                  <div className="flex items-start gap-3">
                    <AgentMark
                      agent={{ ...(node.mark ?? {}), name: node.mark?.name || names.node(node) }}
                      size={56}
                      mode={live ? 'live' : 'static'}
                      motion={live && activity === 'working' ? 'working' : 'idle'}
                      baseMotion={live && activity === 'working' ? 'working' : 'idle'}
                      spawnKey={live ? `quick-${node.id}` : undefined}
                      fallbackName={names.node(node)}
                      decorative
                    />
                    <div className="min-w-0 pt-1">
                      <h2 className="truncate text-lg font-semibold leading-5 text-text-heading">{names.node(node)}</h2>
                      {jobTitle ? (
                        <p className="mt-1 truncate text-sm font-medium leading-snug" style={{ color: accent }}>
                          {jobTitle}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs leading-4 text-text-secondary">{kindLine}</p>
                      )}
                    </div>
                  </div>
                  {description ? <p className="mt-2.5 text-xs leading-snug text-text-secondary">{description}</p> : null}
                </div>
              )
            })()
          ) : node.kind === 'flow' ? (
            <div className="mb-3 mt-2">
              <FlowMark node={node} size={40} />
              <h2 className="mt-2 truncate text-lg font-semibold leading-5 text-text-heading">{names.node(node)}</h2>
              <p className="text-xs leading-4 text-text-secondary">{kindLine}</p>
            </div>
          ) : (
            <>
              <h2 className="truncate text-lg font-semibold leading-5 text-text-heading">{names.node(node)}</h2>
              <p className="text-xs leading-4 text-text-secondary">{kindLine}</p>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="iconSm"
            type="button"
            aria-label={t('orgCanvas.panel.close')}
            onClick={() => onSelect(null)}
            className="h-6 w-6 text-text-muted"
          >
            <X size={14} />
          </Button>
        </div>
      </div>

      {node.issues.length ? (
        <ul className="flex flex-col gap-1">
          {node.issues.map((issue) => (
            <li key={issue} className="flex items-start gap-2 text-xs text-status-warning">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {t(`orgCanvas.issue.${issue}`, { name: names.node(node), count: node.open })}
            </li>
          ))}
        </ul>
      ) : null}

      {isFolder ? (
        <div className="flex flex-col gap-1.5">
          <SectionTitle>{t('orgCanvas.result.worksIn')}</SectionTitle>
          {(node.works_in ?? []).length === 0 ? (
            <p className="text-xs text-text-muted">{t('orgCanvas.panel.nothing')}</p>
          ) : (
            (node.works_in ?? []).map((item) => (
              <span key={item.key} className="flex justify-between gap-2 text-sm leading-[18px]">
                {item.href ? (
                  item.href.startsWith('http') ? (
                    <a href={item.href} target="_blank" rel="noreferrer" className="truncate text-text-primary hover:underline">
                      {names.worksIn(item)}
                    </a>
                  ) : (
                    <Link to={item.href} className="truncate text-text-primary hover:underline">
                      {names.worksIn(item)}
                    </Link>
                  )
                ) : (
                  <span className="truncate text-text-primary">{names.worksIn(item)}</span>
                )}
                <span className="shrink-0 text-text-muted">{t(`orgCanvas.panel.origin.${item.origin}`)}</span>
              </span>
            ))
          )}
        </div>
      ) : null}

      {node.layer !== 'input' ? (
        <div className="flex flex-col gap-1">
          <SectionTitle>{isFolder || node.layer === 'result' ? t('orgCanvas.panel.comesInVia') : t('orgCanvas.panel.receivesFrom')}</SectionTitle>
          {pathList(incoming, 'source')}
        </div>
      ) : null}
      {node.layer !== 'result' ? (
        <div className="flex flex-col gap-1">
          <SectionTitle>{node.layer === 'work' ? t('orgCanvas.panel.landsIn') : t('orgCanvas.panel.worksOn')}</SectionTitle>
          {pathList(outgoing, 'target')}
        </div>
      ) : null}

      {labelRows.length ? (
        <div className="flex flex-col gap-1.5" data-testid="grid-label-split">
          <SectionTitle>{t('orgCanvas.panel.byLabel')}</SectionTitle>
          <div className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-bg-elevated" aria-hidden>
            {labelRows.map((row) => (
              <span key={row.key} className="h-full" style={{ width: `${(row.count / splitTotal) * 100}%`, background: row.color }} />
            ))}
          </div>
          {labelRows.map((row) => (
            <span key={row.key} className="flex items-center justify-between gap-2 text-sm leading-[18px]">
              <span className="flex min-w-0 items-center gap-2">
                {row.flow ? (
                  <FlowMark node={{ icon: row.icon, color: row.tone }} size={ROW_MARK} />
                ) : (
                  <GlyphDisc className="bg-bg-elevated text-text-muted">
                    <Tag size={11} strokeWidth={1.7} />
                  </GlyphDisc>
                )}
                <span className="truncate text-text-primary">{row.name}</span>
              </span>
              <span className="font-semibold tabular-nums text-text-heading">{row.count}</span>
            </span>
          ))}
          {unlabeled > UNLABELED_SHARE && SUGGEST_KINDS.has(node.kind) ? (
            <div className="mt-1 flex flex-col gap-1.5">
              <p className="text-xs text-text-secondary">{t('orgCanvas.panel.unlabeled', { pct: Math.round(unlabeled * 100) })}</p>
              <Button type="button" size="sm" variant="secondary" disabled={suggesting} onClick={() => void suggest()}>
                {t('orgCanvas.panel.suggestLabels')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {isFolder && node.href ? (
          <>
            <Button asChild size="sm">
              <Link to={node.href}>{t('orgCanvas.panel.openFolder')}</Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link to={`${node.href}${WORKS_IN_ADD_HASH}`}>{t('orgCanvas.panel.addWorksIn')}</Link>
            </Button>
          </>
        ) : null}
        {node.threads_href ? (
          <Button asChild size="sm" variant={isFolder ? 'secondary' : 'default'}>
            <Link to={node.threads_href}>{t('orgCanvas.panel.openThreads')}</Link>
          </Button>
        ) : null}
        {distributeHref ? (
          <Button asChild size="sm" variant="secondary">
            <Link to={distributeHref}>{t('orgCanvas.panel.distribute')}</Link>
          </Button>
        ) : null}
        {!isFolder && node.href && !node.threads_href ? (
          <Button asChild size="sm" variant="secondary">
            <Link to={node.href}>{t('orgCanvas.panel.openItem')}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  )
}
