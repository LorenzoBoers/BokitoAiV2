import { useCallback, useEffect, useState } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { toast } from 'sonner'
import { ApiErrorBanner, formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Hashtag } from '../ui/HashtagMark'
import { KanbanColumnsSkeleton } from '../ui/skeleton'
import { useEntityRefresh } from '../../lib/live-store'
import {
  getProjectBoard,
  moveTicketToStage,
  stageLabel,
  type BoardTicket,
  type ProjectFlowBoard,
} from '../../lib/tickets-api'
import { workstreamPath } from '../../lib/workstream-ui'
import { FlowTicketCard } from '../workstreams/FlowTicketCard'
import { waitingStageFill } from '../../lib/stage-order'
import { StageProgressIcon } from '../workstreams/StageProgressIcon'
import { ProjectKanbanColumn } from './ProjectKanbanColumn'
import { useCollectStageFields } from '../inbox/TicketStageGate'

const Workflow = ENTITY_ICONS.flow

const COLUMN_PREFIX = 'stage-col:'

/**
 * Stacked kanban boards for flows that already have a ticket in this folder
 * (or a folder under it). Membership comes from those threads — not from
 * attaching a flow to the folder.
 */
export function ProjectFlowBoards({
  projectId,
  canEdit,
}: {
  projectId: string
  canEdit: boolean
  onFlowsChanged?: () => void
}) {
  const { t } = useTranslation('nav')
  const [boards, setBoards] = useState<ProjectFlowBoard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const rows = await getProjectBoard(projectId)
      setBoards(rows.filter((row) => row.tickets.length > 0))
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.home.boardLoadError')))
    } finally {
      setLoading(false)
    }
  }, [projectId, t])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useEntityRefresh(['ticket', 'project', 'tag'], () => void load(), { debounceMs: 800 })

  if (loading) return <KanbanColumnsSkeleton />
  if (error) return <ApiErrorBanner message={error} onRetry={() => void load()} />

  return (
    <div className="space-y-5" data-testid="project-playbook-boards">
      {boards.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-sm text-text-muted">
          {t('projects.home.boardsEmpty')}
        </p>
      ) : (
        boards.map((board) => (
          <FlowBoardView
            key={board.workstream_id}
            board={board}
            canEdit={canEdit}
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
  onChange,
}: {
  board: ProjectFlowBoard
  canEdit: boolean
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
          className="inline-flex items-center gap-1.5 no-underline"
        >
          <Workflow size={14} className="text-text-muted" aria-hidden />
          <Hashtag name={board.tags[0]?.name || board.name} category />
        </Link>
        <span className="text-2xs tabular-nums text-text-muted">{board.tickets.length}</span>
      </header>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {board.stages.map((stage, index) => {
            const column = board.tickets.filter(
              (ticket) => (stageKeys.has(ticket.stage_key) ? ticket.stage_key : firstKey) === stage.key,
            )
            return (
              <ProjectKanbanColumn
                key={stage.key}
                id={`${COLUMN_PREFIX}${stage.key}`}
                title={stageLabel(stage, t)}
                marker={<StageProgressIcon kind={stage.kind} fill={waitingStageFill(board.stages, index)} />}
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
