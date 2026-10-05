import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  createSignalTag,
  deleteSignalTag,
  listSignalTags,
  updateSignalTag,
  type SignalTag,
} from '../../lib/signals-api'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

type Draft = { name: string; description: string }

/**
 * The workspace tag list. Agents and inbox rules only apply tags from this
 * list; operators add to it by tagging a conversation or here. Renaming onto
 * an existing name merges the two tags.
 */
export function TagRegistrySection() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [tags, setTags] = useState<SignalTag[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ name: '', description: '' })
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    try {
      setTags(await listSignalTags(token))
    } catch {
      setError(t('tagRegistry.loadFailed'))
    }
  }, [token, t])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setEditingId(null)
      setCreating(false)
      await load()
    } catch {
      setError(t('tagRegistry.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (tag: SignalTag) => {
    setCreating(false)
    setEditingId(tag.id)
    setDraft({ name: tag.name, description: tag.description })
  }

  const editor = (onSave: () => void) => (
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      <Input
        autoFocus
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        placeholder={t('tagRegistry.namePlaceholder')}
        aria-label={t('tagRegistry.namePlaceholder')}
        className="h-7 w-36 text-xs"
      />
      <Input
        value={draft.description}
        onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
        placeholder={t('tagRegistry.descriptionPlaceholder')}
        aria-label={t('tagRegistry.descriptionPlaceholder')}
        className="h-7 min-w-40 flex-1 text-xs"
      />
      <Button size="sm" variant="ghost" disabled={busy || !draft.name.trim()} onClick={onSave} aria-label={t('tagRegistry.save')}>
        <Check size={13} />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          setEditingId(null)
          setCreating(false)
        }}
        aria-label={t('tagRegistry.cancel')}
      >
        <X size={13} />
      </Button>
    </div>
  )

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text-heading">{t('tagRegistry.title')}</p>
          <p className="text-xs text-text-secondary">{t('tagRegistry.description')}</p>
        </div>
        {!creating ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setEditingId(null)
              setDraft({ name: '', description: '' })
              setCreating(true)
            }}
          >
            <Plus size={13} />
            {t('tagRegistry.newTag')}
          </Button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-xs text-status-error">{error}</p> : null}
      <div className="mt-2 divide-y divide-border/40">
        {creating
          ? editor(() =>
              void run(() =>
                token ? createSignalTag(token, { name: draft.name, description: draft.description }) : Promise.resolve(),
              ),
            )
          : null}
        {tags.length === 0 && !creating ? (
          <p className="py-2 text-xs text-text-muted">{t('tagRegistry.empty')}</p>
        ) : null}
        {tags.map((tag) =>
          editingId === tag.id ? (
            <div key={tag.id}>
              {editor(() =>
                void run(() =>
                  token
                    ? updateSignalTag(token, tag.id, { name: draft.name, description: draft.description })
                    : Promise.resolve(),
                ),
              )}
            </div>
          ) : (
            <div key={tag.id} className="flex items-center gap-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate-fade text-xs font-medium text-text-heading">{tag.name}</p>
                {tag.description ? (
                  <p className="truncate-fade text-2xs text-text-muted">{tag.description}</p>
                ) : null}
              </div>
              <span className="shrink-0 text-2xs text-text-muted">
                {t('tagRegistry.count', { count: tag.count })}
              </span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => startEdit(tag)} aria-label={t('tagRegistry.edit')}>
                <Pencil size={12} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={t('tagRegistry.delete')}
                onClick={() => {
                  if (!window.confirm(t('tagRegistry.deleteConfirm', { name: tag.name, count: tag.count }))) return
                  void run(() => (token ? deleteSignalTag(token, tag.id) : Promise.resolve()))
                }}
              >
                <Trash2 size={12} />
              </Button>
            </div>
          ),
        )}
      </div>
    </div>
  )
}
