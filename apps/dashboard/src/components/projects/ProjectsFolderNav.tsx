import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FolderNavTree } from '../folders/FolderNavTree'
import { SearchField } from '../ui/search-field'
import { filtersetPlainLabel } from '../../lib/folder-filter-tree'
import { onFoldersChanged } from '../../lib/folders-bus'
import { listProjects, type ProjectRow } from '../../lib/projects-api'
import { cn } from '../../lib/utils'
import ScrollFade from '../ui/ScrollFade'

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

function folderMatches(project: ProjectRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const tags = project.tag_names ?? []
  const hay = [project.name, filtersetPlainLabel(tags), ...tags].join(' ').toLowerCase()
  return hay.includes(q.replace(/^#/, ''))
}

/** Keep matches and their ancestors so the derived tree still nests correctly. */
function filterProjects(projects: ProjectRow[], query: string): ProjectRow[] {
  const q = query.trim()
  if (!q) return projects
  const matched = new Set<string>()
  for (const project of projects) {
    if (!folderMatches(project, q)) continue
    matched.add(project.id)
    for (const ancestor of project.ancestors ?? []) matched.add(ancestor.id)
  }
  return projects.filter((project) => matched.has(project.id))
}

/** Folder tree beside /folders — search + whole-row drag (no section chrome). */
export default function ProjectsFolderNav({ className }: { className?: string }) {
  const { t } = useTranslation('nav')
  const { pathname } = useLocation()
  const { projectId } = useParams<{ projectId: string }>()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [open, setOpen] = useState<Set<string>>(loadOpen)
  const [query, setQuery] = useState('')

  const reload = useCallback(() => {
    void listProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
  }, [])

  useEffect(() => {
    reload()
  }, [pathname, reload])

  useEffect(() => onFoldersChanged(() => reload()), [reload])

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

  const filtered = useMemo(() => filterProjects(projects, query), [projects, query])

  // While searching, expand every visible node so matches under closed parents show.
  const effectiveOpen = useMemo(() => {
    if (!query.trim()) return open
    return new Set(filtered.map((project) => project.id))
  }, [filtered, open, query])

  const toggle = (id: string) => {
    if (query.trim()) return
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveOpen(next)
      return next
    })
  }

  const sources = filtered.map((project) => ({
    id: project.id,
    name: project.name,
    tag_ids: project.tag_ids ?? [],
    tag_names: project.tag_names,
    sort_order: project.sort_order,
  }))

  return (
    <nav className={cn('flex min-h-0 flex-col gap-1', className)} aria-label={t('projects.page.folderNav')}>
      <SearchField
        value={query}
        onChange={setQuery}
        size="sm"
        placeholder={t('projects.page.searchPlaceholder')}
        aria-label={t('projects.page.searchPlaceholder')}
        className="shrink-0"
      />
      <ScrollFade className="min-h-0 flex-1">
        <FolderNavTree
          sources={sources}
          open={effectiveOpen}
          onToggle={toggle}
          activeId={projectId}
          enableDrag={!query.trim()}
          onChanged={reload}
          empty={
            <p className="px-2 py-2 text-xs text-text-muted">
              {query.trim()
                ? t('projects.page.emptyFiltered')
                : t('projects.page.emptyBody', {
                    defaultValue: 'Create a folder as a tag filterset, then nest narrower maps under it.',
                  })}
            </p>
          }
        />
      </ScrollFade>
    </nav>
  )
}
