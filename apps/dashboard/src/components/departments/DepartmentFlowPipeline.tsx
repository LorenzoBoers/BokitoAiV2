import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight } from 'lucide-react'
import { Card } from '../ui/card'
import { Badge } from '../ui/badge'
import { StageProgressIcon } from '../flows/StageProgressIcon'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import type { DepartmentFlow, DepartmentStage } from '../../lib/teams-api'
import { cn } from '../../lib/utils'

const FlowIcon = ENTITY_ICONS.flow

const NODE_RING: Record<DepartmentStage['kind'], string> = {
  open: 'border-text-muted/60',
  waiting: 'border-status-warning/70',
  done: 'border-status-success/70',
  closed: 'border-status-success/50',
}

const BAR: Record<DepartmentStage['kind'], string> = {
  open: 'bg-text-muted/50',
  waiting: 'bg-status-warning/80',
  done: 'bg-status-success/80',
  closed: 'bg-status-success/50',
}

function pct(value: number | undefined): string {
  return value == null ? '-' : `${Math.round(value)}%`
}

/** One flow as a pipeline: a node per stage with its open tickets, and the spread across stages. */
export function DepartmentFlowPipeline({ flow }: { flow: DepartmentFlow }) {
  const { t } = useTranslation('nav')
  const live = flow.stages.reduce((sum, stage) => sum + stage.count, 0)
  const last = flow.stages.length - 1

  return (
    <Card className="space-y-4 p-4" data-testid="department-flow">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <FlowIcon size={16} className="shrink-0 text-text-muted" aria-hidden />
          <Link to={flow.board_href} className="truncate text-sm font-semibold text-text-heading hover:text-accent">
            {flow.name}
          </Link>
          {flow.label ? <span className="shrink-0 text-xs text-text-muted">{flow.label.replace(/^#/, '')}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge size="sm">
            {flow.open} {t('departmentPage.totals.open').toLowerCase()}
          </Badge>
          <Badge size="sm">
            {flow.waiting} {t('departmentPage.totals.waiting').toLowerCase()}
          </Badge>
          {flow.overdue ? (
            <Badge size="sm" variant="warning">
              {t('departmentPage.today.overdue', { count: flow.overdue })}
            </Badge>
          ) : null}
          {flow.scorecard ? (
            <>
              <Badge size="sm" variant="accent">
                {t('departmentPage.columns.autonomous')} {pct(flow.scorecard.autonomous_pct)}
              </Badge>
              <Badge size="sm">
                {t('departmentPage.columns.corrected')} {pct(flow.scorecard.corrected_pct)}
              </Badge>
              <Badge size="sm">
                {t('departmentPage.columns.volume')} {flow.scorecard.volume ?? 0}
              </Badge>
            </>
          ) : null}
          <Link
            to={flow.board_href}
            className="inline-flex items-center gap-0.5 pl-1 text-text-muted hover:text-accent"
          >
            {t('departmentPage.openBoard')}
            <ArrowUpRight size={12} aria-hidden />
          </Link>
        </div>
      </div>

      {flow.stages.length ? (
        <div className="overflow-x-auto">
          <ol className="flex min-w-max" data-testid="department-flow-stages">
            {flow.stages.map((stage, index) => (
              <li
                key={stage.key}
                className="flex min-w-[6.5rem] flex-1 flex-col items-center text-center"
                title={t('departmentPage.stageTitle', { overdue: stage.overdue, soon: stage.soon })}
              >
                <div className="flex w-full items-center">
                  <span className={cn('h-px flex-1', index === 0 ? 'bg-transparent' : 'bg-border')} />
                  <span
                    className={cn(
                      'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-base font-semibold tabular-nums',
                      stage.count
                        ? cn(NODE_RING[stage.kind], 'bg-bg-elevated text-text-heading')
                        : 'border-border/50 bg-bg-surface text-text-muted',
                    )}
                  >
                    {stage.count}
                    {stage.overdue ? (
                      <span
                        className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-surface bg-status-warning"
                        aria-hidden
                      />
                    ) : null}
                  </span>
                  <span className={cn('h-px flex-1', index === last ? 'bg-transparent' : 'bg-border')} />
                </div>
                <span className="mt-2 inline-flex max-w-full items-center gap-1 px-1 text-xs text-text-secondary">
                  <StageProgressIcon kind={stage.kind} size={12} />
                  <span className="truncate">{stage.name}</span>
                </span>
                {stage.overdue ? (
                  <span className="text-2xs text-status-warning">
                    {t('departmentPage.today.overdue', { count: stage.overdue })}
                  </span>
                ) : stage.soon ? (
                  <span className="text-2xs text-text-muted">
                    {t('departmentPage.today.due_this_week', { count: stage.soon })}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {live > 0 ? (
        <div className="flex h-1.5 overflow-hidden rounded-full bg-bg-elevated" aria-hidden>
          {flow.stages
            .filter((stage) => stage.count > 0)
            .map((stage) => (
              <span
                key={stage.key}
                className={cn('h-full', BAR[stage.kind])}
                style={{ width: `${(stage.count / live) * 100}%` }}
              />
            ))}
        </div>
      ) : null}
    </Card>
  )
}
