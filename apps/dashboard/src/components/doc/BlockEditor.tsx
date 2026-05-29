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
import { GripVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { cn } from '../../lib/utils'
import {
  getCaretOffset,
  isCaretAtStart,
  placeCaretAtEnd,
  setCaretOffset,
} from '../../lib/block-editor-caret'
import {
  isListBlockType,
  lineStartOffset,
  matchMarkdownShortcut,
  numberedListIndex,
  tryApplyInputShortcut,
} from '../../lib/block-editor-shortcuts'
import {
  applyBlockOps,
  type DocBlockRow,
  type DocBlockType,
  type InlineRun,
} from '../../lib/doc-api'
import { applyWorkspaceBlockOps, isWorkspaceDocVersionConflict } from '../../lib/workspace-doc-api'
import { diffBlockLists, baselineBlocksForDiff, newBlockId, renderInlineText } from '../../lib/doc-blocks'
import { BlockTypeMenu } from './BlockTypeMenu'

interface BlockEditorProps {
  projectId?: string
  pageId: string
  initialBlocks: DocBlockRow[]
  docScope?: 'project' | 'workspace'
  contentVersion?: number
  onSaved?: (blocks: DocBlockRow[], meta?: { contentVersion?: number }) => void
  onSaveStatusChange?: (status: DocEditorSaveStatus) => void
  onError?: (err: Error) => void
  onVersionConflict?: () => void
}

export type DocEditorSaveStatus = {
  phase: 'idle' | 'pending' | 'saving' | 'saved' | 'error'
  lastEditedAt: Date | null
  lastSavedAt: Date | null
  errorMessage?: string
}

function normalizeAppliedBlock(raw: DocBlockRow): DocBlockRow {
  const record = raw as DocBlockRow & { block_type?: DocBlockType }
  const type = record.type ?? record.block_type
  return type ? { ...raw, type } : raw
}

function mergeSavedSnapshot(
  local: EditableBlock[],
  applied: DocBlockRow[] | undefined,
): DocBlockRow[] {
  if (!applied?.length) return local as unknown as DocBlockRow[]
  const byId = new Map(applied.map((b) => [b.id, normalizeAppliedBlock(b)]))
  return local.map((b) => {
    const server = byId.get(b.id)
    return server ? ({ ...b, ...server, type: server.type } as DocBlockRow) : (b as DocBlockRow)
  })
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

function blocksToEditable(blocks: DocBlockRow[], pageId: string): EditableBlock[] {
  const editable = [...blocks]
    .filter((b) => !b.parent_block_id)
    .sort((a, b) => a.position - b.position)
    .map((b, i) => ({ ...b, position: i, parent_block_id: null }))
  if (editable.length > 0) return editable
  return [makeBlock({ tenant_id: '', project_id: '', page_id: pageId }, { position: 0 })]
}

function reposition(list: EditableBlock[]): EditableBlock[] {
  return list.map((b, i) => ({ ...b, position: i }))
}

function runs(text: string): InlineRun[] {
  return text ? [{ text }] : []
}

function blockClassFor(type: DocBlockType): string {
  switch (type) {
    case 'heading_1':
      return 'text-3xl font-semibold tracking-tight'
    case 'heading_2':
      return 'text-2xl font-semibold tracking-tight mt-2'
    case 'heading_3':
      return 'text-lg font-semibold tracking-tight mt-1'
    case 'quote':
      return 'border-l-4 border-border/60 pl-4 italic text-text-secondary'
    case 'code':
      return 'rounded-lg border border-border/60 bg-bg-surface px-3 py-2 font-mono text-sm leading-relaxed'
    case 'callout':
      return 'rounded-lg border border-border/70 bg-bg-surface/90 px-4 py-3 text-[15px] leading-relaxed text-text-secondary shadow-sm'
    case 'paragraph':
      return 'text-[15px] leading-7 text-text-primary'
    case 'bullet_list_item':
    case 'numbered_list_item':
      return 'text-[15px] leading-7 text-text-primary'
    default:
      return 'text-[15px] leading-7 text-text-primary'
  }
}

function placeholderFor(
  type: DocBlockType,
  t: TFunction<'nav'>,
): { label: string; hint?: string } {
  switch (type) {
    case 'heading_1':
      return { label: t('project.doc.blockPlaceholder.heading_1') }
    case 'heading_2':
      return { label: t('project.doc.blockPlaceholder.heading_2') }
    case 'heading_3':
      return { label: t('project.doc.blockPlaceholder.heading_3') }
    case 'bullet_list_item':
    case 'numbered_list_item':
      return { label: t('project.doc.blockPlaceholder.bullet_list_item') }
    case 'to_do':
      return { label: t('project.doc.blockPlaceholder.to_do') }
    case 'quote':
      return { label: t('project.doc.blockPlaceholder.quote') }
    case 'callout':
      return { label: t('project.doc.blockPlaceholder.callout') }
    case 'code':
      return { label: t('project.doc.blockPlaceholder.code') }
    default:
      return {
        label: t('project.doc.blockPlaceholder.default'),
        hint: t('project.doc.blockPlaceholder.defaultHint'),
      }
  }
}

function nextBlockTypeOnEnter(type: DocBlockType): DocBlockType {
  if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') return 'paragraph'
  if (type === 'bullet_list_item') return 'bullet_list_item'
  if (type === 'numbered_list_item') return 'numbered_list_item'
  if (type === 'to_do') return 'to_do'
  return 'paragraph'
}

interface RowProps {
  block: EditableBlock
  numberedIndex?: number
  shouldFocus: boolean
  focusCaretOffset?: number | null
  onFocused: () => void
  onTextChange: (id: string, runs: InlineRun[]) => void
  onTypeChange: (id: string, type: DocBlockType) => void
  onTransform: (
    id: string,
    patch: { type: DocBlockType; text: string; props?: Record<string, unknown> },
  ) => void
  onSplitBelow: (id: string, before: string, after: string, nextType?: DocBlockType) => void
  onMergeWithPrevious: (id: string, carryText?: string) => void
  onDeleteEmpty: (id: string) => void
  onPropsChange: (id: string, props: Record<string, unknown>) => void
}

function BlockControls({
  block,
  onTypeChange,
  dragHandle,
}: {
  block: EditableBlock
  onTypeChange: (id: string, type: DocBlockType) => void
  dragHandle: React.HTMLAttributes<HTMLButtonElement>
}) {
  const { t } = useTranslation('nav')
  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <button
        type="button"
        {...dragHandle}
        className="rounded p-1 text-text-muted hover:bg-bg-hover"
        aria-label={t('project.doc.editor.dragBlock')}
      >
        <GripVertical size={14} />
      </button>
      <BlockTypeMenu value={block.type} onChange={(next) => onTypeChange(block.id, next)} />
    </div>
  )
}

function BlockEditable({
  block,
  editorRef,
  onInput,
  onKeyDown,
  className,
  placeholder,
  placeholderHint,
}: {
  block: EditableBlock
  editorRef: React.RefObject<HTMLDivElement | null>
  onInput: (e: React.FormEvent<HTMLDivElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
  className?: string
  placeholder: string
  placeholderHint?: string
}) {
  return (
    <div
      ref={editorRef}
      role="textbox"
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      onInput={onInput}
      onKeyDown={onKeyDown}
      className={cn('doc-block-field outline-none', blockClassFor(block.type), className)}
      data-placeholder={placeholderHint ? undefined : placeholder}
      data-placeholder-hint={placeholderHint}
      aria-label={placeholderHint || placeholder}
    />
  )
}

function BlockRow({
  block,
  numberedIndex,
  shouldFocus,
  focusCaretOffset,
  onFocused,
  onTextChange,
  onTypeChange,
  onTransform,
  onSplitBelow,
  onMergeWithPrevious,
  onDeleteEmpty,
  onPropsChange,
}: RowProps) {
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
    const el = editorRef.current
    if (!el) return
    const text = renderInlineText(block.text)
    el.innerText = text
    lastSyncedTextRef.current = text
  }, [block.id])

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const text = renderInlineText(block.text)
    if (lastSyncedTextRef.current !== text && document.activeElement !== el) {
      el.innerText = text
      lastSyncedTextRef.current = text
    }
  }, [block.text])

  useEffect(() => {
    if (!shouldFocus || !editorRef.current) return
    editorRef.current.focus()
    if (typeof focusCaretOffset === 'number') {
      setCaretOffset(editorRef.current, focusCaretOffset)
    } else {
      placeCaretAtEnd(editorRef.current)
    }
    onFocused()
  }, [shouldFocus, focusCaretOffset, onFocused])

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const el = e.currentTarget as HTMLDivElement
    const next = el.innerText.replace(/\r\n/g, '\n')
    const applied = tryApplyInputShortcut(next, block.type)
    if (applied) {
      el.innerText = applied.text
      lastSyncedTextRef.current = applied.text
      onTransform(block.id, {
        type: applied.type,
        text: applied.text,
        props: applied.props,
      })
      requestAnimationFrame(() => setCaretOffset(el, applied.caret))
      return
    }
    lastSyncedTextRef.current = next
    onTextChange(block.id, runs(next))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = editorRef.current
    if (!el) return
    const text = el.innerText.replace(/\r\n/g, '\n')
    const caret = getCaretOffset(el)

    if (e.key === ' ') {
      const lineStart = lineStartOffset(text, caret)
      const linePrefix = text.slice(lineStart, caret)
      const shortcut = matchMarkdownShortcut(linePrefix)
      if (shortcut) {
        const lineEnd = text.indexOf('\n', caret)
        const lineEndPos = lineEnd === -1 ? text.length : lineEnd
        const lineText = text.slice(lineStart, lineEndPos)
        if (lineText === linePrefix) {
          e.preventDefault()
          const afterStrip = text.slice(0, lineStart) + text.slice(caret)
          if (shortcut.type === 'divider') {
            onTransform(block.id, { type: 'divider', text: '', props: {} })
            return
          }
          el.innerText = afterStrip
          lastSyncedTextRef.current = afterStrip
          onTransform(block.id, {
            type: shortcut.type,
            text: afterStrip,
            props: shortcut.props,
          })
          setCaretOffset(el, lineStart)
          return
        }
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && block.type !== 'code') {
      const before = text.slice(0, caret)
      const after = text.slice(caret)

      if (isListBlockType(block.type) && before.trim() === '' && after.trim() === '') {
        e.preventDefault()
        onTransform(block.id, { type: 'paragraph', text: '', props: {} })
        return
      }

      e.preventDefault()
      el.innerText = before
      lastSyncedTextRef.current = before
      onSplitBelow(block.id, before, after, nextBlockTypeOnEnter(block.type))
      return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      if (block.type === 'code') {
        const before = text.slice(0, caret)
        const after = text.slice(caret)
        const next = `${before}\t${after}`
        el.innerText = next
        lastSyncedTextRef.current = next
        onTextChange(block.id, runs(next))
        setCaretOffset(el, caret + 1)
        return
      }
      if (e.shiftKey) {
        if (block.type === 'bullet_list_item' || block.type === 'numbered_list_item' || block.type === 'to_do') {
          onTypeChange(block.id, 'paragraph')
        }
        return
      }
      if (block.type === 'paragraph' || block.type === 'quote') {
        onTypeChange(block.id, 'bullet_list_item')
      }
      return
    }

    if (e.key === 'Backspace' && isCaretAtStart(el)) {
      if (text.length === 0) {
        e.preventDefault()
        if (isListBlockType(block.type)) {
          onTransform(block.id, { type: 'paragraph', text: '', props: {} })
          return
        }
        onDeleteEmpty(block.id)
        return
      }
      e.preventDefault()
      onMergeWithPrevious(block.id, text)
    }
  }

  const dragHandle = { ...attributes, ...listeners }
  const { label: placeholder, hint: placeholderHint } = placeholderFor(block.type, t)
  const isAgentEdited = block.last_edited_by_type === 'agent'

  const rowShell = (content: React.ReactNode) => (
    <div
      ref={setNodeRef}
      style={style}
      data-block-type={block.type}
      className={cn(
        'doc-block-row group relative py-0.5 pl-14 -ml-14',
        isDragging && 'opacity-60',
        isListBlockType(block.type) && 'doc-block-row-list',
      )}
    >
      {isAgentEdited ? (
        <span
          className="absolute left-10 top-2.5 h-2 w-2 rounded-full bg-accent"
          title={t('project.doc.lastEditedByAgent')}
        />
      ) : null}
      <div className="absolute left-0 top-1 z-10 w-12">
        <BlockControls block={block} onTypeChange={onTypeChange} dragHandle={dragHandle} />
      </div>
      {content}
    </div>
  )

  if (block.type === 'divider') {
    return rowShell(<hr className="my-3 border-border/60" />)
  }

  const checked = (block.props as { checked?: boolean } | undefined)?.checked === true
  const listMarker =
    block.type === 'bullet_list_item'
      ? '•'
      : block.type === 'numbered_list_item'
        ? `${numberedIndex ?? 1}.`
        : null

  return rowShell(
    <div className="flex w-full items-start gap-2">
      {block.type === 'to_do' ? (
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onPropsChange(block.id, { ...(block.props as object), checked: e.target.checked })}
          className="mt-2 h-4 w-4 shrink-0 rounded border-border/60"
        />
      ) : null}
      {listMarker ? (
        <span className="mt-[0.45rem] w-5 shrink-0 text-center tabular-nums text-text-muted">
          {listMarker}
        </span>
      ) : null}
      <BlockEditable
        block={block}
        editorRef={editorRef}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        placeholderHint={placeholderHint}
        className={cn(
          'flex-1',
          block.type === 'to_do' && checked && 'text-text-muted line-through',
        )}
      />
    </div>,
  )
}

function makeBlock(
  template: Pick<EditableBlock, 'tenant_id' | 'project_id' | 'page_id'>,
  partial: Partial<EditableBlock> & Pick<EditableBlock, 'position'>,
): EditableBlock {
  const now = new Date().toISOString()
  return {
    id: newBlockId(),
    tenant_id: template.tenant_id,
    project_id: template.project_id,
    page_id: template.page_id,
    parent_block_id: null,
    type: 'paragraph',
    text: [],
    props: {},
    created_by_type: 'user',
    created_by_id: null,
    last_edited_by_type: 'user',
    last_edited_by_id: null,
    created_at: now,
    updated_at: now,
    ...partial,
  }
}

export function BlockEditor({
  projectId,
  pageId,
  initialBlocks,
  docScope = 'project',
  contentVersion = 0,
  onSaved,
  onSaveStatusChange,
  onError,
  onVersionConflict,
}: BlockEditorProps) {
  const { t } = useTranslation('nav')
  const [blocks, setBlocks] = useState<EditableBlock[]>(() => blocksToEditable(initialBlocks, pageId))
  const [focusTarget, setFocusTarget] = useState<{ id: string; caret?: number } | null>(null)
  const lastSavedRef = useRef<DocBlockRow[]>(initialBlocks)
  const contentVersionRef = useRef(contentVersion)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSnapshotRef = useRef<EditableBlock[] | null>(null)
  const saveStatusRef = useRef<DocEditorSaveStatus>({
    phase: 'idle',
    lastEditedAt: null,
    lastSavedAt: null,
  })
  const [conflictMessage, setConflictMessage] = useState<string | null>(null)

  const emitSaveStatus = useCallback(
    (patch: Partial<DocEditorSaveStatus>) => {
      saveStatusRef.current = { ...saveStatusRef.current, ...patch }
      onSaveStatusChange?.(saveStatusRef.current)
    },
    [onSaveStatusChange],
  )

  useEffect(() => {
    contentVersionRef.current = contentVersion
  }, [contentVersion])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [])

  const markEdited = useCallback(() => {
    emitSaveStatus({ phase: 'pending', lastEditedAt: new Date() })
  }, [emitSaveStatus])

  const executeSave = useCallback(
    async (next: EditableBlock[]) => {
      pendingSnapshotRef.current = null
      const flat = next.map<
        Pick<DocBlockRow, 'id' | 'parent_block_id' | 'type' | 'text' | 'props' | 'position'>
      >((b) => ({
        id: b.id,
        parent_block_id: b.parent_block_id ?? null,
        type: b.type,
        text: b.text ?? [],
        props: b.props ?? {},
        position: b.position,
      }))
      const ops = diffBlockLists(baselineBlocksForDiff(lastSavedRef.current), flat)
      if (ops.length === 0) return

      emitSaveStatus({ phase: 'saving' })
      try {
        const res =
          docScope === 'workspace'
            ? await applyWorkspaceBlockOps(pageId, ops, {
                expectedVersion: contentVersionRef.current,
              })
            : await applyBlockOps(projectId!, pageId, ops)
        lastSavedRef.current = mergeSavedSnapshot(next, res.applied)
        if (typeof res.content_version === 'number') {
          contentVersionRef.current = res.content_version
        }
        setConflictMessage(null)
        const savedAt = new Date()
        emitSaveStatus({ phase: 'saved', lastSavedAt: savedAt })
        onSaved?.(lastSavedRef.current, { contentVersion: res.content_version })
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        if (docScope === 'workspace' && isWorkspaceDocVersionConflict(error)) {
          setConflictMessage(t('project.doc.editor.versionConflict'))
          emitSaveStatus({
            phase: 'error',
            errorMessage: t('project.doc.editor.versionConflict'),
          })
          onVersionConflict?.()
        } else {
          emitSaveStatus({
            phase: 'error',
            errorMessage: t('project.doc.editor.saveFailed'),
          })
          onError?.(error)
        }
      }
    },
    [docScope, emitSaveStatus, onError, onSaved, onVersionConflict, pageId, projectId, t],
  )

  const scheduleSave = useCallback(
    (next: EditableBlock[]) => {
      pendingSnapshotRef.current = next
      markEdited()
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null
        void executeSave(next)
      }, 600)
    },
    [executeSave, markEdited],
  )

  useEffect(() => {
    const flush = () => {
      if (saveTimeoutRef.current && pendingSnapshotRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
        void executeSave(pendingSnapshotRef.current)
      }
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [executeSave])

  const blockTemplate = useMemo(
    () => ({
      tenant_id: blocks[0]?.tenant_id ?? '',
      project_id: projectId ?? blocks[0]?.project_id ?? '',
      page_id: pageId,
    }),
    [blocks, projectId, pageId],
  )

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const handleTextChange = useCallback(
    (id: string, textRuns: InlineRun[]) => {
      setBlocks((prev) => {
        const next = prev.map((b) => (b.id === id ? { ...b, text: textRuns } : b))
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

  const handleTransform = useCallback(
    (id: string, patch: { type: DocBlockType; text: string; props?: Record<string, unknown> }) => {
      let focusNextId: string | null = null
      setBlocks((prev) => {
        const idx = prev.findIndex((b) => b.id === id)
        if (idx === -1) return prev

        let next = prev.map((b) =>
          b.id === id
            ? {
                ...b,
                type: patch.type,
                text: runs(patch.text),
                props: patch.props ?? b.props ?? {},
              }
            : b,
        )

        if (patch.type === 'divider') {
          const below = next[idx + 1]
          if (below && below.type !== 'divider') {
            focusNextId = below.id
          } else {
            const newId = newBlockId()
            focusNextId = newId
            next = reposition([
              ...next.slice(0, idx + 1),
              makeBlock(blockTemplate, { id: newId, position: idx + 1 }),
              ...next.slice(idx + 1),
            ])
          }
        }

        scheduleSave(next)
        return next
      })
      if (focusNextId) setFocusTarget({ id: focusNextId })
    },
    [blockTemplate, scheduleSave],
  )

  const handleSplitBelow = useCallback(
    (id: string, before: string, after: string, nextType: DocBlockType = 'paragraph') => {
      const newId = newBlockId()
      setBlocks((prev) => {
        const idx = prev.findIndex((b) => b.id === id)
        if (idx === -1) return prev
        const updated = prev.map((b) => (b.id === id ? { ...b, text: runs(before) } : b))
        const inserted = [
          ...updated.slice(0, idx + 1),
          makeBlock(blockTemplate, {
            id: newId,
            type: nextType,
            text: runs(after),
            position: idx + 1,
          }),
          ...updated.slice(idx + 1),
        ]
        const next = reposition(inserted)
        scheduleSave(next)
        return next
      })
      setFocusTarget({ id: newId })
    },
    [blockTemplate, scheduleSave],
  )

  const handleMergeWithPrevious = useCallback(
    (id: string, carryText = '') => {
      setBlocks((prev) => {
        const idx = prev.findIndex((b) => b.id === id)
        if (idx <= 0) return prev
        const previous = prev[idx - 1]
        const previousText = renderInlineText(previous.text)
        const merged = previousText + carryText
        const next = reposition(
          prev
            .filter((b) => b.id !== id)
            .map((b) => (b.id === previous.id ? { ...b, text: runs(merged) } : b)),
        )
        scheduleSave(next)
        setFocusTarget({ id: previous.id, caret: previousText.length })
        return next
      })
    },
    [scheduleSave],
  )

  const handleDeleteEmpty = useCallback(
    (id: string) => {
      setBlocks((prev) => {
        const idx = prev.findIndex((b) => b.id === id)
        if (idx === -1) return prev
        if (prev.length <= 1) {
          const next = prev.map((b) => (b.id === id ? { ...b, text: [] } : b))
          scheduleSave(next)
          return next
        }
        const previous = idx > 0 ? prev[idx - 1] : null
        const next = reposition(prev.filter((b) => b.id !== id))
        scheduleSave(next)
        if (previous) {
          setFocusTarget({ id: previous.id, caret: renderInlineText(previous.text).length })
        }
        return next
      })
    },
    [scheduleSave],
  )

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
  const clearFocus = useCallback(() => setFocusTarget(null), [])

  return (
    <div className="doc-block-editor space-y-0.5">
      {conflictMessage ? (
        <p className="mb-2 text-xs text-status-warning" role="status">
          {conflictMessage}
        </p>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="space-y-0.5">
            {blocks.map((block) => (
              <BlockRow
                key={block.id}
                block={block}
                numberedIndex={
                  block.type === 'numbered_list_item'
                    ? numberedListIndex(blocks, block.id)
                    : undefined
                }
                shouldFocus={focusTarget?.id === block.id}
                focusCaretOffset={focusTarget?.id === block.id ? focusTarget.caret : undefined}
                onFocused={clearFocus}
                onTextChange={handleTextChange}
                onTypeChange={handleTypeChange}
                onTransform={handleTransform}
                onSplitBelow={handleSplitBelow}
                onMergeWithPrevious={handleMergeWithPrevious}
                onDeleteEmpty={handleDeleteEmpty}
                onPropsChange={handlePropsChange}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
