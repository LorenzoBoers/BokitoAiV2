import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { listProjects, type ProjectRow } from '../../lib/projects-api'
import { folderRows, folderSubtreeIds } from '../../lib/project-folders'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'

const FolderKanban = ENTITY_ICONS.project

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel: string
  /** Folder ids that cannot be chosen (the folder itself, or one inside it). */
  excludeIds?: string[]
  /** Hide this folder and every folder inside it. */
  excludeSubtreeOf?: string
  /** When set, the list also offers the workspace root (no parent). */
  allowRoot?: boolean
  onConfirm: (projectId: string | null) => Promise<void>
}

/** Pick a project folder. The same tree is used to file a conversation or move a folder. */
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
    return row.name.toLowerCase().includes(needle)
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('threadChrome.fileSearch')}
          aria-label={t('threadChrome.fileSearch')}
          className="h-8 w-full rounded-md border border-border/70 bg-bg-input px-2 text-sm text-text-heading outline-none focus:border-accent"
        />
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {loading ? <p className="px-2 py-3 text-sm text-text-muted">{t('threadChrome.fileLoading')}</p> : null}
          {allowRoot ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setPicked('')}
              className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm disabled:opacity-40 ${
                picked === '' ? 'border-accent bg-accent/10' : 'border-border/60 hover:bg-bg-hover/70'
              }`}
            >
              {t('threadChrome.fileRoot')}
            </button>
          ) : null}
          {visible.map((row) => (
            <button
              key={row.id}
              type="button"
              disabled={busy}
              onClick={() => setPicked(row.id)}
              style={{ paddingLeft: 12 + row.depth * 16 }}
              className={`flex w-full items-center gap-2 rounded-md border py-2 pr-3 text-left text-sm disabled:opacity-40 ${
                picked === row.id ? 'border-accent bg-accent/10' : 'border-border/60 hover:bg-bg-hover/70'
              }`}
            >
              <FolderKanban size={14} className="shrink-0 text-text-muted" aria-hidden />
              <span className="min-w-0 truncate">{row.name}</span>
            </button>
          ))}
          {!loading && visible.length === 0 ? (
            <p className="px-2 py-3 text-sm text-text-muted">{t('threadChrome.fileEmpty')}</p>
          ) : null}
        </div>
        {error ? <p className="text-sm text-status-error">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
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
