import { useCallback, useEffect, useMemo, useState } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Loader2, Unlink, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ApiErrorBanner, formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Hashtag } from '../ui/HashtagMark'
import { ChoiceSelect } from '../ui/ChoiceSelect'
import { TableRowsSkeleton } from '../ui/skeleton'
import { flowTitle } from '../../lib/flow-title'
import { useEntityRefresh } from '../../lib/live-store'
import {
  getProjectBoard,
  moveTicketToStage,
  stageLabel,
  type BoardTicket,
  type ProjectFlowBoard,
} from '../../lib/tickets-api'
import { listWorkstreams, patchWorkstream, type WorkstreamRow } from '../../lib/workstreams-api'
import { workstreamPath } from '../../lib/workstream-ui'
import { FlowTicketCard } from '../workstreams/FlowTicketCard'
import { StageProgressIcon } from '../workstreams/StageProgressIcon'
import { ProjectKanbanColumn } from './ProjectKanbanColumn'
import { useCollectStageFields } from '../inbox/TicketStageGate'

const COLUMN_PREFIX = 'stage-col:'

/**
 * One kanban per flow attached to the project, stacked. Columns are the
 * flow's own stages; a ticket shows here when it was filed on this project.
 * The project owns which flows it shows: attach and detach live here.
 */
export function ProjectFlowBoards({
  projectId,
  canEdit,
  onFlowsChanged,
}: {
  projectId: string
  canEdit: boolean
  onFlowsChanged?: () => void
}) {
  const { t } = useTranslation('nav')
  const [boards, setBoards] = useState<ProjectFlowBoard[]>([])
  const [flows, setFlows] = useState<WorkstreamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [boardRows, flowRows] = await Promise.all([
        getProjectBoard(projectId),
        canEdit ? listWorkstreams().catch(() => [] as WorkstreamRow[]) : Promise.resolve([] as WorkstreamRow[]),
      ])
      setBoards(boardRows)
      setFlows(flowRows)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.home.boardLoadError')))
    } finally {
      setLoading(false)
    }
  }, [projectId, canEdit, t])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useEntityRefresh(['ticket', 'project', 'tag'], () => void load(), { debounceMs: 800 })

  const available = useMemo(
    () =>
      flows
        .filter((flow) => !flow.project_ids.includes(projectId))
        .sort((a, b) => flowTitle(a).localeCompare(flowTitle(b))),
    [flows, projectId],
  )

  const setAttached = async (flowId: string, attach: boolean) => {
    const flow = flows.find((row) => row.id === flowId)
    if (!flow) return
    setBusy(flowId)
    try {
      const next = attach
        ? [...flow.project_ids, projectId]
        : flow.project_ids.filter((id) => id !== projectId)
      await patchWorkstream(flowId, { project_ids: next })
      await load()
      onFlowsChanged?.()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.home.flowLinkError')))
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <TableRowsSkeleton rows={3} />
  if (error) return <ApiErrorBanner message={error} onRetry={() => void load()} />

  return (
    <div className="space-y-5" data-testid="project-playbook-boards">
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <ChoiceSelect
            aria-label={t('projects.home.addFlow')}
            placeholder={t('projects.home.addFlow')}
            triggerClassName="h-8 w-56 text-xs"
            value=""
            onValueChange={(value) => void setAttached(value, true)}
            disabled={busy !== null}
            groups={[
              {
                items:
                  available.length === 0
                    ? [{ value: '__none__', label: t('projects.home.noFlowsToAdd'), kind: 'flow', disabled: true }]
                    : available.map((flow) => ({
                        value: flow.id,
                        label: flowTitle(flow),
                        kind: 'flow' as const,
                      })),
              },
            ]}
          />
          {busy ? <Loader2 size={14} className="animate-spin text-text-muted" /> : null}
        </div>
      ) : null}
      {boards.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-sm text-text-muted">
          {t('projects.home.boardsEmpty')}{' '}
          <Link to="/workstreams" className="font-medium text-accent hover:underline">
            {t('projects.home.boardsOpenPlaybooks')}
          </Link>
        </p>
      ) : (
        boards.map((board) => (
          <FlowBoardView
            key={board.workstream_id}
            board={board}
            canEdit={canEdit}
            detaching={busy === board.workstream_id}
            onDetach={() => void setAttached(board.workstream_id, false)}
            onChange={(next) =>
              setBoards((rows) => rows.map((row) => (row.workstream_id === next.workstream_id ? next : row)))
            }
          />
        ))
      )}
    </div>
  )
}

function FlowBoardView({
  board,
  canEdit,
  detaching,
  onDetach,
  onChange,
}: {
  board: ProjectFlowBoard
  canEdit: boolean
  detaching: boolean
  onDetach: () => void
  onChange: (board: ProjectFlowBoard) => void
}) {
  const { t } = useTranslation('nav')
  const collect = useCollectStageFields()
  const [busyId, setBusyId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const firstKey = board.stages[0]?.key ?? ''
  const stageKeys = new Set(board.stages.map((stage) => stage.key))

  const move = async (ticket: BoardTicket, stageKey: string) => {
    if (ticket.stage_key === stageKey) return
    const stage = board.stages.find((row) => row.key === stageKey)
    if (!stage) return
    setBusyId(ticket.signal_id)
    const previous = board
    try {
      const result = await moveTicketToStage({
        signalId: ticket.signal_id,
        stage,
        values: ticket.fields,
        collect,
        ticketName: ticket.tag,
      })
      if (result.cancelled) return
      onChange({
        ...board,
        tickets: board.tickets.map((row) =>
          row.signal_id === ticket.signal_id ? { ...row, stage_key: stageKey, status: stage.kind } : row,
        ),
      })
    } catch (err) {
      onChange(previous)
      toast.error(formatApiErrorMessage(err, t('projects.home.ticketMoveError')))
    } finally {
      setBusyId(null)
    }
  }

  const onDragEnd = (event: DragEndEvent) => {
    if (!canEdit) return
    const ticket = board.tickets.find((row) => row.signal_id === String(event.active.id))
    const overId = event.over?.id ? String(event.over.id) : ''
    if (!ticket || !overId.startsWith(COLUMN_PREFIX)) return
    void move(ticket, overId.slice(COLUMN_PREFIX.length))
  }

  return (
    <section className="space-y-2">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          to={workstreamPath(board.workstream_id)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-text-heading hover:text-accent"
        >
          <Workflow size={14} className="text-text-muted" aria-hidden />
          <Hashtag name={board.tags[0]?.name || board.name} category />
        </Link>
        {!board.enabled ? (
          <Badge variant="outline" className="px-1.5 py-0 text-2xs text-text-muted">
            {t('workstreamsPage.deactivated')}
          </Badge>
        ) : null}
        <span className="text-2xs tabular-nums text-text-muted">{board.tickets.length}</span>
        {canEdit ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-7 px-2 text-xs text-text-muted"
            disabled={detaching}
            onClick={onDetach}
          >
            {detaching ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Unlink size={12} className="mr-1" />}
            {t('projects.home.detachFlow')}
          </Button>
        ) : null}
      </header>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {board.stages.map((stage) => {
            const column = board.tickets.filter(
              (ticket) => (stageKeys.has(ticket.stage_key) ? ticket.stage_key : firstKey) === stage.key,
            )
            return (
              <ProjectKanbanColumn
                key={stage.key}
                id={`${COLUMN_PREFIX}${stage.key}`}
                title={stageLabel(stage, t)}
                marker={<StageProgressIcon kind={stage.kind} />}
                count={column.length}
                fill
                compact
              >
                {column.map((ticket) => (
                  <FlowTicketCard
                    key={ticket.signal_id}
                    ticket={ticket}
                    disabled={!canEdit || busyId === ticket.signal_id}
                  />
                ))}
              </ProjectKanbanColumn>
            )
          })}
        </div>
      </DndContext>
    </section>
  )
}
