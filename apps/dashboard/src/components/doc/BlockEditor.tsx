import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { cn } from '../../lib/utils'
import {
  applyBlockOps,
  type DocBlockRow,
  type DocBlockType,
  type InlineRun,
} from '../../lib/doc-api'
import { applyWorkspaceBlockOps, isWorkspaceDocVersionConflict } from '../../lib/workspace-doc-api'
import { diffBlockLists, newBlockId, renderInlineText } from '../../lib/doc-blocks'
import { BlockTypeMenu } from './BlockTypeMenu'

interface BlockEditorProps {
  projectId?: string
  pageId: string
  initialBlocks: DocBlockRow[]
  docScope?: 'project' | 'workspace'
  /** Workspace page content_version for optimistic concurrency. */
  contentVersion?: number
  onSaved?: (blocks: DocBlockRow[], meta?: { contentVersion?: number }) => void
  onError?: (err: Error) => void
  onVersionConflict?: () => void
}

type EditableBlock = Pick<
  DocBlockRow,
  | 'id'
  | 'parent_block_id'
  | 'type'
  | 'text'
  | 'props'
  | 'position'
  | 'last_edited_by_type'
  | 'last_edited_by_id'
  | 'created_by_type'
  | 'created_by_id'
  | 'created_at'
  | 'updated_at'
  | 'tenant_id'
  | 'project_id'
  | 'page_id'
>

/** Workspace docs use flat top-level blocks only (Pad A). */
function blocksToEditable(blocks: DocBlockRow[]): EditableBlock[] {
  return [...blocks]
    .filter((b) => !b.parent_block_id)
    .sort((a, b) => a.position - b.position)
    .map((b, i) => ({ ...b, position: i, parent_block_id: null }))
}

function reposition(list: EditableBlock[]): EditableBlock[] {
  return list.map((b, i) => ({ ...b, position: i }))
}

interface RowProps {
  block: EditableBlock
  onTextChange: (id: string, runs: InlineRun[]) => void
  onTypeChange: (id: string, type: DocBlockType) => void
  onDelete: (id: string) => void
  onAddBelow: (id: string) => void
  onPropsChange: (id: string, props: Record<string, unknown>) => void
}

function blockClassFor(type: DocBlockType): string {
  switch (type) {
    case 'heading_1':
      return 'text-3xl font-semibold tracking-tight'
    case 'heading_2':
      return 'text-2xl font-semibold tracking-tight mt-4'
    case 'heading_3':
      return 'text-lg font-semibold tracking-tight mt-3'
    case 'quote':
      return 'border-l-4 border-border/60 pl-4 italic text-text-secondary'
    case 'code':
      return 'rounded-lg border border-border/60 bg-bg-surface px-3 py-2 font-mono text-sm leading-relaxed whitespace-pre-wrap'
    case 'callout':
      return 'rounded-lg border border-border/70 bg-bg-surface/90 px-4 py-3 text-[15px] leading-relaxed text-text-secondary shadow-sm'
    case 'paragraph':
      return 'text-[15px] leading-7 text-text-primary'
    case 'bullet_list_item':
    case 'numbered_list_item':
      return 'text-[15px] leading-7 text-text-primary pl-1'
    default:
      return 'text-[15px] leading-7 text-text-primary'
  }
}

function placeholderFor(type: DocBlockType, t: TFunction<'nav'>): string {
  switch (type) {
    case 'heading_1':
      return t('project.doc.blockPlaceholder.heading_1')
    case 'heading_2':
      return t('project.doc.blockPlaceholder.heading_2')
    case 'heading_3':
      return t('project.doc.blockPlaceholder.heading_3')
    case 'bullet_list_item':
    case 'numbered_list_item':
      return t('project.doc.blockPlaceholder.bullet_list_item')
    case 'to_do':
      return t('project.doc.blockPlaceholder.to_do')
    case 'quote':
      return t('project.doc.blockPlaceholder.quote')
    case 'callout':
      return t('project.doc.blockPlaceholder.callout')
    case 'code':
      return t('project.doc.blockPlaceholder.code')
    default:
      return t('project.doc.blockPlaceholder.default')
  }
}

function BlockRow({ block, onTextChange, onTypeChange, onDelete, onAddBelow, onPropsChange }: RowProps) {
  const { t } = useTranslation('nav')
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const editorRef = useRef<HTMLDivElement | null>(null)
  const lastSyncedTextRef = useRef<string>(renderInlineText(block.text))

  useEffect(() => {
    const text = renderInlineText(block.text)
    if (lastSyncedTextRef.current !== text && editorRef.current && document.activeElement !== editorRef.current) {
      editorRef.current.innerText = text
      lastSyncedTextRef.current = text
    }
  }, [block.text])

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const next = (e.currentTarget as HTMLDivElement).innerText
    lastSyncedTextRef.current = next
    onTextChange(block.id, [{ text: next }])
  }

  const isAgentEdited = block.last_edited_by_type === 'agent'

  if (block.type === 'divider') {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn('group relative flex items-center gap-2 py-2', isDragging && 'opacity-60')}
      >
        <div className="flex items-center opacity-0 group-hover:opacity-100">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="rounded p-1 text-text-muted hover:bg-bg-hover"
            aria-label={t('project.doc.editor.dragBlock')}
          >
            <GripVertical size={14} />
          </button>
          <BlockTypeMenu value={block.type} onChange={(next) => onTypeChange(block.id, next)} />
        </div>
        <hr className="flex-1 border-border/60" />
        <button
          type="button"
          onClick={() => onDelete(block.id)}
          className="rounded p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:bg-bg-hover hover:text-status-error"
          aria-label={t('project.doc.editor.deleteBlock')}
        >
          <Trash2 size={14} />
        </button>
      </div>
    )
  }

  if (block.type === 'to_do') {
    const checked = (block.props as { checked?: boolean } | undefined)?.checked === true
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn('group relative flex items-start gap-2 py-1', isDragging && 'opacity-60')}
      >
        <div className="flex items-center pt-1 opacity-0 group-hover:opacity-100">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="rounded p-1 text-text-muted hover:bg-bg-hover"
            aria-label={t('project.doc.editor.dragBlock')}
          >
            <GripVertical size={14} />
          </button>
          <BlockTypeMenu value={block.type} onChange={(next) => onTypeChange(block.id, next)} />
        </div>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onPropsChange(block.id, { ...(block.props as object), checked: e.target.checked })}
          className="mt-1.5 h-4 w-4 rounded border-border/60"
        />
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          className={cn(
            'flex-1 outline-none',
            blockClassFor(block.type),
            checked && 'text-text-muted line-through',
          )}
          data-placeholder={placeholderFor(block.type, t)}
        >
          {renderInlineText(block.text)}
        </div>
        <button
          type="button"
          onClick={() => onDelete(block.id)}
          className="rounded p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:bg-bg-hover hover:text-status-error"
          aria-label={t('project.doc.editor.deleteBlock')}
        >
          <Trash2 size={14} />
        </button>
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('group relative flex items-start gap-2 py-1', isDragging && 'opacity-60')}
    >
      {isAgentEdited ? (
        <span
          className="absolute -left-3 top-2.5 h-2 w-2 rounded-full bg-accent"
          title={t('project.doc.lastEditedByAgent')}
        />
      ) : null}
      <div className="flex items-center pt-1 opacity-0 group-hover:opacity-100">
        <button
          type="button"
          onClick={() => onAddBelow(block.id)}
          className="rounded p-1 text-text-muted hover:bg-bg-hover"
          aria-label={t('project.doc.editor.addBlockBelow')}
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="rounded p-1 text-text-muted hover:bg-bg-hover"
          aria-label={t('project.doc.editor.dragBlock')}
        >
          <GripVertical size={14} />
        </button>
        <BlockTypeMenu value={block.type} onChange={(next) => onTypeChange(block.id, next)} />
      </div>
      {block.type === 'bullet_list_item' ? (
        <span className="pt-1 text-text-muted">•</span>
      ) : block.type === 'numbered_list_item' ? (
        <span className="pt-1 text-text-muted">{block.position + 1}.</span>
      ) : null}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        className={cn('flex-1 min-w-0 outline-none', blockClassFor(block.type))}
        data-placeholder={placeholderFor(block.type, t)}
      >
        {renderInlineText(block.text)}
      </div>
      <button
        type="button"
        onClick={() => onDelete(block.id)}
        className="rounded p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:bg-bg-hover hover:text-status-error"
        aria-label={t('project.doc.editor.deleteBlock')}
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

export function BlockEditor({
  projectId,
  pageId,
  initialBlocks,
  docScope = 'project',
  contentVersion = 0,
  onSaved,
  onError,
  onVersionConflict,
}: BlockEditorProps) {
  const { t } = useTranslation('nav')
  const [blocks, setBlocks] = useState<EditableBlock[]>(() => blocksToEditable(initialBlocks))
  const lastSavedRef = useRef<DocBlockRow[]>(initialBlocks)
  const contentVersionRef = useRef(contentVersion)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [conflictMessage, setConflictMessage] = useState<string | null>(null)

  useEffect(() => {
    setBlocks(blocksToEditable(initialBlocks))
    lastSavedRef.current = initialBlocks
    contentVersionRef.current = contentVersion
    setConflictMessage(null)
  }, [initialBlocks, contentVersion])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const scheduleSave = useCallback(
    (next: EditableBlock[]) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(async () => {
        const flat = next.map<Pick<DocBlockRow, 'id' | 'parent_block_id' | 'type' | 'text' | 'props' | 'position'>>(
          (b) => ({
            id: b.id,
            parent_block_id: b.parent_block_id ?? null,
            type: b.type,
            text: b.text ?? [],
            props: b.props ?? {},
            position: b.position,
          }),
        )
        const ops = diffBlockLists(lastSavedRef.current, flat)
        if (ops.length === 0) return
        setSaving(true)
        try {
          const res =
            docScope === 'workspace'
              ? await applyWorkspaceBlockOps(pageId, ops, {
                  expectedVersion: contentVersionRef.current,
                })
              : await applyBlockOps(projectId!, pageId, ops)
          lastSavedRef.current = next as unknown as DocBlockRow[]
          if (typeof res.content_version === 'number') {
            contentVersionRef.current = res.content_version
          }
          setConflictMessage(null)
          setSavedAt(new Date())
          if (onSaved) {
            onSaved(res.applied, { contentVersion: res.content_version })
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          if (docScope === 'workspace' && isWorkspaceDocVersionConflict(error)) {
            setConflictMessage(t('project.doc.editor.versionConflict'))
            onVersionConflict?.()
          } else if (onError) {
            onError(error)
          }
        } finally {
          setSaving(false)
        }
      }, 600)
    },
    [docScope, projectId, pageId, onSaved, onError, onVersionConflict, t],
  )

  const updateAndSave = useCallback(
    (next: EditableBlock[]) => {
      setBlocks(next)
      scheduleSave(next)
    },
    [scheduleSave],
  )

  const handleTextChange = useCallback(
    (id: string, runs: InlineRun[]) => {
      setBlocks((prev) => {
        const next = prev.map((b) => (b.id === id ? { ...b, text: runs } : b))
        scheduleSave(next)
        return next
      })
    },
    [scheduleSave],
  )

  const handleTypeChange = useCallback(
    (id: string, type: DocBlockType) => {
      setBlocks((prev) => {
        const next = prev.map((b) => (b.id === id ? { ...b, type } : b))
        scheduleSave(next)
        return next
      })
    },
    [scheduleSave],
  )

  const handlePropsChange = useCallback(
    (id: string, props: Record<string, unknown>) => {
      setBlocks((prev) => {
        const next = prev.map((b) => (b.id === id ? { ...b, props } : b))
        scheduleSave(next)
        return next
      })
    },
    [scheduleSave],
  )

  const handleDelete = useCallback(
    (id: string) => {
      setBlocks((prev) => {
        const next = reposition(prev.filter((b) => b.id !== id))
        scheduleSave(next)
        return next
      })
    },
    [scheduleSave],
  )

  const handleAddBelow = useCallback(
    (id: string) => {
      setBlocks((prev) => {
        const idx = prev.findIndex((b) => b.id === id)
        if (idx === -1) return prev
        const newBlock: EditableBlock = {
          id: newBlockId(),
          tenant_id: prev[0]?.tenant_id ?? '',
          project_id: projectId,
          page_id: pageId,
          parent_block_id: null,
          type: 'paragraph',
          text: [],
          props: {},
          position: idx + 1,
          created_by_type: 'user',
          created_by_id: null,
          last_edited_by_type: 'user',
          last_edited_by_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        const inserted = [...prev.slice(0, idx + 1), newBlock, ...prev.slice(idx + 1)]
        const next = reposition(inserted)
        scheduleSave(next)
        return next
      })
    },
    [projectId, pageId, scheduleSave],
  )

  const handleAppend = useCallback(() => {
    setBlocks((prev) => {
      const newBlock: EditableBlock = {
        id: newBlockId(),
        tenant_id: prev[0]?.tenant_id ?? '',
        project_id: projectId,
        page_id: pageId,
        parent_block_id: null,
        type: 'paragraph',
        text: [],
        props: {},
        position: prev.length,
        created_by_type: 'user',
        created_by_id: null,
        last_edited_by_type: 'user',
        last_edited_by_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      const next = reposition([...prev, newBlock])
      scheduleSave(next)
      return next
    })
  }, [projectId, pageId, scheduleSave])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      setBlocks((prev) => {
        const oldIndex = prev.findIndex((b) => b.id === active.id)
        const newIndex = prev.findIndex((b) => b.id === over.id)
        if (oldIndex === -1 || newIndex === -1) return prev
        const next = reposition(arrayMove(prev, oldIndex, newIndex))
        scheduleSave(next)
        return next
      })
    },
    [scheduleSave],
  )

  const ids = useMemo(() => blocks.map((b) => b.id), [blocks])

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-end gap-2 text-xs text-text-muted">
        {conflictMessage ? (
          <span className="text-status-warning">{conflictMessage}</span>
        ) : saving ? (
          <span>{t('project.doc.editor.saving')}</span>
        ) : savedAt ? (
          <span>
            {t('project.doc.editor.saved', { time: savedAt.toLocaleTimeString() })}
          </span>
        ) : null}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="space-y-0.5">
            {blocks.map((block) => (
              <BlockRow
                key={block.id}
                block={block}
                onTextChange={handleTextChange}
                onTypeChange={handleTypeChange}
                onDelete={handleDelete}
                onAddBelow={handleAddBelow}
                onPropsChange={handlePropsChange}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        onClick={handleAppend}
        className="mt-3 flex items-center gap-2 rounded-md px-2 py-1 text-sm text-text-muted hover:bg-bg-hover hover:text-text-primary"
      >
        <Plus size={14} />
        <span>{t('project.doc.editor.addBlockBelow')}</span>
      </button>
    </div>
  )
}
