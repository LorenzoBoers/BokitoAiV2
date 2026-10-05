import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, Plus, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import type { InboxThread, PatchThreadInput } from '../../lib/inbox-api'
import { listSignalTags, type SignalTag } from '../../lib/signals-api'

type Props = {
  thread: InboxThread
  saving?: boolean
  onPatch?: (input: PatchThreadInput) => Promise<void>
}

const CHIP =
  'inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-border/70 px-2 text-xs text-text-heading'

/**
 * The tag row: the conversation's category first (locked; it changes under
 * Category), then free tags from the workspace list. Typing a new name adds it
 * to the list.
 */
export function ThreadTags({ thread, saving = false, onPatch }: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const listId = useId()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [registry, setRegistry] = useState<SignalTag[]>([])
  const tags = thread.tags ?? []
  const category = thread.categoryCase && thread.categoryCase.status !== 'proposed' ? thread.categoryCase : null

  useEffect(() => {
    if (!adding || !token) return
    let cancelled = false
    void listSignalTags(token)
      .then((rows) => {
        if (!cancelled) setRegistry(rows)
      })
      .catch(() => {
        if (!cancelled) setRegistry([])
      })
    return () => {
      cancelled = true
    }
  }, [adding, token])

  const save = (next: string[]) => (onPatch ? onPatch({ tags: next }) : Promise.resolve())

  const add = async () => {
    const name = draft.trim().replace(/\s+/g, ' ').toLowerCase()
    setDraft('')
    setAdding(false)
    if (!name || tags.includes(name)) return
    await save([...tags, name])
  }

  const suggestions = registry.filter((row) => !tags.includes(row.name))

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {category ? (
        <span
          className={`${CHIP} bg-bg-subtle/60`}
          title={t('tags.categoryLocked', { defaultValue: 'Category. Change it under Category.' })}
        >
          <Lock size={10} className="shrink-0 text-text-muted" />
          <span className="truncate-fade">{category.name}</span>
        </span>
      ) : null}
      {tags.map((tag) => (
        <span key={tag} className={CHIP}>
          <span className="truncate-fade">{tag}</span>
          {onPatch ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void save(tags.filter((other) => other !== tag))}
              aria-label={t('tags.remove', { defaultValue: 'Remove tag {{tag}}', tag })}
              className="-mr-0.5 rounded text-text-muted hover:text-text-primary disabled:opacity-40"
            >
              <X size={11} />
            </button>
          ) : null}
        </span>
      ))}
      {onPatch ? (
        adding ? (
          <>
            <input
              autoFocus
              list={listId}
              value={draft}
              disabled={saving}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void add()
                } else if (e.key === 'Escape') {
                  setDraft('')
                  setAdding(false)
                }
              }}
              onBlur={() => void add()}
              placeholder={t('tags.placeholder', { defaultValue: 'Tag name' })}
              aria-label={t('tags.add', { defaultValue: 'Add tag' })}
              className="h-6 w-28 rounded-md border border-accent/50 bg-bg-surface px-2 text-xs text-text-primary focus:outline-none"
            />
            <datalist id={listId}>
              {suggestions.map((row) => (
                <option key={row.id} value={row.name}>
                  {row.description || undefined}
                </option>
              ))}
            </datalist>
          </>
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={() => setAdding(true)}
            className={`${CHIP} text-text-secondary transition-colors hover:bg-bg-hover/70 disabled:opacity-40`}
          >
            <Plus size={11} />
            {t('tags.add', { defaultValue: 'Add tag' })}
          </button>
        )
      ) : null}
    </div>
  )
}
