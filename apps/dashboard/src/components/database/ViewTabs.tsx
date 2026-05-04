import { useMemo, useState } from 'react'
import { LayoutGrid, Columns3, Calendar, Plus, Loader2, Settings, GripVertical } from 'lucide-react'
import SemanticSearchBar from './SemanticSearchBar'
import type { SemanticSearchResult } from '../../types/custom-db'
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
import type { CustomView, ViewType } from '../../types/custom-db'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu'
import ConfirmDeleteDialog from '../ui/ConfirmDeleteDialog'

const VIEW_ICONS: Record<ViewType, React.ElementType> = {
  grid: LayoutGrid,
  kanban: Columns3,
  calendar: Calendar,
}

const VIEW_LABELS: Record<ViewType, string> = {
  grid: 'Grid',
  kanban: 'Kanban',
  calendar: 'Kalender',
}

function SortableViewTab({
  view,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  view: CustomView
  active: boolean
  onSelect: () => void
  onRename: (newName: string) => void
  onDelete: () => void
}) {
  const Icon = VIEW_ICONS[view.view_type] ?? LayoutGrid
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(view.name)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: view.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform ? { ...transform, y: 0 } : null),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  }

  const handleSaveEdit = () => {
    if (editName.trim() && editName.trim() !== view.name) {
      onRename(editName.trim())
    }
    setIsEditing(false)
    setEditName(view.name)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditName(view.name)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
    }
  }

  const isDefaultView = view.name === 'All records' || view.position === 0

  if (isEditing) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`group relative flex min-w-[112px] items-center justify-start gap-1 border-b-2 pl-3 pr-3 py-2 text-xs font-medium ${
          active
            ? 'border-accent text-accent'
            : 'border-transparent text-text-muted hover:text-text-primary hover:border-border'
        }`}
      >
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-black/5 text-text-muted"
        >
          <GripVertical size={11} />
        </span>
        <Icon size={13} />
        <Input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSaveEdit}
          className="h-6 text-xs border-none bg-transparent p-0 focus-visible:ring-1 focus-visible:ring-accent"
          autoFocus
        />
        <div className="flex items-center gap-1">
          <button
            onClick={handleSaveEdit}
            className="p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-accent"
          >
            <Check size={10} />
          </button>
          <button
            onClick={handleCancelEdit}
            className="p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-status-error"
          >
            <X size={10} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={`group relative flex min-w-[112px] items-center justify-start gap-1 border-b-2 pl-3 pr-3 py-2 text-xs font-medium transition-[padding,color,border-color] ${
          active
            ? 'border-accent text-accent'
            : 'border-transparent text-text-muted hover:text-text-primary hover:border-border'
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
          className="flex items-center gap-1 flex-1"
        >
          <Icon size={13} />
          {view.name}
        </button>
        
        {!isDefaultView && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-bg-hover"
                onClick={(e) => e.stopPropagation()}
              >
                <Settings size={11} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => setIsEditing(true)}>
                <Edit2 size={12} className="mr-2" />
                Rename view
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={() => setShowDeleteConfirm(true)}
                className="text-status-error focus:text-status-error"
              >
                <Trash2 size={12} className="mr-2" />
                Delete view
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      
      {showDeleteConfirm && (
        <ConfirmDeleteDialog
          title="Delete view?"
          itemLabel="the view"
          itemName={view.name}
          impactText="This action cannot be undone."
          isDeleting={false}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={() => {
            onDelete()
            setShowDeleteConfirm(false)
          }}
        />
      )}
    </>
  )
}

export default function ViewTabs({
  fieldsCount,
  onManageFields,
  onSemanticSearch,
}: {
  fieldsCount?: number
  onManageFields?: () => void
  onSemanticSearch?: (results: SemanticSearchResult[]) => void
}) {
  const { views, activeView, setActiveViewById, reorderViews, activeTable } = useDatabase()
  const [showAdd, setShowAdd] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const viewIds = useMemo(() => views.map((v) => v.id), [views])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      reorderViews(active.id as number, over.id as number)
    }
  }

  const isMagicTableActive = activeTable?.magic_table_config?.enabled

  const handleSemanticResults = (results: SemanticSearchResult[]) => {
    onSemanticSearch?.(results)
  }

  const handleSemanticClear = () => {
    onSemanticSearch?.([])
  }

  return (
    <div className="border-b border-border">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={viewIds} strategy={horizontalListSortingStrategy}>
              {views.map((view) => (
                <SortableViewTab
                  key={view.id}
                  view={view}
                  active={activeView?.id === view.id}
                  onSelect={() => setActiveViewById(view.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 px-2 py-2 text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            <Plus size={12} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          {isMagicTableActive && onSemanticSearch && (
            <SemanticSearchBar 
              onResults={handleSemanticResults}
              onClear={handleSemanticClear}
            />
          )}
          
          {onManageFields && typeof fieldsCount === 'number' && (
            <button
              type="button"
              onClick={onManageFields}
              className="text-[11px] text-text-muted hover:text-text-primary px-2 py-1 rounded hover:bg-bg-hover transition-colors"
            >
              {fieldsCount} velden
            </button>
          )}
        </div>
      </div>

      {showAdd && <AddViewDialog onClose={() => setShowAdd(false)} />}
    </div>
  )
}

function AddViewDialog({ onClose }: { onClose: () => void }) {
  const { addView, setActiveViewById } = useDatabase()
  const [name, setName] = useState('')
  const [viewType, setViewType] = useState<ViewType>('grid')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const v = await addView({ name: name.trim(), view_type: viewType, config: {} })
      setActiveViewById(v.id)
      onClose()
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle>Nieuwe view</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Naam</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bijv. Sprint Board" autoFocus />
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1.5 block">Type</label>
              <div className="flex gap-2">
                {(['grid', 'kanban', 'calendar'] as const).map((vt) => {
                  const Icon = VIEW_ICONS[vt]
                  return (
                    <button
                      key={vt}
                      type="button"
                      onClick={() => setViewType(vt)}
                      className={`flex-1 flex flex-col items-center gap-1 rounded-md border p-2.5 text-xs transition-colors ${
                        viewType === vt ? 'border-accent bg-accent/8 text-accent' : 'border-border hover:border-border-hover text-text-secondary'
                      }`}
                    >
                      <Icon size={18} />
                      {VIEW_LABELS[vt]}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={onClose}>Annuleren</Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving && <Loader2 size={14} className="animate-spin mr-1" />}
                Aanmaken
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
