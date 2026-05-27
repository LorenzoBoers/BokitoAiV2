import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Lock,
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
}

interface TreeNode {
  page: DocPageRow
  children: TreeNode[]
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

function resolveIcon(name: string | null | undefined): LucideIcon {
  if (!name) return FileText
  const candidate = (Icons as unknown as Record<string, LucideIcon>)[name]
  return candidate || FileText
}

function PageRowActions({
  page,
  docScope,
  workspaceDocId,
  projectId,
  onPagesChanged,
}: {
  page: DocPageRow
  docScope: 'project' | 'workspace'
  workspaceDocId?: string
  projectId?: string
  onPagesChanged?: () => void | Promise<void>
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

  const createPage = (input: {
    title: string
    slug?: string
    parent_page_id?: string | null
  }) => {
    if (docScope === 'workspace') {
      if (!workspaceDocId) throw new Error('Workspace doc id required')
      return createWorkspaceDocPage({
        workspace_doc_id: workspaceDocId,
        ...input,
        slug: input.slug ?? slugifyPageTitle(input.title),
      })
    }
    if (!projectId) throw new Error('Project id required')
    return createDocPage(projectId, input)
  }

  const patchPage = (pageId: string, patch: { title: string }) => {
    if (docScope === 'workspace') {
      return patchWorkspaceDocPage(pageId, patch)
    }
    if (!projectId) throw new Error('Project id required')
    return patchDocPage(projectId, pageId, patch)
  }

  const removePage = (pageId: string) => {
    if (docScope === 'workspace') {
      return deleteWorkspaceDocPage(pageId)
    }
    if (!projectId) throw new Error('Project id required')
    return deleteDocPage(projectId, pageId)
  }

  const handleNewChild = () => {
    const title = window.prompt(t('project.doc.pageCrud.newChildPrompt'))
    if (!title?.trim()) return
    void run(async () => {
      await createPage({ title: title.trim(), parent_page_id: page.id })
    })
  }

  const handleNewSibling = () => {
    const title = window.prompt(t('project.doc.pageCrud.newSiblingPrompt'))
    if (!title?.trim()) return
    void run(async () => {
      await createPage({
        title: title.trim(),
        parent_page_id: page.parent_page_id,
      })
    })
  }

  const handleRename = () => {
    const title = window.prompt(t('project.doc.pageCrud.renamePrompt'), page.title)
    if (!title?.trim() || title.trim() === page.title) return
    void run(async () => {
      await patchPage(page.id, { title: title.trim() })
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
        <DropdownMenuItem onClick={handleNewChild}>
          {t('project.doc.pageCrud.newChild')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleNewSibling}>
          {t('project.doc.pageCrud.newSibling')}
        </DropdownMenuItem>
        {!page.is_locked ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleRename}>
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

function NodeRow({
  node,
  projectId,
  workspaceDocId,
  docScope,
  activePageId,
  depth,
  variant,
  basePath,
  enablePageCrud,
  collapsedIds,
  onToggleCollapse,
  onPagesChanged,
}: {
  node: TreeNode
  projectId?: string
  workspaceDocId?: string
  docScope: 'project' | 'workspace'
  activePageId?: string
  depth: number
  variant: 'sidebar' | 'standalone' | 'minimal'
  basePath: string
  enablePageCrud?: boolean
  collapsedIds: Set<string>
  onToggleCollapse: (pageId: string) => void
  onPagesChanged?: () => void | Promise<void>
}) {
  const { t } = useTranslation('nav')
  const hasChildren = node.children.length > 0
  const isChapter = hasChildren && depth === 0
  const Icon = isChapter ? Folder : resolveIcon(node.page.icon)
  const isActive = activePageId === node.page.id
  const isCollapsed = collapsedIds.has(node.page.id)

  const sidebarClass = cn(
    'group/row flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-all',
    isActive
      ? 'border-border/70 bg-bg-hover/85 text-text-heading shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_18px_-14px_rgba(15,23,42,0.4)]'
      : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary',
    isChapter && !isActive && 'font-semibold',
  )
  const standaloneClass = cn(
    'group/row flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
    isActive
      ? 'bg-accent-muted text-text-primary'
      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
    isChapter && 'font-semibold',
  )
  const minimalClass = cn(
    'group/row flex items-center gap-1.5 border-l-2 border-transparent py-1 pl-2 text-sm transition-colors',
    isActive
      ? 'border-l-accent font-medium text-text-heading'
      : 'text-text-secondary hover:border-l-border/80 hover:text-text-primary',
    isChapter && !isActive && 'font-medium text-text-muted',
  )
  const rowClass =
    variant === 'sidebar'
      ? sidebarClass
      : variant === 'minimal'
        ? minimalClass
        : standaloneClass
  const indent =
    variant === 'sidebar' ? depth * 10 + 6 : variant === 'minimal' ? depth * 12 : depth * 12 + 8

  return (
    <div className="space-y-0.5">
      <div className={rowClass} style={{ paddingLeft: `${indent}px` }}>
        {hasChildren ? (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-text-muted hover:bg-bg-hover"
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? t('project.doc.expandChapter') : t('project.doc.collapseChapter')}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onToggleCollapse(node.page.id)
            }}
          >
            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="inline-block h-3.5 w-3.5 shrink-0" />
        )}
        <Link
          to={`${basePath}/${node.page.slug}`}
          className="flex min-w-0 flex-1 items-center gap-2"
          title={node.page.title}
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
        {enablePageCrud ? (
          <PageRowActions
            page={node.page}
            docScope={docScope}
            workspaceDocId={workspaceDocId}
            projectId={projectId}
            onPagesChanged={onPagesChanged}
          />
        ) : null}
      </div>
      {hasChildren && !isCollapsed ? (
        <div>
          {node.children.map((child) => (
            <NodeRow
              key={child.page.id}
              node={child}
              projectId={projectId}
              workspaceDocId={workspaceDocId}
              docScope={docScope}
              activePageId={activePageId}
              depth={depth + 1}
              variant={variant}
              basePath={basePath}
              enablePageCrud={enablePageCrud}
              collapsedIds={collapsedIds}
              onToggleCollapse={onToggleCollapse}
              onPagesChanged={onPagesChanged}
            />
          ))}
        </div>
      ) : null}
    </div>
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
}: PageTreeProps) {
  const { t } = useTranslation('nav')
  const [rootBusy, setRootBusy] = useState(false)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const tree = buildTree(pages)
  const resolvedBasePath =
    basePath ?? (docScope === 'workspace' ? '/projects/docs' : `/project/${projectId}/doc`)

  const toggleCollapse = (pageId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(pageId)) next.delete(pageId)
      else next.add(pageId)
      return next
    })
  }

  const handleNewRootPage = () => {
    const title = window.prompt(t('project.doc.pageCrud.newRootPrompt'))
    if (!title?.trim()) return
    if (docScope === 'project' && !projectId) return
    setRootBusy(true)
    const create =
      docScope === 'workspace'
        ? createWorkspaceDocPage({
            workspace_doc_id: workspaceDocId!,
            title: title.trim(),
            slug: slugifyPageTitle(title.trim()),
          })
        : createDocPage(projectId!, { title: title.trim() })
    void create
      .then(() => onPagesChanged?.())
      .finally(() => setRootBusy(false))
  }

  const emptyLabel = docScope === 'workspace'
    ? t('projectHub.docs.treeEmpty')
    : t('project.doc.treeEmpty', { defaultValue: 'No pages yet.' })

  if (!tree.length && !enablePageCrud) {
    return <p className="px-3 py-1 text-xs text-text-muted">{emptyLabel}</p>
  }

  const hasChapters = useMemo(() => tree.some((n) => n.children.length > 0), [tree])

  return (
    <nav className={cn('space-y-1', variant === 'minimal' && 'space-y-0.5')}>
      {enablePageCrud ? (
        variant === 'minimal' ? (
          <button
            type="button"
            disabled={rootBusy}
            onClick={handleNewRootPage}
            className="mb-2 w-full px-2 py-1 text-left text-xs font-medium text-text-muted transition-colors hover:text-accent disabled:opacity-50"
          >
            + {t('project.doc.pageCrud.addPage')}
          </button>
        ) : (
          <div className="px-2 pb-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full text-xs"
              disabled={rootBusy}
              onClick={handleNewRootPage}
            >
              {t('project.doc.pageCrud.addPage')}
            </Button>
          </div>
        )
      ) : null}
      {tree.length === 0 ? (
        <p className="px-3 py-1 text-xs text-text-muted">{emptyLabel}</p>
      ) : (
        <>
          {docScope === 'workspace' && hasChapters && variant !== 'minimal' ? (
            <p className="px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              {t('projectHub.docs.chaptersLabel')}
            </p>
          ) : null}
          {tree.map((node) => (
            <NodeRow
              key={node.page.id}
              node={node}
              projectId={projectId}
              workspaceDocId={workspaceDocId}
              docScope={docScope}
              activePageId={activePageId}
              depth={0}
              variant={variant}
              basePath={resolvedBasePath}
              enablePageCrud={enablePageCrud}
              collapsedIds={collapsedIds}
              onToggleCollapse={toggleCollapse}
              onPagesChanged={onPagesChanged}
            />
          ))}
        </>
      )}
    </nav>
  )
}
