import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ChevronLeft, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { useAuth } from '../../context/AuthContext'
import { stashChatContinue } from '../../lib/chat-auto-continue'
import { agentChatPath } from '../../lib/messages-paths'
import { NO_LABEL_KEY, suggestOrgFlowLabels, type OrgFlow, type OrgFlowNode } from '../../lib/org-flow-api'
import { MODE_STYLE, labelHex, labelKeyOf, pathsOf } from '../../lib/org-flow-layout'
import { WORKS_IN_ADD_HASH } from '../projects/WorksInSection'
import { useGridNames } from './org-flow-names'

type Props = {
  data: OrgFlow
  selectedId: string | null
  lens: string
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
}

/** Share of unlabeled work above which the card offers "Suggest labels". */
const UNLABELED_SHARE = 0.3

const SUGGEST_KINDS = new Set(['channel', 'agent', 'user', 'unassigned', 'folder'])

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-text-muted">{children}</h3>
}

/** Right-hand panel of the Grid: bottlenecks first, the selected node after a click. */
export function OrgDetailPanel({ data, selectedId, lens, onSelect, onHover }: Props) {
  const { t, i18n } = useTranslation('nav')
  const names = useGridNames()
  const navigate = useNavigate()
  const { token } = useAuth()
  const [suggesting, setSuggesting] = useState(false)
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes])
  const node = selectedId ? byId.get(selectedId) ?? null : null

  if (!node) {
    return (
      <div className="flex flex-col gap-3" data-testid="grid-issues">
        <SectionTitle>{t('orgCanvas.panel.issues')}</SectionTitle>
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
  const labelRows = data.labels
    .map((l) => ({ key: labelKeyOf(l), name: l.id ? `#${l.name}` : t('orgCanvas.legendFlow.noLabel'), color: labelHex(l.color), count: split.get(labelKeyOf(l)) ?? 0 }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)

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
                  className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left text-[12.5px] leading-[18px] text-text-primary hover:bg-bg-elevated"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-0.5 w-3 shrink-0 rounded-full"
                      style={{ background: MODE_STYLE[p.mode].color }}
                      aria-hidden
                    />
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
    <div className="flex flex-col gap-4" data-testid="grid-detail" data-node-id={node.id}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="mb-1 inline-flex items-center gap-0.5 text-[11px] text-text-muted hover:text-text-heading"
          >
            <ChevronLeft size={12} />
            {t('orgCanvas.panel.back')}
          </button>
          <h2 className="truncate text-[15px] font-semibold leading-5 text-text-heading">{names.node(node)}</h2>
          <p className="text-xs leading-4 text-text-secondary">{kindLine}</p>
        </div>
        <button
          type="button"
          aria-label={t('orgCanvas.panel.close')}
          onClick={() => onSelect(null)}
          className="rounded p-1 text-text-muted hover:bg-bg-elevated hover:text-text-heading"
        >
          <X size={14} />
        </button>
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

      {node.autonomy_why ? (
        <div className="flex flex-col gap-1">
          <SectionTitle>{t('orgCanvas.panel.mayAct')}</SectionTitle>
          <span className="text-[12.5px] font-medium" style={{ color: MODE_STYLE[node.autonomy_why.mode].color }}>
            {t(`orgCanvas.mode.${node.autonomy_why.mode}`)}
          </span>
          <span className="text-xs text-text-secondary">
            {t(`orgCanvas.panel.source.${node.autonomy_why.source}`, { defaultValue: t('orgCanvas.panel.source.default') })}
          </span>
          {node.autonomy_why.clamped_by ? (
            <span className="text-xs text-text-secondary">
              {t(`orgCanvas.panel.clamped.${node.autonomy_why.clamped_by}`, { defaultValue: '' })}
            </span>
          ) : null}
        </div>
      ) : null}

      {isFolder ? (
        <div className="flex flex-col gap-1.5">
          <SectionTitle>{t('orgCanvas.result.worksIn')}</SectionTitle>
          {(node.works_in ?? []).length === 0 ? (
            <p className="text-xs text-text-muted">{t('orgCanvas.panel.nothing')}</p>
          ) : (
            (node.works_in ?? []).map((item) => (
              <span key={item.key} className="flex justify-between gap-2 text-[12.5px] leading-[18px]">
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

      {lens === 'labels' && labelRows.length ? (
        <div className="flex flex-col gap-1" data-testid="grid-label-split">
          <SectionTitle>{t('orgCanvas.panel.byLabel')}</SectionTitle>
          {labelRows.map((row) => (
            <span key={row.key} className="flex items-center justify-between gap-2 text-[12.5px] leading-[18px]">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: row.color }} aria-hidden />
                <span className="truncate text-text-primary">{row.name}</span>
              </span>
              <span className="tabular-nums text-text-muted">{row.count}</span>
            </span>
          ))}
          {unlabeled > UNLABELED_SHARE && SUGGEST_KINDS.has(node.kind) ? (
            <div className="mt-1 flex flex-col gap-1.5">
              <p className="text-xs text-text-secondary">{t('orgCanvas.panel.unlabeled', { pct: Math.round(unlabeled * 100) })}</p>
              <Button type="button" size="sm" variant="outline" disabled={suggesting} onClick={() => void suggest()}>
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
            <Button asChild size="sm" variant="outline">
              <Link to={`${node.href}${WORKS_IN_ADD_HASH}`}>{t('orgCanvas.panel.addWorksIn')}</Link>
            </Button>
          </>
        ) : null}
        {node.threads_href ? (
          <Button asChild size="sm" variant={isFolder ? 'outline' : 'default'}>
            <Link to={node.threads_href}>{t('orgCanvas.panel.openThreads')}</Link>
          </Button>
        ) : null}
        {distributeHref ? (
          <Button asChild size="sm" variant="outline">
            <Link to={distributeHref}>{t('orgCanvas.panel.distribute')}</Link>
          </Button>
        ) : null}
        {!isFolder && node.href && !node.threads_href ? (
          <Button asChild size="sm" variant="outline">
            <Link to={node.href}>{t('orgCanvas.panel.openItem')}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  )
}
