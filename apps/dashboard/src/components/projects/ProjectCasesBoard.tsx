import { useCallback, useEffect, useMemo, useState } from 'react'
import { DndContext, PointerSensor, useDraggable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '../ui/badge'
import { ApiErrorBanner, formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { TableRowsSkeleton } from '../ui/skeleton'
import { inboxPath } from '../../lib/messages-paths'
import { listCases, patchCase, type CaseRow, type CaseStatus } from '../../lib/cases-api'
import { cn } from '../../lib/utils'
import { ProjectKanbanColumn } from './ProjectKanbanColumn'

// Columns are stage kinds, so tickets from different playbooks share one board;
// dropping a ticket moves it to the first stage of that kind in its own playbook.
const CASE_STATUS_ORDER: CaseStatus[] = ['open', 'waiting', 'done']

function columnId(status: CaseStatus) {
  return `case-col:${status}`
}

function parseColumn(overId: string | undefined): CaseStatus | null {
  if (!overId?.startsWith('case-col:')) return null
  const status = overId.slice('case-col:'.length)
  return CASE_STATUS_ORDER.includes(status as CaseStatus) ? (status as CaseStatus) : null
}

export function ProjectCasesBoard({
  projectId,
  canEdit,
}: {
  projectId: string
  canEdit: boolean
}) {
  const { t } = useTranslation('nav')
  const [items, setItems] = useState<CaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const load = useCallback(async () => {
    setError(null)
    try {
      setItems(await listCases({ projectId, ticketsOnly: true, limit: 200 }))
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.home.signalsLoadError')))
    } finally {
      setLoading(false)
    }
  }, [projectId, t])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const byStatus = useMemo(() => {
    const map = new Map<CaseStatus, CaseRow[]>()
    for (const status of CASE_STATUS_ORDER) map.set(status, [])
    for (const item of items) {
      const status = CASE_STATUS_ORDER.includes(item.status) ? item.status : 'open'
      map.get(status)?.push(item)
    }
    return map
  }, [items])

  const move = async (item: CaseRow, status: CaseStatus) => {
    if (item.status === status) return
    setBusyId(item.id)
    const previous = items
    setItems((rows) => rows.map((row) => (row.id === item.id ? { ...row, status } : row)))
    try {
      const updated = await patchCase(item.id, { status })
      if (!('removed' in updated)) {
        setItems((rows) => rows.map((row) => (row.id === item.id ? { ...row, ...updated } : row)))
      }
    } catch (err) {
      setItems(previous)
      toast.error(formatApiErrorMessage(err, t('projects.home.signalsMoveError')))
    } finally {
      setBusyId(null)
    }
  }

  const onDragEnd = (event: DragEndEvent) => {
    if (!canEdit) return
    const item = items.find((row) => row.id === String(event.active.id))
    const dest = parseColumn(event.over?.id ? String(event.over.id) : undefined)
    if (!item || !dest) return
    void move(item, dest)
  }

  if (loading) return <TableRowsSkeleton rows={3} />
  if (error) return <ApiErrorBanner message={error} onRetry={() => void load()} />

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {CASE_STATUS_ORDER.map((status) => {
          const column = byStatus.get(status) ?? []
          return (
            <ProjectKanbanColumn
              key={status}
              id={columnId(status)}
              title={t(`projects.home.signalStatus.${status}`)}
              count={column.length}
              fill
            >
              {column.map((item) => (
                <CaseKanbanCard
                  key={item.id}
                  item={item}
                  disabled={!canEdit || busyId === item.id}
                />
              ))}
            </ProjectKanbanColumn>
          )
        })}
      </div>
    </DndContext>
  )
}

function CaseKanbanCard({ item, disabled }: { item: CaseRow; disabled: boolean }) {
  const { t } = useTranslation('nav')
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    disabled,
  })
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined
  const typeName = item.case_type?.name
  const title = item.title || item.signal_subject || typeName || t('projects.home.signalUntitled')

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-md border border-border/60 bg-bg-surface px-2 py-1.5 shadow-sm',
        isDragging && 'z-20 opacity-80 shadow-md',
        disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
      )}
      {...listeners}
      {...attributes}
    >
      <p className="truncate text-xs font-medium text-text-primary">{title}</p>
      <div className="mt-1 flex items-center gap-1.5">
        {typeName ? (
          <Badge variant="neutral" className="px-1.5 py-0 text-2xs">
            {typeName}
          </Badge>
        ) : null}
        {item.stage ? <span className="truncate text-2xs text-text-muted">{item.stage.name}</span> : null}
        <Link
          to={inboxPath('all', item.signal_id)}
          className="ml-auto inline-flex items-center text-text-muted hover:text-accent"
          title={t('projects.work.openThread')}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <MessageSquare size={12} />
        </Link>
      </div>
    </article>
  )
}
