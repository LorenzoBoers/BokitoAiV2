import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Plus, Tag } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAuth } from '../../context/AuthContext'
import { useSignalTags } from '../../hooks/useSignalTags'
import { createSignalTag } from '../../lib/signals-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'

type Props = {
  /** Tags currently on the thread. */
  tags: string[]
  disabled?: boolean
  /** Persist the thread's next tag list. */
  onChange: (next: string[]) => Promise<void> | void
}

function normalize(raw: string): string {
  return raw.split(/\s+/).filter(Boolean).join(' ').toLowerCase().slice(0, 40)
}

/**
 * Add tags to a thread from the tenant vocabulary, or create one on the spot.
 *
 * Suggesting the registry keeps the vocabulary small enough to be useful as
 * folders and as the list AI tagging picks from; a new tag typed here is
 * registered, so it appears in settings and the sidebar for everyone.
 */
export function TagPicker({ tags, disabled = false, onChange }: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const { tags: registry, loading } = useSignalTags()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const applied = useMemo(() => new Set(tags.map(normalize)), [tags])
  const normalizedQuery = normalize(query)

  const options = useMemo(() => {
    const rows = registry.filter((row) =>
      normalizedQuery ? row.tag.includes(normalizedQuery) : true,
    )
    // Tags already on the thread sink to the bottom: the common action is
    // adding, and the chips above already show what is applied.
    return rows.sort((a, b) => {
      const onThread = Number(applied.has(a.tag)) - Number(applied.has(b.tag))
      return onThread !== 0 ? onThread : b.total - a.total || a.tag.localeCompare(b.tag)
    })
  }, [registry, normalizedQuery, applied])

  const canCreate =
    normalizedQuery.length > 0 && !registry.some((row) => row.tag === normalizedQuery)

  const toggle = async (tag: string) => {
    const next = applied.has(tag)
      ? tags.filter((current) => normalize(current) !== tag)
      : [...tags, tag]
    setQuery('')
    await onChange(next)
  }

  const create = async () => {
    if (!token || !canCreate || busy) return
    setBusy(true)
    try {
      const name = await createSignalTag(token, normalizedQuery)
      setQuery('')
      await onChange([...tags, name])
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('tags.createError')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/60 px-2 py-0.5 text-[11px] text-text-muted transition-colors hover:border-accent/40 hover:text-text-secondary disabled:opacity-40"
      >
        <Plus size={9} />
        {t('tags.addLabel')}
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-lg border border-border/70 bg-bg-elevated shadow-lg">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                if (options.length > 0 && !canCreate) void toggle(options[0].tag)
                else if (canCreate) void create()
              }
            }}
            placeholder={t('tags.searchPlaceholder')}
            aria-label={t('tags.searchPlaceholder')}
            className="h-8 w-full border-b border-border/50 bg-transparent px-2.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          <div className="max-h-56 overflow-y-auto py-1" role="listbox">
            {loading ? (
              <p className="px-2.5 py-1.5 text-[11px] text-text-muted">{t('tags.loading')}</p>
            ) : options.length === 0 && !canCreate ? (
              <p className="px-2.5 py-1.5 text-[11px] text-text-muted">{t('tags.noneYet')}</p>
            ) : (
              options.map((row) => {
                const active = applied.has(row.tag)
                return (
                  <button
                    key={row.tag}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={disabled}
                    onClick={() => void toggle(row.tag)}
                    className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-bg-hover/70 disabled:opacity-40"
                  >
                    <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                      {active ? (
                        <Check size={11} className="text-accent" />
                      ) : (
                        <Tag size={10} className="text-text-muted" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'truncate text-xs',
                            active ? 'text-text-heading' : 'text-text-primary',
                          )}
                        >
                          {row.tag}
                        </span>
                        {row.total > 0 ? (
                          <span className="shrink-0 text-[10px] text-text-muted">{row.total}</span>
                        ) : null}
                      </span>
                      {row.description ? (
                        <span className="mt-0.5 block truncate text-[10px] text-text-muted">
                          {row.description}
                        </span>
                      ) : null}
                    </span>
                  </button>
                )
              })
            )}
            {canCreate ? (
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => void create()}
                className="flex w-full items-center gap-2 border-t border-border/50 px-2.5 py-1.5 text-left text-xs text-accent hover:bg-accent/10 disabled:opacity-40"
              >
                <Plus size={11} className="shrink-0" />
                <span className="truncate">{t('tags.createNamed', { tag: normalizedQuery })}</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default TagPicker
