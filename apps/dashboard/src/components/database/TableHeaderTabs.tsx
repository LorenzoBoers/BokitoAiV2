import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Table2, GripVertical, Wand2, Edit3 } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useDatabase } from '../../context/DatabaseContext'
import type { CustomTable } from '../../types/custom-db'
import { Button } from '../ui/button'
import CreateTableDialog from './CreateTableDialog'
import TableSettingsDropdown from './TableSettingsDropdown'
import TableDescriptionDialog from './TableDescriptionDialog'

function SortableTableTab({
  table,
  active,
  onSelect,
  onEditDescription,
}: {
  table: CustomTable
  active: boolean
  onSelect: () => void
  onEditDescription: (table: CustomTable) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: table.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform ? { ...transform, y: 0 } : null),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} className="group flex-shrink-0">
      <div
        className={`inline-flex items-center gap-1.5 rounded-md pl-1.5 pr-1 py-1.5 text-xs transition-colors border ${
          active
            ? 'bg-accent/10 text-accent border-accent/25'
            : 'bg-bg-sidebar/40 text-text-secondary border-border hover:bg-bg-hover hover:text-text-primary'
        }`}
      >
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-black/5 text-text-muted"
        >
          <GripVertical size={11} />
        </span>
        <button
          type="button"
          onClick={onSelect}
          className="inline-flex items-center gap-1.5 bg-transparent border-none p-0 cursor-pointer"
          title={table.description || table.name}
        >
          <div className="relative">
            <Table2 size={13} style={table.color ? { color: table.color } : undefined} />
            {table.magic_table_config?.enabled && (
              <Wand2 
                size={8} 
                className="absolute -top-1 -right-1 text-purple-500 bg-white rounded-full p-0.5" 
              />
            )}
          </div>
          <span className="truncate max-w-[140px]">{table.name}</span>
        </button>
        <div className={`flex items-center gap-1 transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onEditDescription(table)
            }}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="Beschrijving bewerken"
          >
            <Edit3 size={11} />
          </button>
          <TableSettingsDropdown table={table} />
        </div>
      </div>
    </div>
  )
}

export default function TableHeaderTabs() {
  const navigate = useNavigate()
  const { tables, activeTable, setActiveTableById, reorderTables } = useDatabase()
  const [showCreate, setShowCreate] = useState(false)
  const [editingDescription, setEditingDescription] = useState<CustomTable | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const tableIds = useMemo(() => tables.map((t) => t.id), [tables])

  const handleSelectTable = (tableId: number, tableSlug: string) => {
    setActiveTableById(tableId)
    navigate(`/database/${tableSlug}`)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      reorderTables(active.id as number, over.id as number)
    }
  }

  return (
    <>
      <div className="border-b border-border px-3 py-2 relative">
        <div className="flex items-center justify-center">
          <div className="w-fit max-w-full overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex items-center gap-1 px-0.5">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={tableIds} strategy={horizontalListSortingStrategy}>
                  {tables.map((table) => (
                    <SortableTableTab
                      key={table.id}
                      table={table}
                      active={activeTable?.id === table.id}
                      onSelect={() => handleSelectTable(table.id, table.slug)}
                      onEditDescription={setEditingDescription}
                    />
                  ))}
                </SortableContext>
              </DndContext>

              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs flex-shrink-0"
                onClick={() => setShowCreate(true)}
              >
                <Plus size={12} className="mr-1" />
                Tabel
              </Button>
            </div>
          </div>
        </div>
      </div>

      {showCreate && <CreateTableDialog onClose={() => setShowCreate(false)} />}
      {editingDescription && (
        <TableDescriptionDialog
          table={editingDescription}
          onClose={() => setEditingDescription(null)}
        />
      )}
    </>
  )
}
