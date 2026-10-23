import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { filtersetPlainLabel } from '../../lib/folder-filter-tree'
import { listProjects, type ProjectRow } from '../../lib/projects-api'
import { folderRows, folderSubtreeIds } from '../../lib/project-folders'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Button } from '../ui/button'
import { EmptyState } from '../ui/empty-state'
import { ApiErrorBanner } from '../ui/ApiErrorBanner'
import { FolderChecklistSkeleton } from '../ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'

const FolderKanban = ENTITY_ICONS.project

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel: string
  excludeIds?: string[]
  excludeSubtreeOf?: string
  allowRoot?: boolean
  onConfirm: (projectId: string | null) => Promise<void>
}

/** Pick a folder. Confirming applies that folder's labels to the conversation. */
export default function FileInFolderDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  excludeIds,
  excludeSubtreeOf,
  allowRoot = false,
  onConfirm,
}: Props) {
  const { t } = useTranslation('communication')
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setPicked(allowRoot ? '' : null)
    setError(null)
    setLoading(true)
    void listProjects()
      .then((loaded) => setProjects(loaded))
      .catch((err) => setError(formatApiErrorMessage(err, t('threadChrome.fileLoadError'))))
      .finally(() => setLoading(false))
  }, [open, allowRoot, t])

  const rows = useMemo(() => folderRows(projects), [projects])
  const byId = useMemo(() => new Map(projects.map((row) => [row.id, row])), [projects])
  const hidden = useMemo(() => {
    const ids = new Set(excludeIds ?? [])
    if (excludeSubtreeOf) {
      for (const id of folderSubtreeIds(projects, excludeSubtreeOf)) ids.add(id)
    }
    return ids
  }, [excludeIds, excludeSubtreeOf, projects])
  const needle = query.trim().toLowerCase()
  const visible = rows.filter((row) => {
    if (hidden.has(row.id)) return false
    if (!needle) return true
    const tags = row.tag_names.join(' ')
    return row.name.toLowerCase().includes(needle) || tags.toLowerCase().includes(needle)
  })

  const confirm = async () => {
    if (picked == null) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm(picked === '' ? null : picked)
      onOpenChange(false)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('threadChrome.fileError')))
    } finally {
      setBusy(false)
    }
  }

  const defaultDescription = t('threadChrome.fileApplyTags', {
    defaultValue: "Applies every label in that folder to the conversation.",
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? defaultDescription}</DialogDescription>
        </DialogHeader>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('threadChrome.fileSearch')}
          aria-label={t('threadChrome.fileSearch')}
          className="h-8 w-full"
        />
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {loading ? <FolderChecklistSkeleton rows={4} /> : null}
          {allowRoot ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setPicked('')}
              className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm disabled:opacity-40 ${
                picked === '' ? 'border-accent bg-accent/10' : 'border-border hover:bg-bg-hover/70'
              }`}
            >
              {t('threadChrome.fileRoot')}
            </button>
          ) : null}
          {visible.map((row) => {
            const project = byId.get(row.id)
            const tagLine = row.tag_names.length ? filtersetPlainLabel(row.tag_names) : null
            return (
              <button
                key={row.id}
                type="button"
                disabled={busy}
                onClick={() => setPicked(row.id)}
                style={{ paddingLeft: 12 + row.depth * 16 }}
                className={`flex w-full flex-col gap-0.5 rounded-md border py-2 pr-3 text-left text-sm disabled:opacity-40 ${
                  picked === row.id ? 'border-accent bg-accent/10' : 'border-border hover:bg-bg-hover/70'
                }`}
              >
                <span className="flex items-center gap-2">
                  <FolderKanban size={14} className="shrink-0 text-text-muted" aria-hidden />
                  <span className="min-w-0 truncate font-medium">{row.name}</span>
                </span>
                {tagLine ? <span className="truncate pl-6 text-2xs text-text-muted">{tagLine}</span> : null}
              </button>
            )
          })}
          {!loading && visible.length === 0 ? (
            <EmptyState tone="plain" size="sm" className="px-2 py-3" title={t('threadChrome.fileEmpty')} />
          ) : null}
        </div>
        {error ? <ApiErrorBanner message={error} /> : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('threadChrome.fileCancel')}
          </Button>
          <Button type="button" onClick={() => void confirm()} disabled={busy || picked == null || loading}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
