import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { listProjects, type ProjectRow } from '../../lib/projects-api'
import { folderTree, type FolderNode } from '../../lib/project-folders'
import { cn } from '../../lib/utils'
import ScrollFade from '../ui/ScrollFade'

const FolderKanban = ENTITY_ICONS.project

const OPEN_KEY = 'bokito-project-folders-open'

function loadOpen(): Set<string> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(OPEN_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveOpen(open: Set<string>) {
  try {
    sessionStorage.setItem(OPEN_KEY, JSON.stringify([...open]))
  } catch {
    // ignore storage failures
  }
}

/** Folder tree beside Projects. Subfolders stay closed until that project is opened. */
export default function ProjectsFolderNav({ className }: { className?: string }) {
  const { t } = useTranslation('nav')
  const { pathname } = useLocation()
  const { projectId } = useParams<{ projectId: string }>()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [open, setOpen] = useState<Set<string>>(loadOpen)

  useEffect(() => {
    let cancelled = false
    void listProjects()
      .then((rows) => {
        if (!cancelled) setProjects(rows)
      })
      .catch(() => {
        if (!cancelled) setProjects([])
      })
    return () => {
      cancelled = true
    }
  }, [pathname])

  const tree = useMemo(() => folderTree(projects), [projects])

  useEffect(() => {
    if (!projectId) return
    const current = projects.find((project) => project.id === projectId)
    const chain = [...(current?.ancestors ?? []).map((ancestor) => ancestor.id), projectId]
    setOpen((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const id of chain) {
        if (!next.has(id)) {
          next.add(id)
          changed = true
        }
      }
      if (!changed) return prev
      saveOpen(next)
      return next
    })
  }, [projectId, projects])

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveOpen(next)
      return next
    })
  }

  return (
    <nav className={cn('flex min-h-0 flex-col', className)} aria-label={t('projects.page.folderNav')}>
      <NavLink
        to="/folders"
        end
        className="nav-row mb-1 h-7 shrink-0 text-sm font-medium text-text-heading"
      >
        <FolderKanban size={14} aria-hidden />
        <span className="min-w-0 flex-1 truncate-fade">{t('tabs.folders.title')}</span>
      </NavLink>
      <ScrollFade className="min-h-0 flex-1">
        {tree.length === 0 ? (
          <p className="px-2 py-2 text-xs text-text-muted">{t('projects.page.emptyTitle')}</p>
        ) : (
          <div className="space-y-px">
            {tree.map((node) => (
              <FolderNavRow key={node.id} node={node} open={open} onToggle={toggle} />
            ))}
          </div>
        )}
      </ScrollFade>
    </nav>
  )
}

function FolderNavRow({
  node,
  open,
  onToggle,
}: {
  node: FolderNode
  open: Set<string>
  onToggle: (id: string) => void
}) {
  const { t } = useTranslation('nav')
  const expanded = open.has(node.id)
  const nested = node.children.length > 0
  return (
    <div className="space-y-px">
      <div className="flex items-center">
        {nested ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={t(expanded ? 'projects.detail.collapseFolder' : 'projects.detail.expandFolder', {
              name: node.name,
            })}
            onClick={() => onToggle(node.id)}
            className="inline-flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover/70 hover:text-text-secondary"
          >
            <ChevronRight size={14} className={cn('transition-transform', expanded && 'rotate-90')} aria-hidden />
          </button>
        ) : (
          <span className="inline-flex h-7 w-6 shrink-0 items-center justify-center text-text-muted" aria-hidden>
            <FolderKanban size={13} />
          </span>
        )}
        <NavLink to={`/folders/${node.id}`} className="nav-row h-7 min-w-0 flex-1 text-xs">
          <span className="min-w-0 flex-1 truncate-fade">{node.name}</span>
        </NavLink>
      </div>
      {nested ? (
        <div className="nav-fold" data-open={expanded ? 'true' : 'false'}>
          <div className="nav-fold-inner">
            <div className="ml-[15px] space-y-px border-l border-border/70 pl-1">
              {node.children.map((child) => (
                <FolderNavRow key={child.id} node={child} open={open} onToggle={onToggle} />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
