import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  CornerUpLeft,
  Folder,
  Lightbulb,
  Link2,
} from 'lucide-react'
import type { OrgFlow, OrgFlowNode } from '../../lib/org-flow-api'
import {
  MODE_STYLE,
  emphasis,
  isLit,
  layoutOrgFlow2D,
  openStack,
  type CardBox,
  type GridLens,
} from '../../lib/org-flow-layout'
import { cn } from '../../lib/utils'
import { AgentMark } from '../ui/AgentMark'
import { ChannelMark } from '../ui/ChannelMark'
import { FlowMark } from './FlowMark'
import { useGridNames } from './org-flow-names'

type Props = {
  data: OrgFlow
  lens: GridLens
  label: string | null
  /** One department in focus: other lanes dim. */
  zone?: string | null
  selectedId: string | null
  hoverId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}

const HEADER_H = 40
/** The board shrinks to fit its column down to this scale, then scrolls. */
const MIN_SCALE = 0.6
const DIM = 0.12

function FaceInner({ node }: { node: OrgFlowNode }) {
  const round = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full'
  switch (node.kind) {
    case 'channel':
      return <ChannelMark channel={node.channel} size={24} />
    case 'agent':
    case 'user':
      return <AgentMark agent={node.mark ?? { name: node.label }} size={24} mode="static" fallbackName={node.label} />
    case 'unassigned':
      return (
        <span className={cn(round, 'bg-status-warning/15')}>
          <AlertCircle size={14} strokeWidth={1.8} className="text-status-warning" />
        </span>
      )
    case 'flow':
      return <FlowMark node={node} />
    case 'reply':
      return (
        <span className={cn(round, 'bg-status-info/15')}>
          <CornerUpLeft size={13} strokeWidth={1.7} className="text-status-info" />
        </span>
      )
    case 'folder':
      return <Folder size={18} strokeWidth={1.5} className="shrink-0 text-status-warning" />
    case 'knowledge':
      return (
        <span className={cn(round, 'bg-bg-elevated')}>
          <Lightbulb size={13} strokeWidth={1.6} className="text-text-primary" />
        </span>
      )
    case 'connection':
      return (
        <span className={cn(round, 'bg-status-success/15')}>
          <Link2 size={13} strokeWidth={1.7} className="text-status-success" />
        </span>
      )
    default:
      return null
  }
}

/** Matches 3D: outer ring when there is no open count; mini pillar when there is. */
function Face({ node }: { node: OrgFlowNode }) {
  const inner = <FaceInner node={node} />
  if (!inner) return null
  const hasPillar = node.layer === 'executor' && node.open > 0
  if (hasPillar) {
    const h = Math.min(28, 12 + Math.log2(node.open + 1) * 5)
    return (
      <span className="flex shrink-0 items-end gap-1">
        <span
          className="mb-0.5 w-1.5 shrink-0 rounded-sm bg-status-info/75"
          style={{ height: h }}
          aria-hidden
        />
        {inner}
      </span>
    )
  }
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
      style={{ boxShadow: '0 0 0 2px color-mix(in srgb, var(--color-status-info) 40%, transparent)' }}
    >
      {inner}
    </span>
  )
}

function LabelBar({ node, data }: { node: OrgFlowNode; data: OrgFlow }) {
  const stack = openStack(node, data.labels)
  if (!node.open || stack.length === 0) return null
  return (
    <span className="mt-1 flex h-1 w-full overflow-hidden rounded-full bg-bg-elevated" aria-hidden>
      {stack.map((s) => (
        <span key={s.key} style={{ width: `${(s.count / node.open) * 100}%`, background: s.color }} />
      ))}
    </span>
  )
}

/** Grid in 2D: intake, executors in department zones, flows and results, left to right. */
export function OrgFlowBoard({ data, lens, label, zone = null, selectedId, hoverId, onHover, onSelect }: Props) {
  const { t } = useTranslation('nav')
  const names = useGridNames()
  const layout = useMemo(() => layoutOrgFlow2D(data, { labels: lens === 'labels' }), [data, lens])
  const fitRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const host = fitRef.current?.parentElement
    if (!host) return
    const fit = () => setScale(Math.max(MIN_SCALE, Math.min(1, (host.clientWidth - 16) / layout.width)))
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(host)
    return () => observer.disconnect()
  }, [layout.width])
  const lit = useMemo(() => emphasis(data, lens, { focus: hoverId, label, zone }), [data, lens, hoverId, label, zone])
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes])
  const zoneById = useMemo(() => new Map(data.zones.map((z) => [z.id, z])), [data.zones])

  const zoneName = (id: string) => (id === 'none' ? t('orgCanvas.zone.none') : (zoneById.get(id)?.label ?? ''))
  const focusZone = zone

  const subtitle = (node: OrgFlowNode, card: CardBox) => {
    if (card.ghost) {
      const main = node.zones?.[0]
      return <span className="text-text-muted">{t('orgCanvas.node.ghost', { name: main ? zoneName(main) : '' })}</span>
    }
    if (node.kind === 'channel') {
      if (lens === 'autonomy' && node.autonomy) {
        return <span>{t(`orgCanvas.mode.${node.autonomy}`)}</span>
      }
      return <span className="text-text-muted">{names.channel(node.channel)}</span>
    }
    if (node.kind === 'unassigned') {
      return <span className="text-status-warning">{t('orgCanvas.node.conversations', { count: node.count, days: data.days })}</span>
    }
    if (node.kind === 'agent' || node.kind === 'user') {
      if (node.issues.includes('offline')) return <span className="text-text-muted">{t('orgCanvas.node.offline')}</span>
      if (lens === 'autonomy' && node.autonomy) {
        return <span style={{ color: MODE_STYLE[node.autonomy].color }}>{t(`orgCanvas.mode.${node.autonomy}`)}</span>
      }
      return (
        <span>
          <span className={node.issues.includes('overloaded') ? 'text-status-warning' : 'text-text-muted'}>
            {t('orgCanvas.node.open', { count: node.open })}
          </span>
          {node.waiting_on_you ? (
            <span className="text-status-error"> · {t('orgCanvas.node.waiting', { count: node.waiting_on_you })}</span>
          ) : null}
        </span>
      )
    }
    if (node.kind === 'flow') {
      if (node.module?.name) return <span className="text-text-muted">{node.module.name}</span>
      if (node.autonomous_pct != null) {
        return (
          <span className="text-text-muted">
            {t('orgCanvas.node.autonomousPct', { pct: Math.round(node.autonomous_pct) })}
          </span>
        )
      }
      if (node.done) {
        return <span className="text-text-muted">{t('orgCanvas.node.done', { count: node.done })}</span>
      }
      return <span className="text-text-muted">{t('orgCanvas.node.open', { count: node.open })}</span>
    }
    return null
  }

  const nodeLit = (id: string) => isLit(lit.litNodes, id)

  const renderCard = (card: CardBox) => {
    const node = byId.get(card.nodeId)
    if (!node) return null
    const flagged = node.issues.length > 0 && !card.ghost
    const selected = selectedId === node.id
    const style = { left: card.x, top: card.y + HEADER_H, width: card.w, height: card.h, opacity: nodeLit(node.id) ? 1 : 0.3 }
    const key = `${card.nodeId}${card.ghost ? ':ghost:' + card.zoneId : ''}`
    const common = {
      type: 'button' as const,
      'data-testid': 'grid-node',
      'data-node-id': node.id,
      onMouseEnter: () => onHover(node.id),
      onMouseLeave: () => onHover(null),
      onFocus: () => onHover(node.id),
      onBlur: () => onHover(null),
      onClick: () => onSelect(node.id),
      style,
    }
    const ring = selected ? 'ring-2 ring-accent/60' : ''
    const autonomyEdge =
      lens === 'autonomy' && node.autonomy && (node.kind === 'agent' || node.kind === 'channel')
        ? { boxShadow: `inset 3px 0 0 ${MODE_STYLE[node.autonomy].color}` }
        : undefined

    if (node.kind === 'sink_open' || node.kind === 'sink_closed_without_result') {
      return (
        <button
          key={key}
          {...common}
          className={cn(
            'absolute flex flex-col justify-center rounded-[10px] border border-dashed border-border px-3 text-left transition-opacity',
            ring,
          )}
        >
          <span className="text-xs leading-4 text-text-secondary">{names.node(node)}</span>
          <span className="text-sm font-semibold leading-[18px] text-text-heading">
            {node.kind === 'sink_open' ? node.open || node.count : node.count || '-'}
          </span>
          {lens === 'labels' ? <LabelBar node={node} data={data} /> : null}
        </button>
      )
    }

    if (node.kind === 'reply' || node.kind === 'folder') {
      return (
        <button
          key={key}
          {...common}
          className={cn(
            'absolute flex flex-col gap-2 rounded-xl border bg-bg-surface px-3.5 py-3 text-left transition-opacity',
            flagged ? 'border-status-warning/70' : 'border-border/60',
            ring,
          )}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <Face node={node} />
            <span className="truncate text-base font-semibold leading-[17px] text-text-heading">{names.node(node)}</span>
            {node.kind === 'folder' ? (
              <span className="shrink-0 text-xs text-text-muted">
                {node.children
                  ? `${t('orgCanvas.result.folder')} · ${t('orgCanvas.result.subfolders', { count: node.children })}`
                  : t('orgCanvas.result.folder')}
              </span>
            ) : null}
          </span>
          {node.kind === 'reply' ? (
            <span className="flex flex-wrap gap-1.5">
              {(node.channels ?? []).map((ch) => (
                <span key={ch} className="rounded-md bg-status-info/15 px-2 py-0.5 text-xs leading-4 text-status-info">
                  {t('orgCanvas.result.via', { channel: names.channel(ch).toLowerCase() })}
                </span>
              ))}
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-1.5 overflow-hidden">
              {(node.works_in ?? []).length ? (
                <span className="text-2xs text-text-muted">{t('orgCanvas.result.worksIn')}</span>
              ) : null}
              {(node.works_in ?? []).map((item) =>
                item.origin === 'connection' ? (
                  <span
                    key={item.key}
                    className="inline-flex max-w-[180px] items-center gap-1 truncate rounded-md border border-border px-2 py-px text-xs leading-4 text-text-primary"
                  >
                    <Link2 size={10} className="shrink-0 text-text-muted" />
                    <span className="truncate">{names.worksIn(item)}</span>
                  </span>
                ) : (
                  <span
                    key={item.key}
                    className="max-w-[180px] truncate rounded-md bg-bg-elevated px-2 py-0.5 text-xs leading-4 text-text-primary"
                  >
                    {names.worksIn(item)}
                  </span>
                ),
              )}
            </span>
          )}
          {lens === 'labels' ? <LabelBar node={node} data={data} /> : null}
        </button>
      )
    }

    const executor = node.layer === 'executor'
    return (
      <button
        key={key}
        {...common}
        style={{ ...style, ...autonomyEdge }}
        className={cn(
          'absolute flex items-center gap-2.5 text-left transition-opacity',
          executor ? 'rounded-[10px] px-2.5' : 'rounded-xl px-3',
          card.ghost
            ? 'border border-dashed border-border bg-transparent'
            : node.kind === 'unassigned'
              ? 'border border-dashed border-status-warning bg-status-warning/5'
              : cn('border bg-bg-surface', flagged ? 'border-status-warning/70' : 'border-border/60'),
          ring,
        )}
      >
        <span className={cn('relative', card.ghost && 'opacity-50')}>
          <Face node={node} />
          {node.waiting_on_you && !card.ghost ? (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-status-error ring-2 ring-bg-surface" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1 leading-4">
          <span className={cn('block truncate font-semibold', executor ? 'text-sm' : 'text-base', card.ghost ? 'text-text-secondary' : 'text-text-heading')}>
            {names.node(node)}
          </span>
          <span className="block truncate text-2xs">{subtitle(node, card)}</span>
          {lens === 'labels' && !card.ghost ? <LabelBar node={node} data={data} /> : null}
        </span>
      </button>
    )
  }

  const columns: Array<{ x: number; title: string; sub?: string }> = [
    { x: layout.columns.input, title: t('orgCanvas.columns.input') },
    { x: layout.columns.executor, title: t('orgCanvas.columns.executor'), sub: t('orgCanvas.columns.executorSub') },
    { x: layout.columns.work, title: t('orgCanvas.columns.work'), sub: t('orgCanvas.columns.workSub') },
    { x: layout.columns.result, title: t('orgCanvas.columns.result'), sub: t('orgCanvas.columns.resultSub') },
  ]

  return (
    <div ref={fitRef} style={{ width: layout.width * scale, height: (layout.height + HEADER_H) * scale }}>
    <div
      className="relative origin-top-left"
      style={{ width: layout.width, height: layout.height + HEADER_H, transform: scale < 1 ? `scale(${scale})` : undefined }}
      data-testid="grid-2d"
    >
      {columns.map((col) => (
        <div
          key={col.title}
          className="absolute top-3 text-2xs font-semibold uppercase leading-4 tracking-[0.08em] text-text-muted"
          style={{ left: col.x }}
        >
          {col.title}
          {col.sub ? <span className="font-medium tracking-[0.04em]"> · {col.sub}</span> : null}
        </div>
      ))}

      {layout.zones.map((zone) => {
        const info = zoneById.get(zone.id)
        return (
          <div
            key={zone.id}
            className={cn(
              'pointer-events-none absolute rounded-[14px] border',
              zone.none ? 'border-dashed border-status-warning/40 bg-status-warning/[0.04]' : 'border-status-info/25 bg-status-info/[0.05]',
            )}
            style={{
              left: zone.x,
              top: zone.y + HEADER_H,
              width: zone.w,
              height: zone.h,
              opacity: focusZone && focusZone !== zone.id ? 0.35 : 1,
            }}
            data-testid="grid-zone"
            data-zone-id={zone.id}
          >
            <div className={cn('px-4 pt-2 text-xs font-semibold leading-4', zone.none ? 'text-status-warning' : 'text-status-info')}>
              {zoneName(zone.id)}
              {info?.hint ? (
                <span className="font-medium text-text-muted"> · {t(`orgCanvas.zone.hint.${info.hint}`)}</span>
              ) : null}
            </div>
          </div>
        )
      })}

      <svg
        aria-hidden
        className="pointer-events-none absolute left-0"
        style={{ top: HEADER_H }}
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
      >
        <defs>
          <marker id="grid-knowledge-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="#8A8A88" />
          </marker>
        </defs>
        <g fill="none" strokeLinecap="round">
          {layout.paths.map((path) => {
            const pathOn = isLit(lit.litPaths, path.id)
            const style = MODE_STYLE[path.mode]
            return path.strips.map((strip) => {
              const stripOn = pathOn && (lit.label === null || strip.labelKey === lit.label)
              return (
                <path
                  key={strip.key}
                  d={strip.d}
                  stroke={strip.color}
                  strokeWidth={strip.width}
                  strokeDasharray={strip.dash ?? undefined}
                  opacity={stripOn ? (lens === 'labels' ? 0.9 : style.opacity) : DIM}
                  data-testid="grid-path"
                  data-path-id={path.id}
                  data-label={strip.labelKey ?? undefined}
                />
              )
            })
          })}
          {layout.knowledgeLine ? (
            <path
              d={layout.knowledgeLine.d}
              stroke="#8A8A88"
              strokeWidth={1.5}
              strokeDasharray="3 5"
              markerEnd="url(#grid-knowledge-arrow)"
              opacity={nodeLit('result:knowledge') ? 1 : DIM}
            />
          ) : null}
        </g>
      </svg>
      {layout.knowledgeLine ? (
        <div
          className="pointer-events-none absolute text-2xs leading-[14px] text-text-muted"
          style={{ left: layout.knowledgeLine.labelX, top: layout.knowledgeLine.labelY + HEADER_H - 7 }}
        >
          {t('orgCanvas.result.corrections')}
        </div>
      ) : null}

      {layout.cards.map(renderCard)}
    </div>
    </div>
  )
}
