import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useOptionalInboxCommunication } from '../../context/InboxCommunicationContext'
import { cn } from '../../lib/utils'

export default function InboxHeaderSearch() {
  const { t } = useTranslation('communication')
  const inbox = useOptionalInboxCommunication()

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
        placeholder={t('inboxSearchPlaceholder')}
        aria-label={t('inboxSearchPlaceholder')}
        className={cn(
          'h-9 w-full rounded-full border border-border/60 bg-bg-surface pl-9 pr-9 text-sm text-text-primary',
          'placeholder:text-text-muted/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
          'transition-[border-color,box-shadow,background-color] duration-150',
          'focus:outline-none focus:border-accent/45 focus:bg-bg-surface focus:ring-2 focus:ring-accent/15',
        )}
      />
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
    </div>
  )
}
