import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, FileText, Lock, type LucideIcon } from 'lucide-react'
import * as Icons from 'lucide-react'
import { cn } from '../../lib/utils'
import type { DocPageRow } from '../../lib/doc-api'

interface PageTreeProps {
  pages: DocPageRow[]
  projectId: string
  activePageId?: string
  /** Render compact rows that match the section sidebar look. */
  variant?: 'sidebar' | 'standalone'
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

function NodeRow({
  node,
  projectId,
  activePageId,
  depth,
  variant,
}: {
  node: TreeNode
  projectId: string
  activePageId?: string
  depth: number
  variant: 'sidebar' | 'standalone'
}) {
  const { t } = useTranslation('nav')
  const Icon = resolveIcon(node.page.icon)
  const isActive = activePageId === node.page.id

  const sidebarClass = cn(
    'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-all',
    isActive
      ? 'border-border/70 bg-bg-hover/85 text-text-heading shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_18px_-14px_rgba(15,23,42,0.4)]'
      : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary',
  )
  const standaloneClass = cn(
    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
    isActive
      ? 'bg-accent-muted text-text-primary'
      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
  )
  const indent = variant === 'sidebar' ? depth * 10 + 6 : depth * 12 + 8

  return (
    <div className="space-y-0.5">
      <Link
        to={`/project/${projectId}/doc/${node.page.slug}`}
        className={variant === 'sidebar' ? sidebarClass : standaloneClass}
        style={{ paddingLeft: `${indent}px` }}
        title={node.page.title}
      >
        {node.children.length > 0 ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        ) : (
          <span className="inline-block h-3.5 w-3.5 shrink-0" />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        <span className="truncate">{node.page.title}</span>
        {node.page.is_locked ? (
          <Lock
            className="ml-auto h-3 w-3 shrink-0 text-text-muted"
            aria-label={t('project.doc.editor.locked')}
          />
        ) : null}
      </Link>
      {node.children.length > 0 ? (
        <div>
          {node.children.map((child) => (
            <NodeRow
              key={child.page.id}
              node={child}
              projectId={projectId}
              activePageId={activePageId}
              depth={depth + 1}
              variant={variant}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function PageTree({ pages, projectId, activePageId, variant = 'standalone' }: PageTreeProps) {
  const { t } = useTranslation('nav')
  const tree = buildTree(pages)
  if (!tree.length) {
    return (
      <p className="px-3 py-1 text-xs text-text-muted">
        {t('project.doc.treeEmpty', { defaultValue: 'No pages yet.' })}
      </p>
    )
  }
  return (
    <nav className="space-y-0.5">
      {tree.map((node) => (
        <NodeRow
          key={node.page.id}
          node={node}
          projectId={projectId}
          activePageId={activePageId}
          depth={0}
          variant={variant}
        />
      ))}
    </nav>
  )
}
