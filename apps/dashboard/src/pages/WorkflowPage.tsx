import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { OrgFlowBoard } from '../components/org/OrgFlowBoard'
import { OrgFlowScene, type FlowZoomApi } from '../components/org/OrgFlowScene'
import { OrgDetailPanel, OrgIssuesList } from '../components/org/OrgDetailPanel'
import { AlertTriangle } from 'lucide-react'
import { Button } from '../components/ui/button'
import { OrgEdgeFades } from '../components/org/OrgEdgeFades'
import { ORG_FLOAT_GLASS, ORG_FLOAT_PANEL } from '../components/org/org-float-panel'
import { SegmentedControl } from '../components/ui/segmented-control'
import { OrgCanvasSkeleton, OrgLegendSkeleton } from '../components/ui/skeleton'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { useAuth } from '../context/AuthContext'
import { getOrgFlow, type OrgFlow } from '../lib/org-flow-api'
import { GRID_LENSES, MODE_STYLE, OTHER_LABEL_KEY, isFlowLabel, labelKeyOf, otherLabelCount, type GridLens } from '../lib/org-flow-layout'
import { TagPill } from '../components/ui/TagPill'
import type { LabelColor } from '../lib/signals-api'
import { orgGridPath } from '../lib/org-grid'
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

/** Workflow: from intake to result in 3D or 2D, with four lenses. The relation map lives on Grid. */
export default function WorkflowPage() {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { token } = useAuth()
  const lens = readLens(searchParams.get('lens'))
  const view: GridView = searchParams.get('view') === '2d' ? '2d' : '3d'
  const days = readDays(searchParams.get('days'))
  const isolated = lens === 'labels' ? searchParams.get('label') || null : null
  // From a department page: that department's lane stays lit.
  const department = searchParams.get('department') || null

  const [flow, setFlow] = useState<OrgFlow | null>(null)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [zoomPct, setZoomPct] = useState(100)
  const zoomApiRef = useRef<FlowZoomApi | null>(null)

  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    setSearchParams(next, { replace: true })
  }

  useEffect(() => {
    if (!token) return
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
  }, [token, days, t])

  // A focused node the flow does not have is shown on the relation map in Grid.
  const focusParam = searchParams.get('focus')?.trim() || null
  useEffect(() => {
    if (!selectedId) setIssuesOpen(false)
  }, [selectedId])

  useEffect(() => {
    if (!flow || !focusParam) return
    if (flow.nodes.some((n) => n.id === focusParam)) {
      setSelectedId(focusParam)
      setParam({ focus: null })
    } else {
      navigate(orgGridPath(focusParam), { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, focusParam])

  const labels = useMemo(() => {
    if (!flow) return []
    const volume = new Map<string, number>()
    for (const p of flow.paths) {
      if (!p.source.startsWith('channel:')) continue
      for (const [key, count] of Object.entries(p.by_label)) volume.set(key, (volume.get(key) ?? 0) + count)
    }
    return flow.labels
      .filter(isFlowLabel)
      .sort((a, b) => (volume.get(labelKeyOf(b)) ?? 0) - (volume.get(labelKeyOf(a)) ?? 0))
  }, [flow])

  const hasOther = useMemo(
    () => (flow ? flow.paths.some((p) => otherLabelCount(p.by_label, flow.labels) > 0) || flow.nodes.some((n) => otherLabelCount(n.open_by_label, flow.labels) > 0) : false),
    [flow],
  )

  const lensOptions = GRID_LENSES.map((value) => ({ value, label: t(`orgCanvas.lens.${value}`) }))

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-bg" data-testid="workflow-page">
      <div className={cn('absolute inset-0', view === '2d' && 'overflow-auto px-2 pt-16 pb-14')}>
        {error ? (
          <div className="absolute inset-x-4 top-16 z-20">
            <ApiErrorBanner message={error} />
          </div>
        ) : null}
        {!flow ? (
          <OrgCanvasSkeleton />
        ) : view === '2d' ? (
          <OrgFlowBoard
            data={flow}
            lens={lens}
            label={isolated}
            zone={department}
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
            zone={department}
            selectedId={selectedId}
            hoverId={hoverId}
            onHover={setHoverId}
            onSelect={setSelectedId}
            zoomApiRef={zoomApiRef}
            onZoomPct={setZoomPct}
          />
        )}
      </div>
      <OrgEdgeFades />
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4 pb-3 pt-3">
        <div className="pointer-events-auto flex flex-wrap items-start justify-end gap-3">
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
              value={view}
              options={[
                { value: '2d', label: t('orgCanvas.view.2d') },
                { value: '3d', label: t('orgCanvas.view.3d') },
              ]}
              onChange={(value) => setParam({ view: value === '3d' ? null : value })}
            />
            <SegmentedControl
              size="sm"
              aria-label={t('orgCanvas.periodGroup')}
              value={String(days)}
              options={PERIODS.map((n) => ({ value: String(n), label: t('orgCanvas.days', { count: n }) }))}
              onChange={(value) => setParam({ days: value === '7' ? null : value })}
            />
          </div>
          {lens === 'labels' && (labels.length || hasOther) ? (
            <div className="flex w-full flex-wrap items-center gap-1.5" role="group" aria-label={t('orgCanvas.labelChips')} data-testid="grid-label-chips">
              {labels.map((label) => {
                const key = labelKeyOf(label)
                const active = isolated === key
                return (
                  <TagPill
                    key={key}
                    names={label.name}
                    tone="action"
                    color={(label.color || '') as LabelColor}
                    icon={label.icon || undefined}
                    size="sm"
                    selected={active}
                    onClick={() => setParam({ label: active ? null : key })}
                    className={cn(active && 'ring-1 ring-text-heading/40', isolated && !active && 'opacity-40')}
                  />
                )
              })}
              {hasOther ? (
                <TagPill
                  names={t('orgCanvas.legendFlow.other')}
                  tone="free"
                  size="sm"
                  selected={isolated === OTHER_LABEL_KEY}
                  onClick={() => setParam({ label: isolated === OTHER_LABEL_KEY ? null : OTHER_LABEL_KEY })}
                  className={cn(isolated && isolated !== OTHER_LABEL_KEY && 'opacity-40')}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </header>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-3">
        <div className={cn('pointer-events-auto flex w-full items-center gap-2 rounded-full py-1 pl-4 pr-1.5', ORG_FLOAT_GLASS)}>
          <FlowLegend lens={lens} />
          {view === '3d' ? (
            <div className="ml-auto flex shrink-0 items-center gap-1 border-l border-border/40 pl-2">
              <Button variant="ghost" size="xs" type="button" className="px-2.5" onClick={() => zoomApiRef.current?.zoomBy(1 / 1.15)}>
                -
              </Button>
              <span className="min-w-[3rem] text-center text-2xs tabular-nums text-text-muted">{zoomPct}%</span>
              <Button variant="ghost" size="xs" type="button" className="px-2.5" onClick={() => zoomApiRef.current?.zoomBy(1.15)}>
                +
              </Button>
              <Button variant="ghost" size="xs" type="button" className="px-2.5" onClick={() => zoomApiRef.current?.reset()}>
                {t('orgCanvas.reset')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      {flow && selectedId && flow.issues.length ? (
        <IssuesSwap
          open={issuesOpen}
          count={flow.issues.length}
          label={t('orgCanvas.panel.showIssues', { count: flow.issues.length })}
          onToggle={() => setIssuesOpen((open) => !open)}
        >
          <OrgIssuesList data={flow} onSelect={setSelectedId} onHover={setHoverId} onClose={() => setIssuesOpen(false)} />
        </IssuesSwap>
      ) : null}
      <aside className={cn(ORG_FLOAT_PANEL, 'overflow-y-auto px-4 py-4')} aria-label={t('orgCanvas.panel.label')}>
        {flow ? (
          <OrgDetailPanel data={flow} selectedId={selectedId} onSelect={setSelectedId} onHover={setHoverId} />
        ) : (
          <OrgLegendSkeleton />
        )}
      </aside>
    </div>
  )
}

const ISSUES_OUT_MS = 120

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Chip and bottleneck list share one anchor. They crossfade with scale; width does not animate. */
function IssuesSwap({
  open,
  count,
  label,
  onToggle,
  children,
}: {
  open: boolean
  count: number
  label: string
  onToggle: () => void
  children: ReactNode
}) {
  const [view, setView] = useState<'chip' | 'panel'>(open ? 'panel' : 'chip')
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const next = open ? 'panel' : 'chip'
    if (next === view) return
    if (prefersReducedMotion()) {
      setView(next)
      setLeaving(false)
      return
    }
    setLeaving(true)
    const timer = window.setTimeout(() => {
      setView(next)
      setLeaving(false)
    }, ISSUES_OUT_MS)
    return () => window.clearTimeout(timer)
  }, [open, view])

  const motion = leaving ? 'animate-issues-out' : 'animate-issues-in'

  if (view === 'panel') {
    return (
      <aside
        className={cn(ORG_FLOAT_PANEL, 'right-[calc(1rem+18rem+0.5rem)] origin-top-right overflow-y-auto px-4 py-4', motion)}
        aria-label={label}
        data-testid="grid-issues-window"
      >
        {children}
      </aside>
    )
  }

  return (
    <button
      type="button"
      data-testid="grid-issues-button"
      aria-expanded={false}
      aria-label={label}
      disabled={leaving}
      onClick={onToggle}
      className={cn(
        'pointer-events-auto absolute top-16 z-20 flex h-8 origin-top-right items-center gap-1 rounded-full px-2.5 text-status-warning',
        'right-[calc(1rem+18rem+0.5rem)]',
        ORG_FLOAT_GLASS,
        motion,
      )}
    >
      <AlertTriangle size={14} />
      <span className="text-2xs font-semibold tabular-nums">{count}</span>
    </button>
  )
}

function FlowLegend({ lens }: { lens: GridLens }) {
  const { t } = useTranslation('nav')
  const hint =
    lens === 'labels'
      ? t('orgCanvas.legendFlow.labelsHint')
      : lens === 'autonomy'
        ? t('orgCanvas.legendFlow.autonomyHint')
        : null
  const modes = (['autonomous', 'assisted', 'human', 'none'] as const).map((mode) => ({ mode, style: MODE_STYLE[mode] }))
  return (
    <div
      className="inline-flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1.5 py-1.5 text-xs text-text-secondary"
      data-testid="grid-legend"
    >
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
      {hint ? <span className="text-text-muted">{hint}</span> : null}
    </div>
  )
}
