import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { filtersetPlainLabel } from '../../lib/folder-filter-tree'
import { normalizeHashtag, stripHash } from '../../lib/hashtag'
import { createProject } from '../../lib/projects-api'
import { listSignalTags, type SignalTag } from '../../lib/signals-api'
import { notifyFoldersChanged } from '../../lib/folders-bus'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { ChipCloudSkeleton } from '../ui/skeleton'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { TagChipInput } from '../ui/TagChipInput'
import { TagPill } from '../ui/TagPill'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the new folder is created under this parent. */
  parentId?: string | null
  onCreated?: (folderId: string) => void
}

/**
 * Create a named folder with optional AND label rules.
 * Nesting is parent_id; labels stay independent of the parent.
 */
export function CreateFolderDialog({ open, onOpenChange, parentId = null, onCreated }: Props) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [registry, setRegistry] = useState<SignalTag[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    setQuery('')
    setSelected([])
    if (!token) return
    let cancelled = false
    setLoading(true)
    void listSignalTags(token)
      .then((rows) => {
        if (!cancelled) setRegistry(rows.filter((row) => !row.isCategory))
      })
      .catch(() => {
        if (!cancelled) setRegistry([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, token])

  const normalized = normalizeHashtag(query)
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const options = useMemo(() => {
    const q = normalized
    return registry
      .filter((row) => !q || row.name.includes(q) || row.description.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [registry, normalized])
  const exactMatch = registry.find((row) => row.name === normalized) ?? null
  const isNewName = Boolean(normalized) && !exactMatch && !selectedSet.has(normalized)

  const toggle = (tagName: string) => {
    const clean = normalizeHashtag(tagName)
    if (!clean) return
    setSelected((prev) =>
      prev.includes(clean) ? prev.filter((name) => name !== clean) : [...prev, clean],
    )
  }

  const addDraft = () => {
    if (!normalized) return
    toggle(normalized)
    setQuery('')
  }

  const canSubmit = name.trim().length > 0 || selected.length > 0

  const confirm = async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      const cleanName = name.trim() || filtersetPlainLabel(selected) || 'Folder'
      const created = await createProject({
        name: cleanName,
        tags: selected.length ? selected : undefined,
        parent_id: parentId ?? undefined,
      })
      notifyFoldersChanged({ folderId: created.id })
      toast.success(t('projects.page.created'))
      onOpenChange(false)
      onCreated?.(created.id)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.page.createError')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('projects.page.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('projects.page.dialogBody')}</DialogDescription>
        </DialogHeader>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-text-secondary">{t('projects.page.name')}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('projects.page.namePlaceholder')}
            aria-label={t('projects.page.name')}
            autoFocus
            className="h-9 w-full rounded-md border border-border/70 bg-bg-input px-2.5 text-sm text-text-heading outline-none focus:border-accent"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit && !busy) {
                event.preventDefault()
                void confirm()
              }
            }}
          />
        </label>

        <div className="space-y-2">
          <span className="text-xs font-medium text-text-secondary">
            {t('projects.page.labelsOptional', { defaultValue: 'Labels (optional)' })}
          </span>
          <p className="text-2xs text-text-muted">
            {t('projects.page.labelsHint', {
              defaultValue:
                'Conversations match when they carry every selected label. Leave empty for a place-only folder.',
            })}
          </p>
          <TagChipInput
            chips={selected.map((tagName) => ({ name: tagName, tone: 'free' as const }))}
            value={query}
            onChange={(next) => setQuery(stripHash(next))}
            onSubmit={addDraft}
            onRemove={(tagName) => toggle(tagName)}
            disabled={busy}
            placeholder={t('projects.page.labelPlaceholder', {
              defaultValue: 'Add or create a label',
            })}
          />
          {isNewName ? (
            <p className="text-2xs text-text-muted">
              {t('projects.page.createTagHint', { name: normalized })}
            </p>
          ) : null}
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {loading ? (
              <ChipCloudSkeleton chips={5} />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {options.map((row) => {
                  const on = selectedSet.has(row.name)
                  return (
                    <TagPill
                      key={row.id}
                      names={[row.name]}
                      tone="free"
                      size="md"
                      selected={on}
                      onClick={() => {
                        toggle(row.name)
                        setQuery('')
                      }}
                      disabled={busy}
                      className="transition-transform duration-150 hover:-translate-y-px active:scale-[0.98]"
                    />
                  )
                })}
                {isNewName ? (
                  <TagPill
                    names={normalized}
                    tone="free"
                    size="md"
                    selected
                    onClick={addDraft}
                    disabled={busy}
                    className="border border-dashed border-border/70 bg-transparent"
                  />
                ) : null}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('projects.page.cancel')}
          </Button>
          <Button type="button" onClick={() => void confirm()} disabled={!canSubmit || busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            {t('projects.page.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
