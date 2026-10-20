import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { OrgMakeScene } from '../components/org/OrgMakeScene'
import { OrgFlowBoard } from '../components/org/OrgFlowBoard'
import { OrgFlowScene } from '../components/org/OrgFlowScene'
import { OrgDetailPanel } from '../components/org/OrgDetailPanel'
import { WorkforceSectionTabs } from '../components/shell/SectionTabs'
import { ORG_KIND_ORDER, OrgNodeFace } from '../components/org/OrgNodeFace'
import { SegmentedControl } from '../components/ui/segmented-control'
import { OrgCanvasSkeleton, OrgLegendSkeleton } from '../components/ui/skeleton'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { useAuth } from '../context/AuthContext'
import { getOrgGraph, type OrgGraph, type OrgGraphNode } from '../lib/teams-api'
import { getOrgFlow, type OrgFlow } from '../lib/org-flow-api'
import { GRID_LENSES, MODE_STYLE, labelHex, labelKeyOf, type GridLens } from '../lib/org-flow-layout'
import { cn } from '../lib/utils'

type GridView = '2d' | '3d'

const PERIODS = [7, 30, 90] as const

function readLens(raw: string | null): GridLens {
  return GRID_LENSES.includes(raw as GridLens) ? (raw as GridLens) : 'flow'
}

function readDays(raw: string | null): number {
  const n = Number(raw)
  return (PERIODS as readonly number[]).includes(n) ? n : 7
}

/** Grid: from intake to result in 2D or 3D, with five lenses. Structure keeps the relation map. */
export default function OrgCanvasPage() {
  const { t } = useTranslation('nav')
  const [searchParams, setSearchParams] = useSearchParams()
  const { token } = useAuth()
  const lens = readLens(searchParams.get('lens'))
  const view: GridView = searchParams.get('view') === '3d' ? '3d' : '2d'
  const days = readDays(searchParams.get('days'))
  const isolated = lens === 'labels' ? searchParams.get('label') || null : null

  const [flow, setFlow] = useState<OrgFlow | null>(null)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)

  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    setSearchParams(next, { replace: true })
  }

  useEffect(() => {
    if (!token || lens === 'structure') return
    let alive = true
    setError('')
    getOrgFlow(token, days)
      .then((data) => {
        if (alive) setFlow(data)
      })
      .catch((err) => {
        if (alive) setError(formatApiErrorMessage(err, t('orgCanvas.loadError')))
      })
    return () => {
      alive = false
    }
  }, [token, days, lens, t])

  // "Open in Grid": select the node here, or show it on the relation map when the flow has no such node.
  const focusParam = searchParams.get('focus')?.trim() || null
  useEffect(() => {
    if (!flow || !focusParam || lens === 'structure') return
    if (flow.nodes.some((n) => n.id === focusParam)) {
      setSelectedId(focusParam)
      setParam({ focus: null })
    } else {
      setParam({ lens: 'structure' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, focusParam, lens])

  const labels = useMemo(() => {
    if (!flow) return []
    const volume = new Map<string, number>()
    for (const p of flow.paths) {
      if (!p.source.startsWith('channel:')) continue
      for (const [key, count] of Object.entries(p.by_label)) volume.set(key, (volume.get(key) ?? 0) + count)
    }
    return [...flow.labels].sort((a, b) => (volume.get(labelKeyOf(b)) ?? 0) - (volume.get(labelKeyOf(a)) ?? 0))
  }, [flow])

  const lensOptions = GRID_LENSES.map((value) => ({ value, label: t(`orgCanvas.lens.${value}`) }))

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-bg" data-testid="grid-page">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/40 px-4 pb-3 pt-3">
        <div className="min-w-0">
          <WorkforceSectionTabs className="-mx-1 mb-1.5" />
          <h1 className="text-sm font-semibold tracking-tight text-text-heading">{t('orgCanvas.title')}</h1>
          <p className="mt-0.5 text-[11px] leading-4 text-text-muted">
            {lens === 'structure'
              ? t('orgCanvas.structureSubtitle')
              : `${t('orgCanvas.subtitle')} ${t('orgCanvas.period', { count: days })}.`}
          </p>
          {lens !== 'structure' && flow?.estimated ? (
            <p className="mt-1 text-[11px] leading-4 text-status-warning" data-testid="grid-estimated">
              {t('orgCanvas.estimated')}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            size="sm"
            aria-label={t('orgCanvas.lensGroup')}
            value={lens}
            options={lensOptions}
            onChange={(value) => {
              setSelectedId(null)
              setParam({ lens: value === 'flow' ? null : value, label: null })
            }}
          />
          <SegmentedControl
            size="sm"
            aria-label={t('orgCanvas.viewGroup')}
            value={lens === 'structure' ? '3d' : view}
            options={[
              { value: '2d', label: t('orgCanvas.view.2d'), disabled: lens === 'structure' },
              { value: '3d', label: t('orgCanvas.view.3d') },
            ]}
            onChange={(value) => setParam({ view: value === '2d' ? null : value })}
          />
          {lens !== 'structure' ? (
            <SegmentedControl
              size="sm"
              aria-label={t('orgCanvas.periodGroup')}
              value={String(days)}
              options={PERIODS.map((n) => ({ value: String(n), label: t('orgCanvas.days', { count: n }) }))}
              onChange={(value) => setParam({ days: value === '7' ? null : value })}
            />
          ) : null}
        </div>
        {lens === 'structure' ? <p className="w-full text-right text-[11px] text-text-muted">{t('orgCanvas.structure3dOnly')}</p> : null}
        {lens === 'labels' && labels.length ? (
          <div className="flex w-full flex-wrap items-center gap-1.5" role="group" aria-label={t('orgCanvas.labelChips')} data-testid="grid-label-chips">
            {labels.map((label) => {
              const key = labelKeyOf(label)
              const active = isolated === key
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  data-label={key}
                  onClick={() => setParam({ label: active ? null : key })}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11.5px] leading-4 transition-colors',
                    active ? 'border-text-heading/40 bg-bg-elevated text-text-heading' : 'border-border/60 text-text-secondary hover:text-text-heading',
                    isolated && !active && 'opacity-50',
                  )}
                >
                  <span className="h-2 w-2 rounded-sm" style={{ background: labelHex(label.color) }} aria-hidden />
                  {label.id ? `#${label.name}` : t('orgCanvas.legendFlow.noLabel')}
                </button>
              )
            })}
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="px-4 pt-3">
          <ApiErrorBanner message={error} />
        </div>
      ) : null}

      {lens === 'structure' ? (
        <StructureLens />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <div className={cn('min-h-0 flex-1', view === '2d' ? 'overflow-auto px-2' : 'relative')}>
              {!flow ? (
                <OrgCanvasSkeleton />
              ) : view === '2d' ? (
                <OrgFlowBoard
                  data={flow}
                  lens={lens}
                  label={isolated}
                  selectedId={selectedId}
                  hoverId={hoverId}
                  onHover={setHoverId}
                  onSelect={setSelectedId}
                />
              ) : (
                <OrgFlowScene
                  data={flow}
                  lens={lens}
                  label={isolated}
                  selectedId={selectedId}
                  hoverId={hoverId}
                  onHover={setHoverId}
                  onSelect={setSelectedId}
                />
              )}
            </div>
            <FlowLegend lens={lens} />
          </div>
          <aside
            className="flex h-full w-72 shrink-0 flex-col overflow-y-auto border-l border-border/40 bg-bg-surface/95 px-4 py-4"
            aria-label={t('orgCanvas.panel.label')}
          >
            {flow ? (
              <OrgDetailPanel data={flow} selectedId={selectedId} lens={lens} onSelect={setSelectedId} onHover={setHoverId} />
            ) : (
              <OrgLegendSkeleton />
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

function FlowLegend({ lens }: { lens: GridLens }) {
  const { t } = useTranslation('nav')
  const hint =
    lens === 'labels'
      ? t('orgCanvas.legendFlow.labelsHint')
      : lens === 'issues'
        ? t('orgCanvas.legendFlow.issuesHint')
        : lens === 'autonomy'
          ? t('orgCanvas.legendFlow.autonomyHint')
          : null
  const modes = (['autonomous', 'assisted', 'human', 'none'] as const).map((mode) => ({ mode, style: MODE_STYLE[mode] }))
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border/40 px-4 py-2 text-xs text-text-secondary" data-testid="grid-legend">
      {lens !== 'labels'
        ? modes.map(({ mode, style }) => (
            <span key={mode} className="flex items-center gap-2">
              <svg aria-hidden width="32" height="10" viewBox="0 0 32 10">
                <path d="M2 5h28" stroke={style.color} strokeWidth={mode === 'none' ? 2 : 3} strokeDasharray={style.dash ?? undefined} strokeLinecap="round" />
              </svg>
              {t(`orgCanvas.mode.${mode}`)}
            </span>
          ))
        : null}
      <span className="flex items-center gap-2">
        <span className="rounded-md bg-bg-elevated px-1.5 py-px text-[11px] text-text-primary">{t('orgCanvas.result.worksIn')}</span>
        {t('orgCanvas.legendFlow.worksInBokito')}
      </span>
      <span className="flex items-center gap-2">
        <span className="rounded-md border border-border px-1.5 text-[11px] text-text-primary">{t('orgCanvas.result.worksIn')}</span>
        {t('orgCanvas.legendFlow.worksInConnection')}
      </span>
      {hint ? <span className="text-text-muted">{hint}</span> : null}
    </div>
  )
}

/** Structure lens: the relation map from `org/graph` (membership, owners, labels). */
function StructureLens() {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { token } = useAuth()
  const [graph, setGraph] = useState<OrgGraph | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null)
  const highlightRef = useRef<(id: string | null) => void>(() => {})
  const focusParam = searchParams.get('focus')?.trim() || null

  useEffect(() => {
    if (!token) return
    getOrgGraph(token)
      .then(setGraph)
      .catch((err) => setError(formatApiErrorMessage(err, t('orgCanvas.loadError'))))
  }, [token, t])

  const linkedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const edge of graph?.edges ?? []) {
      ids.add(edge.source)
      ids.add(edge.target)
    }
    return ids
  }, [graph])

  useEffect(() => {
    if (!graph || !focusParam) return
    if (!linkedIds.has(focusParam)) return
    setFocusNodeId(focusParam)
  }, [graph, focusParam, linkedIds])

  const clearFocusParam = () => {
    setFocusNodeId(null)
    if (!searchParams.has('focus')) return
    const next = new URLSearchParams(searchParams)
    next.delete('focus')
    setSearchParams(next, { replace: true })
  }

  const kindLabel = (kind: string) => t(`orgCanvas.kinds.${kind}`, { defaultValue: kind })

  const legendGroups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const onMap = (graph?.nodes ?? []).filter((node) => linkedIds.has(node.id))
    const filtered = needle
      ? onMap.filter((node) => {
          const kindName = t(`orgCanvas.kinds.${node.kind}`, { defaultValue: node.kind })
          return (
            node.label.toLowerCase().includes(needle) ||
            node.kind.toLowerCase().includes(needle) ||
            kindName.toLowerCase().includes(needle)
          )
        })
      : onMap
    const byKind = new Map<string, OrgGraphNode[]>()
    for (const node of filtered) {
      const list = byKind.get(node.kind) ?? []
      list.push(node)
      byKind.set(node.kind, list)
    }
    for (const list of byKind.values()) {
      list.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    }
    return ORG_KIND_ORDER.filter((kind) => byKind.has(kind)).map((kind) => ({ kind, nodes: byKind.get(kind) ?? [] }))
  }, [graph, linkedIds, query, t])

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {error ? (
          <div className="absolute inset-x-4 top-4 z-20">
            <ApiErrorBanner message={error} />
          </div>
        ) : null}
        {graph ? (
          <OrgMakeScene
            graph={graph}
            linkedIds={linkedIds}
            focusNodeId={focusNodeId}
            onFocused={clearFocusParam}
            highlightRef={highlightRef}
            kindLabel={kindLabel}
            openHint={t('orgCanvas.openHint')}
            onOpenNode={(node) => {
              if (node.href) navigate(node.href)
            }}
          />
        ) : (
          <OrgCanvasSkeleton />
        )}
      </div>
      <aside className="flex h-full w-64 shrink-0 flex-col border-l border-border/40 bg-bg-surface/95">
        <div className="border-b border-border/40 px-3 py-2.5">
          <h2 className="text-sm font-semibold tracking-tight text-text-heading">{t('orgCanvas.legend')}</h2>
          <p className="mt-0.5 text-[11px] leading-4 text-text-muted">{t('orgCanvas.legendHint')}</p>
          <label className="relative mt-2 block">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" strokeWidth={1.75} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('orgCanvas.findPlaceholder')}
              className="h-8 w-full rounded-md border border-border/40 bg-bg px-2 pl-7 text-xs text-text-heading outline-none placeholder:text-text-muted focus:border-accent/40"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          {!graph && !error ? (
            <OrgLegendSkeleton />
          ) : legendGroups.length === 0 ? (
            <p className="px-1.5 py-2 text-[11px] text-text-muted">{t('orgCanvas.findEmpty')}</p>
          ) : (
            legendGroups.map((group) => (
              <div key={group.kind} className="mb-2">
                <p className="px-1.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  {kindLabel(group.kind)}
                  <span className="ml-1 font-normal tabular-nums">({group.nodes.length})</span>
                </p>
                <ul>
                  {group.nodes.map((node) => (
                    <li key={node.id}>
                      <button
                        type="button"
                        title={t('orgCanvas.findAction', { name: node.label })}
                        onMouseEnter={() => highlightRef.current(node.id)}
                        onMouseLeave={() => highlightRef.current(null)}
                        onClick={() => setFocusNodeId(node.id)}
                        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-text-secondary hover:bg-bg-elevated hover:text-text-heading"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                          <OrgNodeFace node={node} size={16} />
                        </span>
                        <span className="truncate">{node.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  )
}
