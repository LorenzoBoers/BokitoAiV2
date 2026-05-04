import { useState, useCallback } from 'react'
import { Plus, X, GripVertical, ArrowUp, ArrowDown, Trash2 } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import type { SortCriteria, CustomField } from '../../types/custom-db'

interface SortBuilderProps {
  sorts: SortCriteria[]
  fields: CustomField[]
  onChange: (sorts: SortCriteria[]) => void
  onClose: () => void
}

function generateId(): string {
  return Math.random().toString(36).substr(2, 9)
}

interface SortCriteriaWithId extends SortCriteria {
  id: string
}

export default function SortBuilder({ sorts, fields, onChange, onClose }: SortBuilderProps) {
  const [localSorts, setLocalSorts] = useState<SortCriteriaWithId[]>(() => 
    sorts.map(sort => ({ ...sort, id: generateId() }))
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleSave = useCallback(() => {
    const cleanSorts = localSorts
      .filter(sort => sort.fieldSlug && fields.find(f => f.slug === sort.fieldSlug))
      .map(({ id, ...sort }) => sort)
    onChange(cleanSorts)
    onClose()
  }, [localSorts, fields, onChange, onClose])

  const handleClearAll = useCallback(() => {
    onChange([])
    onClose()
  }, [onChange, onClose])

  const addSort = useCallback(() => {
    if (fields.length === 0) return
    const newSort: SortCriteriaWithId = {
      id: generateId(),
      fieldSlug: fields[0].slug,
      direction: 'asc'
    }
    setLocalSorts(prev => [...prev, newSort])
  }, [fields])

  const updateSort = useCallback((id: string, updates: Partial<SortCriteriaWithId>) => {
    setLocalSorts(prev => prev.map(sort => 
      sort.id === id ? { ...sort, ...updates } : sort
    ))
  }, [])

  const removeSort = useCallback((id: string) => {
    setLocalSorts(prev => prev.filter(sort => sort.id !== id))
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    setLocalSorts(prev => {
      const oldIndex = prev.findIndex(sort => sort.id === active.id)
      const newIndex = prev.findIndex(sort => sort.id === over.id)
      
      if (oldIndex === -1 || newIndex === -1) return prev
      
      const result = [...prev]
      const [removed] = result.splice(oldIndex, 1)
      result.splice(newIndex, 0, removed)
      return result
    })
  }, [])

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Sort</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <X size={14} />
          </button>
        </CardHeader>
        <CardContent className="space-y-4">
          {localSorts.length === 0 ? (
            <div className="text-center py-8 text-text-muted">
              <ArrowUpDown size={24} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No sort criteria defined</p>
              <p className="text-xs">Add criteria to sort your data</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-text-muted mb-3">
                Sort order (drag to reorder):
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={localSorts.map(s => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {localSorts.map((sort, index) => (
                    <SortableItem
                      key={sort.id}
                      sort={sort}
                      fields={fields}
                      index={index}
                      onChange={(updates) => updateSort(sort.id, updates)}
                      onRemove={() => removeSort(sort.id)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          )}

          <Button size="sm" variant="ghost" onClick={addSort} className="w-full">
            <Plus size={12} className="mr-1" />
            Add sort criteria
          </Button>
          
          <div className="flex justify-between items-center pt-4 border-t border-border">
            <Button variant="ghost" onClick={handleClearAll}>
              Clear all
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSave}>
                Apply sort
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

interface SortableItemProps {
  sort: SortCriteriaWithId
  fields: CustomField[]
  index: number
  onChange: (updates: Partial<SortCriteriaWithId>) => void
  onRemove: () => void
}

function SortableItem({ sort, fields, index, onChange, onRemove }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sort.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const field = fields.find(f => f.slug === sort.fieldSlug)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-3 border border-border rounded-lg bg-bg-sidebar/20"
    >
      <div className="flex items-center gap-2 text-text-muted">
        <span className="text-xs font-medium w-4 text-center">{index + 1}</span>
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-bg-hover"
        >
          <GripVertical size={12} />
        </button>
      </div>

      <div className="flex items-center gap-2 flex-1">
        <Select value={sort.fieldSlug} onValueChange={(fieldSlug) => onChange({ fieldSlug })}>
          <SelectTrigger className="flex-1 h-8 text-xs">
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

        <Select 
          value={sort.direction} 
          onValueChange={(direction: 'asc' | 'desc') => onChange({ direction })}
        >
          <SelectTrigger className="w-32 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asc">
              <div className="flex items-center gap-2">
                <ArrowUp size={12} />
                A → Z
              </div>
            </SelectItem>
            <SelectItem value="desc">
              <div className="flex items-center gap-2">
                <ArrowDown size={12} />
                Z → A
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button size="sm" variant="ghost" onClick={onRemove}>
        <Trash2 size={12} />
      </Button>
    </div>
  )
}