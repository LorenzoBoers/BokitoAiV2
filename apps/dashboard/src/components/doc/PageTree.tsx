import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  GripVertical,
  Lock,
  LockOpen,
  MoreHorizontal,
  type LucideIcon,
} from 'lucide-react'
import * as Icons from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  createDocPage,
  deleteDocPage,
  patchDocPage,
  type DocPageRow,
} from '../../lib/doc-api'
import { slugifyPageTitle } from '../../lib/doc-blocks'
import {
  createWorkspaceDocPage,
  deleteWorkspaceDocPage,
  patchWorkspaceDocPage,
} from '../../lib/workspace-doc-api'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Button } from '../ui/button'

interface PageTreeProps {
  pages: DocPageRow[]
  activePageId?: string
  variant?: 'sidebar' | 'standalone' | 'minimal'
  basePath?: string
  enablePageCrud?: boolean
  docScope?: 'project' | 'workspace'
  workspaceDocId?: string
  projectId?: string
  onPagesChanged?: () => void | Promise<void>
  onPageCreated?: (page: DocPageRow) => void
}

interface TreeNode {
  page: DocPageRow
  children: TreeNode[]
}

type CreateTarget = {
  parent_page_id: string | null
  /** Inline input after this page row (child or sibling). */
  anchor_page_id?: string
}

function buildTree(pages: DocPageRow[]): TreeNode[] {
  const byParent = new Map<string | null, DocPageRow[]>()
  for (const page of pages) {
    const key = page.parent_page_id ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(page)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.position - b.position)
  }
  function build(parentId: string | null): TreeNode[] {
    return (byParent.get(parentId) ?? []).map((page) => ({
      page,
      children: build(page.id),
    }))
  }
  return build(null)
}

function nextSiblingPosition(pages: DocPageRow[], parentId: string | null): number {
  const siblings = pages.filter((p) => (p.parent_page_id ?? null) === parentId)
  if (!siblings.length) return 0
  return Math.max(...siblings.map((p) => p.position)) + 1
}

function defaultNewPageTitle(pages: DocPageRow[], label: string): string {
  const base = label.trim() || 'Page'
  let n = pages.filter((p) => p.title.startsWith(base)).length + 1
  let candidate = n === 1 ? base : `${base} ${n}`
  const slugs = new Set(pages.map((p) => p.slug))
  while (slugs.has(slugifyPageTitle(candidate))) {
    n += 1
    candidate = `${base} ${n}`
  }
  return candidate
}

function resolveIcon(name: string | null | undefined): LucideIcon {
  if (!name) return FileText
  const candidate = (Icons as unknown as Record<string, LucideIcon>)[name]
  return candidate || FileText
}

function InlinePageTitleInput({
  value,
  onChange,
  onCommit,
  onCancel,
  className,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
  className?: string
  ariaLabel: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onCommit()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
      onBlur={() => onCommit()}
      className={cn(
        'min-w-0 flex-1 rounded border border-accent/50 bg-bg-primary px-1.5 py-0.5 text-sm text-text-heading outline-none ring-1 ring-accent/30',
        className,
      )}
      aria-label={ariaLabel}
    />
  )
}

function usePageMutations({
  docScope,
  workspaceDocId,
  projectId,
  pages,
  onPagesChanged,
  onPageCreated,
}: {
  docScope: 'project' | 'workspace'
  workspaceDocId?: string
  projectId?: string
  pages: DocPageRow[]
  onPagesChanged?: () => void | Promise<void>
  onPageCreated?: (page: DocPageRow) => void
}) {
  const createPage = useCallback(
    (input: {
      title: string
      slug?: string
      parent_page_id?: string | null
      position?: number
    }) => {
      const parentId = input.parent_page_id ?? null
      const position = input.position ?? nextSiblingPosition(pages, parentId)
      const slug = input.slug ?? slugifyPageTitle(input.title)
      if (docScope === 'workspace') {
        if (!workspaceDocId) throw new Error('Workspace doc id required')
        return createWorkspaceDocPage({
          workspace_doc_id: workspaceDocId,
          title: input.title,
          slug,
          parent_page_id: parentId,
          position,
        })
      }
      if (!projectId) throw new Error('Project id required')
      return createDocPage(projectId, {
        title: input.title,
        slug,
        parent_page_id: parentId,
        position,
      })
    },
    [docScope, pages, projectId, workspaceDocId],
  )

  const patchPage = useCallback(
    (pageId: string, patch: { title?: string; position?: number; is_locked?: boolean }) => {
      if (docScope === 'workspace') {
        return patchWorkspaceDocPage(pageId, patch)
      }
      if (!projectId) throw new Error('Project id required')
      return patchDocPage(projectId, pageId, patch)
    },
    [docScope, projectId],
  )

  const removePage = useCallback(
    (pageId: string) => {
      if (docScope === 'workspace') {
        return deleteWorkspaceDocPage(pageId)
      }
      if (!projectId) throw new Error('Project id required')
      return deleteDocPage(projectId, pageId)
    },
    [docScope, projectId],
  )

  const commitCreate = useCallback(
    async (title: string, target: CreateTarget) => {
      const trimmed = title.trim()
      if (!trimmed) return null
      const page = await createPage({
        title: trimmed,
        parent_page_id: target.parent_page_id,
      })
      await onPagesChanged?.()
      onPageCreated?.(page)
      return page
    },
    [createPage, onPageCreated, onPagesChanged],
  )

  const commitRename = useCallback(
    async (pageId: string, title: string, previousTitle: string) => {
      const trimmed = title.trim()
      if (!trimmed || trimmed === previousTitle) return
      await patchPage(pageId, { title: trimmed })
      await onPagesChanged?.()
    },
    [onPagesChanged, patchPage],
  )

  const reorderSiblings = useCallback(
    async (parentId: string | null, ordered: DocPageRow[]) => {
      const updates = ordered
        .map((page, index) => ({ page, index }))
        .filter(({ page, index }) => page.position !== index)
      if (!updates.length) return
      await Promise.all(
        updates.map(({ page, index }) => patchPage(page.id, { position: index })),
      )
      await onPagesChanged?.()
    },
    [onPagesChanged, patchPage],
  )

  return { patchPage, removePage, commitCreate, commitRename, reorderSiblings }
}

function PageRowActions({
  page,
  docScope,
  workspaceDocId,
  projectId,
  onPagesChanged,
  onStartCreateChild,
  onStartCreateSibling,
  onStartRename,
  patchPage,
  removePage,
}: {
  page: DocPageRow
  docScope: 'project' | 'workspace'
  workspaceDocId?: string
  projectId?: string
  onPagesChanged?: () => void | Promise<void>
  onStartCreateChild: () => void
  onStartCreateSibling: () => void
  onStartRename: () => void
  patchPage: (pageId: string, patch: { is_locked?: boolean }) => Promise<DocPageRow>
  removePage: (pageId: string) => Promise<void>
}) {
  const { t } = useTranslation('nav')
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      await onPagesChanged?.()
    } finally {
      setBusy(false)
    }
  }

  const handleToggleLock = () => {
    void run(async () => {
      await patchPage(page.id, { is_locked: !page.is_locked })
    })
  }

  const handleDelete = () => {
    if (!window.confirm(t('project.doc.pageCrud.deleteConfirm', { title: page.title }))) return
    void run(async () => {
      await removePage(page.id)
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6 shrink-0 opacity-0 group-hover/row:opacity-100"
          disabled={busy}
          onClick={(e) => e.preventDefault()}
          aria-label={t('project.doc.pageCrud.menuAria')}
        >
          <MoreHorizontal size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={onStartCreateChild}>
          {t('project.doc.pageCrud.newChild')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onStartCreateSibling}>
          {t('project.doc.pageCrud.newSibling')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleToggleLock}>
          {page.is_locked ? (
            <>
              <LockOpen size={14} className="mr-2" />
              {t('project.doc.pageCrud.unlock')}
            </>
          ) : (
            <>
              <Lock size={14} className="mr-2" />
              {t('project.doc.pageCrud.lock')}
            </>
          )}
        </DropdownMenuItem>
        {!page.is_locked ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onStartRename}>
              {t('project.doc.pageCrud.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDelete} className="text-destructive">
              {t('project.doc.pageCrud.delete')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SortableNodeRow({
  node,
  pages,
  projectId,
  workspaceDocId,
  docScope,
  activePageId,
  depth,
  variant,
  basePath,
  enablePageCrud,
  enableDrag,
  collapsedIds,
  onToggleCollapse,
  onPagesChanged,
  editingPageId,
  draftTitle,
  onDraftTitleChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  createTarget,
  onStartCreateChild,
  onStartCreateSibling,
  onCommitCreate,
  onCancelCreate,
  onDraftTitleChangeForCreate,
  patchPage,
  removePage,
  reorderSiblings,
}: {
  node: TreeNode
  pages: DocPageRow[]
  projectId?: string
  workspaceDocId?: string
  docScope: 'project' | 'workspace'
  activePageId?: string
  depth: number
  variant: 'sidebar' | 'standalone' | 'minimal'
  basePath: string
  enablePageCrud?: boolean
  enableDrag?: boolean
  collapsedIds: Set<string>
  onToggleCollapse: (pageId: string) => void
  onPagesChanged?: () => void | Promise<void>
  editingPageId: string | null
  draftTitle: string
  onDraftTitleChange: (value: string) => void
  onStartRename: (page: DocPageRow) => void
  onCommitRename: (page: DocPageRow) => void
  onCancelRename: () => void
  createTarget: CreateTarget | null
  onStartCreateChild: (page: DocPageRow) => void
  onStartCreateSibling: (page: DocPageRow) => void
  onCommitCreate: () => void
  onCancelCreate: () => void
  onDraftTitleChangeForCreate: (value: string) => void
  patchPage: ReturnType<typeof usePageMutations>['patchPage']
  removePage: ReturnType<typeof usePageMutations>['removePage']
  reorderSiblings: (parentId: string | null, ordered: DocPageRow[]) => Promise<void>
}) {
  const { t } = useTranslation('nav')
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: node.page.id,
    disabled: !enableDrag,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const hasChildren = node.children.length > 0
  const isChapter = hasChildren && depth === 0
  const Icon = isChapter ? Folder : resolveIcon(node.page.icon)
  const isActive = activePageId === node.page.id
  const isCollapsed = collapsedIds.has(node.page.id)
  const isEditing = editingPageId === node.page.id
  const showInlineCreate =
    createTarget != null &&
    (createTarget.anchor_page_id === node.page.id ||
      createTarget.parent_page_id === node.page.id)

  const sidebarClass = cn(
    'group/row flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-all',
    isActive
      ? 'border-border/70 bg-bg-hover/85 text-text-heading shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_18px_-14px_rgba(15,23,42,0.4)]'
      : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary',
    isChapter && !isActive && 'font-semibold',
    isDragging && 'opacity-60',
  )
  const standaloneClass = cn(
    'group/row flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
    isActive
      ? 'bg-accent-muted text-text-primary'
      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
    isChapter && 'font-semibold',
    isDragging && 'opacity-60',
  )
  const minimalClass = cn(
    'group/row flex items-center gap-1 border-l-2 border-transparent py-1 pl-1 text-sm transition-colors',
    isActive
      ? 'border-l-accent font-medium text-text-heading'
      : 'text-text-secondary hover:border-l-border/80 hover:text-text-primary',
    isChapter && !isActive && 'font-medium text-text-muted',
    isDragging && 'opacity-60',
  )
  const rowClass =
    variant === 'sidebar'
      ? sidebarClass
      : variant === 'minimal'
        ? minimalClass
        : standaloneClass
  const indent =
    variant === 'sidebar' ? depth * 10 + 6 : variant === 'minimal' ? depth * 12 + 4 : depth * 12 + 8

  const dragHandle = enableDrag ? (
    <button
      type="button"
      {...attributes}
      {...listeners}
      className="shrink-0 rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-bg-hover group-hover/row:opacity-100"
      aria-label={t('project.doc.pageCrud.dragPage')}
      onClick={(e) => e.preventDefault()}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  ) : (
    <span className="inline-block h-3.5 w-3.5 shrink-0" />
  )

  return (
    <div ref={setNodeRef} style={style} className="space-y-0.5">
      <div className={rowClass} style={{ paddingLeft: `${indent}px` }}>
        {dragHandle}
        {hasChildren ? (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-text-muted hover:bg-bg-hover"
            aria-expanded={!isCollapsed}
            aria-label={
              isCollapsed ? t('project.doc.expandChapter') : t('project.doc.collapseChapter')
            }
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onToggleCollapse(node.page.id)
            }}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="inline-block h-3.5 w-3.5 shrink-0" />
        )}
        {isEditing ? (
          <InlinePageTitleInput
            value={draftTitle}
            onChange={onDraftTitleChange}
            onCommit={() => onCommitRename(node.page)}
            onCancel={onCancelRename}
            ariaLabel={t('project.doc.pageCrud.renameInline')}
          />
        ) : (
          <Link
            to={`${basePath}/${node.page.slug}`}
            className="flex min-w-0 flex-1 items-center gap-2"
            title={node.page.title}
            onDoubleClick={(e) => {
              if (!enablePageCrud || node.page.is_locked) return
              e.preventDefault()
              onStartRename(node.page)
            }}
          >
            {variant === 'minimal' ? null : (
              <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            )}
            <span className="truncate">{node.page.title}</span>
            {node.page.is_locked ? (
              <Lock
                className="h-3 w-3 shrink-0 text-text-muted"
                aria-label={t('project.doc.editor.locked')}
              />
            ) : null}
          </Link>
        )}
        {enablePageCrud && !isEditing ? (
          <PageRowActions
            page={node.page}
            docScope={docScope}
            workspaceDocId={workspaceDocId}
            projectId={projectId}
            onPagesChanged={onPagesChanged}
            onStartCreateChild={() => onStartCreateChild(node.page)}
            onStartCreateSibling={() => onStartCreateSibling(node.page)}
            onStartRename={() => onStartRename(node.page)}
            patchPage={patchPage}
            removePage={removePage}
          />
        ) : null}
      </div>
      {showInlineCreate ? (
        <div style={{ paddingLeft: `${indent + (variant === 'minimal' ? 28 : 24)}px` }}>
          <InlinePageTitleInput
            value={draftTitle}
            onChange={onDraftTitleChangeForCreate}
            onCommit={onCommitCreate}
            onCancel={onCancelCreate}
            ariaLabel={t('project.doc.pageCrud.newChildInline')}
            className="w-full"
          />
        </div>
      ) : null}
      {hasChildren && !isCollapsed ? (
        <SortableSiblingList
          nodes={node.children}
          parentId={node.page.id}
          pages={pages}
          projectId={projectId}
          workspaceDocId={workspaceDocId}
          docScope={docScope}
          activePageId={activePageId}
          depth={depth + 1}
          variant={variant}
          basePath={basePath}
          enablePageCrud={enablePageCrud}
          enableDrag={enableDrag}
          collapsedIds={collapsedIds}
          onToggleCollapse={onToggleCollapse}
          onPagesChanged={onPagesChanged}
          editingPageId={editingPageId}
          draftTitle={draftTitle}
          onDraftTitleChange={onDraftTitleChange}
          onStartRename={onStartRename}
          onCommitRename={onCommitRename}
          onCancelRename={onCancelRename}
          createTarget={createTarget}
          onStartCreateChild={onStartCreateChild}
          onStartCreateSibling={onStartCreateSibling}
          onCommitCreate={onCommitCreate}
          onCancelCreate={onCancelCreate}
          onDraftTitleChangeForCreate={onDraftTitleChangeForCreate}
          patchPage={patchPage}
          removePage={removePage}
          reorderSiblings={reorderSiblings}
        />
      ) : null}
    </div>
  )
}

function SortableSiblingList({
  nodes,
  parentId,
  pages,
  projectId,
  workspaceDocId,
  docScope,
  activePageId,
  depth,
  variant,
  basePath,
  enablePageCrud,
  enableDrag,
  collapsedIds,
  onToggleCollapse,
  onPagesChanged,
  editingPageId,
  draftTitle,
  onDraftTitleChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  createTarget,
  onStartCreateChild,
  onStartCreateSibling,
  onCommitCreate,
  onCancelCreate,
  onDraftTitleChangeForCreate,
  patchPage,
  removePage,
  reorderSiblings,
}: {
  nodes: TreeNode[]
  parentId: string | null
  pages: DocPageRow[]
  projectId?: string
  workspaceDocId?: string
  docScope: 'project' | 'workspace'
  activePageId?: string
  depth: number
  variant: 'sidebar' | 'standalone' | 'minimal'
  basePath: string
  enablePageCrud?: boolean
  enableDrag?: boolean
  collapsedIds: Set<string>
  onToggleCollapse: (pageId: string) => void
  onPagesChanged?: () => void | Promise<void>
  editingPageId: string | null
  draftTitle: string
  onDraftTitleChange: (value: string) => void
  onStartRename: (page: DocPageRow) => void
  onCommitRename: (page: DocPageRow) => void
  onCancelRename: () => void
  createTarget: CreateTarget | null
  onStartCreateChild: (page: DocPageRow) => void
  onStartCreateSibling: (page: DocPageRow) => void
  onCommitCreate: () => void
  onCancelCreate: () => void
  onDraftTitleChangeForCreate: (value: string) => void
  patchPage: ReturnType<typeof usePageMutations>['patchPage']
  removePage: ReturnType<typeof usePageMutations>['removePage']
  reorderSiblings: (parentId: string | null, ordered: DocPageRow[]) => Promise<void>
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )
  const ids = useMemo(() => nodes.map((n) => n.page.id), [nodes])

  const handleDragEnd = (event: DragEndEvent) => {
    if (!reorderSiblings) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(
      nodes.map((n) => n.page),
      oldIndex,
      newIndex,
    )
    void reorderSiblings(parentId, reordered)
  }

  const list = (
    <div className="space-y-0.5">
      {nodes.map((node) => (
        <SortableNodeRow
          key={node.page.id}
          node={node}
          pages={pages}
          projectId={projectId}
          workspaceDocId={workspaceDocId}
          docScope={docScope}
          activePageId={activePageId}
          depth={depth}
          variant={variant}
          basePath={basePath}
          enablePageCrud={enablePageCrud}
          enableDrag={enableDrag}
          collapsedIds={collapsedIds}
          onToggleCollapse={onToggleCollapse}
          onPagesChanged={onPagesChanged}
          editingPageId={editingPageId}
          draftTitle={draftTitle}
          onDraftTitleChange={onDraftTitleChange}
          onStartRename={onStartRename}
          onCommitRename={onCommitRename}
          onCancelRename={onCancelRename}
          createTarget={createTarget}
          onStartCreateChild={onStartCreateChild}
          onStartCreateSibling={onStartCreateSibling}
          onCommitCreate={onCommitCreate}
          onCancelCreate={onCancelCreate}
          onDraftTitleChangeForCreate={onDraftTitleChangeForCreate}
          patchPage={patchPage}
          removePage={removePage}
          reorderSiblings={reorderSiblings}
        />
      ))}
    </div>
  )

  if (!enableDrag) {
    return list
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {list}
      </SortableContext>
    </DndContext>
  )
}

export function PageTree({
  pages,
  projectId,
  workspaceDocId,
  activePageId,
  variant = 'standalone',
  basePath,
  enablePageCrud = false,
  docScope = 'project',
  onPagesChanged,
  onPageCreated,
}: PageTreeProps) {
  const { t } = useTranslation('nav')
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const [editingPageId, setEditingPageId] = useState<string | null>(null)
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [rootBusy, setRootBusy] = useState(false)

  const tree = buildTree(pages)
  const resolvedBasePath =
    basePath ?? (docScope === 'workspace' ? '/projects/docs' : `/project/${projectId}/doc`)

  const { patchPage, removePage, commitCreate, commitRename, reorderSiblings } = usePageMutations({
    docScope,
    workspaceDocId,
    projectId,
    pages,
    onPagesChanged,
    onPageCreated,
  })

  const enableDrag = Boolean(enablePageCrud)

  const toggleCollapse = (pageId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(pageId)) next.delete(pageId)
      else next.add(pageId)
      return next
    })
  }

  const startCreate = (target: CreateTarget) => {
    setEditingPageId(null)
    setCreateTarget(target)
    setDraftTitle(
      defaultNewPageTitle(pages, t('project.doc.pageCrud.newPageDefault')),
    )
  }

  const cancelCreate = () => {
    setCreateTarget(null)
    setDraftTitle('')
  }

  const handleCommitCreate = async () => {
    if (!createTarget) return
    setRootBusy(true)
    try {
      await commitCreate(draftTitle, createTarget)
    } finally {
      setRootBusy(false)
      cancelCreate()
    }
  }

  const startRename = (page: DocPageRow) => {
    cancelCreate()
    setEditingPageId(page.id)
    setDraftTitle(page.title)
  }

  const cancelRename = () => {
    setEditingPageId(null)
    setDraftTitle('')
  }

  const handleCommitRename = async (page: DocPageRow) => {
    const nextTitle = draftTitle
    const previous = page.title
    cancelRename()
    await commitRename(page.id, nextTitle, previous)
  }

  const emptyLabel =
    docScope === 'workspace'
      ? t('projectHub.docs.treeEmpty')
      : t('project.doc.treeEmpty', { defaultValue: 'No pages yet.' })

  if (!tree.length && !enablePageCrud) {
    return <p className="px-3 py-1 text-xs text-text-muted">{emptyLabel}</p>
  }

  const hasChapters = useMemo(() => tree.some((n) => n.children.length > 0), [tree])
  const isCreatingRoot =
    createTarget != null &&
    createTarget.parent_page_id === null &&
    createTarget.anchor_page_id == null

  return (
    <nav className={cn('space-y-1', variant === 'minimal' && 'space-y-0.5')}>
      {tree.length === 0 ? (
        <p className="px-3 py-1 text-xs text-text-muted">{emptyLabel}</p>
      ) : (
        <>
          {docScope === 'workspace' && hasChapters && variant !== 'minimal' ? (
            <p className="px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              {t('projectHub.docs.chaptersLabel')}
            </p>
          ) : null}
          <SortableSiblingList
            nodes={tree}
            parentId={null}
            pages={pages}
            projectId={projectId}
            workspaceDocId={workspaceDocId}
            docScope={docScope}
            activePageId={activePageId}
            depth={0}
            variant={variant}
            basePath={resolvedBasePath}
            enablePageCrud={enablePageCrud}
            enableDrag={enableDrag}
            collapsedIds={collapsedIds}
            onToggleCollapse={toggleCollapse}
            onPagesChanged={onPagesChanged}
            editingPageId={editingPageId}
            draftTitle={draftTitle}
            onDraftTitleChange={setDraftTitle}
            onStartRename={startRename}
            onCommitRename={handleCommitRename}
            onCancelRename={cancelRename}
            createTarget={createTarget}
            onStartCreateChild={(page) =>
              startCreate({ parent_page_id: page.id, anchor_page_id: page.id })
            }
            onStartCreateSibling={(page) =>
              startCreate({
                parent_page_id: page.parent_page_id ?? null,
                anchor_page_id: page.id,
              })
            }
            onCommitCreate={() => void handleCommitCreate()}
            onCancelCreate={cancelCreate}
            onDraftTitleChangeForCreate={setDraftTitle}
            patchPage={patchPage}
            removePage={removePage}
            reorderSiblings={reorderSiblings}
          />
        </>
      )}
      {enablePageCrud ? (
        <>
          {isCreatingRoot ? (
            <div className={cn(variant === 'minimal' ? 'mt-1 px-2' : 'px-2 pt-2')}>
              <InlinePageTitleInput
                value={draftTitle}
                onChange={setDraftTitle}
                onCommit={() => void handleCommitCreate()}
                onCancel={cancelCreate}
                ariaLabel={t('project.doc.pageCrud.newRootInline')}
                className="w-full"
              />
            </div>
          ) : variant === 'minimal' ? (
            <button
              type="button"
              disabled={rootBusy}
              onClick={() => startCreate({ parent_page_id: null })}
              className="mt-2 w-full px-2 py-1 text-left text-xs font-medium text-text-muted transition-colors hover:text-accent disabled:opacity-50"
            >
              + {t('project.doc.pageCrud.addPage')}
            </button>
          ) : (
            <div className="px-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full text-xs"
                disabled={rootBusy}
                onClick={() => startCreate({ parent_page_id: null })}
              >
                {t('project.doc.pageCrud.addPage')}
              </Button>
            </div>
          )}
        </>
      ) : null}
    </nav>
  )
}
