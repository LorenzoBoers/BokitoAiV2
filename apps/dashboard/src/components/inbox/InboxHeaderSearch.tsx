import { BookmarkPlus, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOptionalInboxCommunication } from '../../context/InboxCommunicationContext'
import { readSavedSearches, writeSavedSearches } from '../../lib/inbox-ops'
import { cn } from '../../lib/utils'

export default function InboxHeaderSearch() {
  const { t } = useTranslation('communication')
  const inbox = useOptionalInboxCommunication()
  const [saved, setSaved] = useState(readSavedSearches)
  const [open, setOpen] = useState(false)

  const canSave = useMemo(() => Boolean(inbox?.search.trim()), [inbox?.search])

  if (!inbox) return null

  const { search, setSearch } = inbox

  return (
    <div className="relative w-72 shrink-0">
      <Search
        size={15}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        aria-hidden
      />
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        id="inbox-search"
        placeholder={t('inboxSearchPlaceholder')}
        aria-label={t('inboxSearchPlaceholder')}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          if (search) setSearch('')
          event.currentTarget.blur()
        }}
        className={cn(
          'h-9 w-full rounded-full border border-border/60 bg-bg-surface pl-9 pr-16 text-sm text-text-primary',
          'placeholder:text-text-muted/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
          'transition-[border-color,box-shadow,background-color] duration-150',
          'focus:outline-none focus:border-accent/45 focus:bg-bg-surface focus:ring-2 focus:ring-accent/15',
        )}
      />
      {canSave ? (
        <button
          type="button"
          title={t('inboxSearchSave')}
          aria-label={t('inboxSearchSave')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const query = search.trim()
            if (!query) return
            const next = [
              { id: `${Date.now()}`, name: query, query },
              ...saved.filter((row) => row.query !== query),
            ]
            writeSavedSearches(next)
            setSaved(next)
          }}
          className="absolute right-8 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-full text-text-muted hover:bg-bg-hover hover:text-text-primary"
        >
          <BookmarkPlus size={13} />
        </button>
      ) : null}
      {search ? (
        <button
          type="button"
          onClick={() => setSearch('')}
          aria-label={t('inboxSearchClear')}
          className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-full text-text-muted hover:bg-bg-hover hover:text-text-primary"
        >
          <X size={13} />
        </button>
      ) : null}
      {open && saved.length > 0 ? (
        <div className="absolute left-0 right-0 top-10 z-40 rounded-lg border border-border/60 bg-bg-surface p-1 shadow-lg">
          {saved.map((row) => (
            <button
              key={row.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setSearch(row.query)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            >
              <span className="truncate">{row.name}</span>
              <span
                role="button"
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation()
                  const next = saved.filter((item) => item.id !== row.id)
                  writeSavedSearches(next)
                  setSaved(next)
                }}
                className="text-[10px] text-text-muted hover:text-status-error"
              >
                {t('inboxSearchForget')}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
