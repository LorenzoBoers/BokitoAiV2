import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Settings } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useDatabase } from '../../context/DatabaseContext'
import type { CustomField, CustomRecord, KanbanViewConfig, SelectOption } from '../../types/custom-db'
import CellRenderer from './cells/CellRenderer'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Button } from '../ui/button'

export default function KanbanView() {
  const { fields, filteredRecords, activeView, editRecord, editView } = useDatabase()

  const config = (activeView?.config ?? {}) as KanbanViewConfig
  const collapsedColumns = config.collapsedColumns ?? []
  
  // Available fields for grouping (select fields only)
  const selectFields = fields.filter(f => f.field_type === 'select')
  
  const groupField = fields.find((f) => f.slug === config.groupByFieldSlug && f.field_type === 'select')
    ?? selectFields[0]
  const titleField = fields.find((f) => f.slug === config.cardTitleFieldSlug) ?? fields[0]
  
  // Available fields for card display
  const cardFields = config.cardFields ?? []
  const availableCardFields = fields.filter(f => 
    f.id !== groupField?.id && 
    f.id !== titleField?.id && 
    f.field_type !== 'formula'
  )

  const columns = useMemo<(SelectOption & { records: CustomRecord[] })[]>(() => {
    if (!groupField) return []
    const opts = groupField.config?.options ?? []
    const uncategorized: CustomRecord[] = []
    const buckets = new Map<string, CustomRecord[]>()
    opts.forEach((o) => buckets.set(o.value, []))

    for (const rec of filteredRecords) {
      const val = rec.data?.[groupField.slug]
      if (typeof val === 'string' && buckets.has(val)) {
        buckets.get(val)!.push(rec)
      } else {
        uncategorized.push(rec)
      }
    }

    const result = opts.map((o) => ({ ...o, records: buckets.get(o.value)! }))
    if (uncategorized.length > 0) {
      result.push({ value: '__none__', label: 'Geen status', color: '#64748b', records: uncategorized })
    }
    return result
  }, [groupField, filteredRecords])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [draggingRecord, setDraggingRecord] = useState<CustomRecord | null>(null)

  const handleGroupByChange = async (fieldSlug: string) => {
    if (!activeView) return
    await editView(activeView.id, {
      config: {
        ...config,
        groupByFieldSlug: fieldSlug,
        // Reset collapsed columns when changing group field
        collapsedColumns: []
      }
    })
  }

  const handleTitleFieldChange = async (fieldSlug: string) => {
    if (!activeView) return
    await editView(activeView.id, {
      config: {
        ...config,
        cardTitleFieldSlug: fieldSlug
      }
    })
  }

  const handleCardFieldsChange = async (fieldSlugs: string[]) => {
    if (!activeView) return
    await editView(activeView.id, {
      config: {
        ...config,
        cardFields: fieldSlugs
      }
    })
  }

  const toggleColumnCollapse = async (columnValue: string) => {
    if (!activeView) return
    const newCollapsed = collapsedColumns.includes(columnValue)
      ? collapsedColumns.filter(c => c !== columnValue)
      : [...collapsedColumns, columnValue]
    
    await editView(activeView.id, {
      config: {
        ...config,
        collapsedColumns: newCollapsed
      }
    })
  }

  const handleDragStart = (event: DragStartEvent) => {
    const rec = filteredRecords.find((r) => r.id === Number(event.active.id))
    setDraggingRecord(rec ?? null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingRecord(null)
    const { active, over } = event
    if (!over || !groupField) return

    const overStr = String(over.id)
    const colValue = overStr.startsWith('col-') ? overStr.replace('col-', '') : null
    if (!colValue || colValue === '__none__') return

    const recordId = Number(active.id)
    const record = filteredRecords.find((r) => r.id === recordId)
    if (!record || record.data?.[groupField.slug] === colValue) return

    void editRecord(recordId, { [groupField.slug]: colValue })
  }

  if (selectFields.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        <div className="text-center">
          <p>Voeg een Select-veld toe om de Kanban-view te gebruiken.</p>
          <p className="text-xs mt-1">Records worden gegroepeerd op de opties van dat veld.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Kanban Configuration Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-sidebar/30">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">Group by:</span>
            <Select value={groupField?.slug ?? ''} onValueChange={handleGroupByChange}>
              <SelectTrigger className="w-40 h-7 text-xs">
                <SelectValue placeholder="Select field" />
              </SelectTrigger>
              <SelectContent>
                {selectFields.map(field => (
                  <SelectItem key={field.id} value={field.slug}>
                    {field.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">Title field:</span>
            <Select value={titleField?.slug ?? ''} onValueChange={handleTitleFieldChange}>
              <SelectTrigger className="w-40 h-7 text-xs">
                <SelectValue placeholder="Select field" />
              </SelectTrigger>
              <SelectContent>
                {fields.map(field => (
                  <SelectItem key={field.id} value={field.slug}>
                    {field.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="text-xs text-text-muted">
          {filteredRecords.length} cards across {columns.length} columns
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex-1 overflow-x-auto p-4">
          <div className="flex gap-3 min-h-[400px]">
            {columns.map((col) => (
              <KanbanColumn 
                key={col.value} 
                column={col} 
                titleField={titleField} 
                groupField={groupField!}
                cardFields={cardFields}
                availableCardFields={availableCardFields}
                isCollapsed={collapsedColumns.includes(col.value)}
                onToggleCollapse={() => toggleColumnCollapse(col.value)}
                onCardFieldsChange={handleCardFieldsChange}
              />
            ))}
          </div>
        </div>
        <DragOverlay>
          {draggingRecord && titleField && (
            <div className="bg-bg-elevated border border-border rounded-md shadow-lg p-3 w-[260px] opacity-90">
              <div className="text-xs font-medium text-text-heading truncate">
                {String(draggingRecord.data?.[titleField.slug] ?? 'Untitled')}
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function KanbanColumn({
  column,
  titleField,
  groupField,
  cardFields,
  availableCardFields,
  isCollapsed,
  onToggleCollapse,
  onCardFieldsChange,
}: {
  column: SelectOption & { records: CustomRecord[] }
  titleField: CustomField | undefined
  groupField: CustomField
  cardFields: string[]
  availableCardFields: CustomField[]
  isCollapsed: boolean
  onToggleCollapse: () => void
  onCardFieldsChange: (fieldSlugs: string[]) => void
}) {
  const recordIds = column.records.map((r) => String(r.id))

  return (
    <div className={`flex-shrink-0 bg-bg-sidebar/50 rounded-lg border border-border flex flex-col ${
      isCollapsed ? 'w-[60px]' : 'w-[280px]'
    }`}>
      <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
        <button
          onClick={onToggleCollapse}
          className="text-text-muted hover:text-text-primary transition-colors"
        >
          {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: column.color }} />
        {!isCollapsed && (
          <>
            <span className="text-xs font-semibold text-text-heading">{column.label}</span>
            <span className="text-[10px] text-text-muted ml-auto">{column.records.length}</span>
          </>
        )}
        {isCollapsed && (
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-semibold text-text-heading writing-mode-vertical-rl text-orientation-mixed">
              {column.label}
            </span>
            <span className="text-[9px] text-text-muted mt-1">{column.records.length}</span>
          </div>
        )}
      </div>
      
      {!isCollapsed && (
        <SortableContext items={recordIds} strategy={verticalListSortingStrategy}>
          <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px]" data-column={column.value}>
            {column.records.map((record) => (
              <KanbanCard 
                key={record.id} 
                record={record} 
                titleField={titleField} 
                cardFields={cardFields}
                availableCardFields={availableCardFields}
                groupField={groupField} 
              />
            ))}
            <div
              className="h-[60px] rounded-md border-2 border-dashed border-transparent"
              data-droppable-id={`col-${column.value}`}
            />
          </div>
        </SortableContext>
      )}
    </div>
  )
}

function KanbanCard({
  record,
  titleField,
  cardFields,
  availableCardFields,
  groupField,
}: {
  record: CustomRecord
  titleField: CustomField | undefined
  cardFields: string[]
  availableCardFields: CustomField[]
  groupField: CustomField
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(record.id) })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  // Get fields to display on card (up to 3)
  const displayFields = cardFields.length > 0
    ? availableCardFields.filter(f => cardFields.includes(f.slug)).slice(0, 3)
    : availableCardFields.slice(0, 3)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="bg-bg-elevated border border-border rounded-md p-3 cursor-grab active:cursor-grabbing hover:border-border-hover transition-colors"
    >
      <div className="text-xs font-medium text-text-heading truncate mb-1.5">
        {titleField ? String(record.data?.[titleField.slug] ?? '') || 'Untitled' : `Record #${record.id}`}
      </div>
      {displayFields.map((field) => (
        <div key={field.id} className="flex items-center gap-1.5 mt-1">
          <span className="text-[10px] text-text-muted flex-shrink-0">{field.name}:</span>
          <span className="text-[11px] truncate">
            <CellRenderer field={field} value={record.data?.[field.slug]} />
          </span>
        </div>
      ))}
    </div>
  )
}
