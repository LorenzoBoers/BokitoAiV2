import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Plus } from 'lucide-react'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { Card } from '../ui/card'
import type { ProjectChild } from '../../lib/projects-api'
import { filtersetLocalNames, filtersetPlainLabel } from '../../lib/folder-filter-tree'
const FolderIcon = ENTITY_ICONS.project

/**
 * Folders inside a project as cards — the same card vocabulary as the
 * Projects landing, trimmed to what a folder needs: name, open / closed
 * conversations, and how many folders sit deeper.
 */
export function ProjectFolderGrid({
  folders,
  parentTagNames,
  onCreate,
}: {
  folders: ProjectChild[]
  /** When these cards are nested under a map, strip parent tags from the title. */
  parentTagNames?: string[] | null
  /** Admins get a dashed "New folder" card at the end. */
  onCreate?: () => void
}) {
  const { t } = useTranslation('nav')
  if (folders.length === 0 && !onCreate) return null
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {folders.map((folder, index) => (
        <div key={folder.id} className="stagger-in" style={{ '--stagger': Math.min(index, 11) } as CSSProperties}>
          <ProjectFolderCard folder={folder} parentTagNames={parentTagNames} />
        </div>
      ))}
      {onCreate ? (
        <button
          type="button"
          onClick={onCreate}
          className="flex min-h-[64px] items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 px-4 text-sm text-text-muted transition-colors hover:border-border hover:bg-bg-hover/50 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          <Plus size={14} aria-hidden />
          {t('projects.detail.newFolder')}
        </button>
      ) : null}
    </div>
  )
}

export function ProjectFolderCard({
  folder,
  parentTagNames,
}: {
  folder: ProjectChild
  parentTagNames?: string[] | null
}) {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const open = () => navigate(`/folders/${folder.id}`)
  const title = folder.tag_names?.length
    ? filtersetPlainLabel(filtersetLocalNames(folder.tag_names, parentTagNames))
    : folder.name.replace(/^#/, '')
  return (
    <Card
      role="link"
      tabIndex={0}
      interactive
      aria-label={t('projects.detail.openFolder', { name: title })}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
      className="group flex items-center gap-3 p-3"
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"
        aria-hidden
      >
        <FolderIcon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="truncate-fade text-sm font-medium text-text-heading group-hover:text-accent">
          {title}
        </span>
        <span className="mt-0.5 block truncate text-xs text-text-muted">
          {t('projects.detail.folderCounts', { open: folder.open_count, closed: folder.closed_count })}
          {folder.child_count > 0 ? ` · ${t('projects.page.folders', { count: folder.child_count })}` : ''}
        </span>
      </span>
      <ChevronRight
        size={15}
        className="shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        aria-hidden
      />
    </Card>
  )
}
