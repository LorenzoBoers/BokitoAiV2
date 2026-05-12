import { Search } from 'lucide-react'
import type { InboxThread } from '../../lib/inbox-api'
import ThreadListItem from './ThreadListItem'

type Props = {
  threads: InboxThread[]
  loading: boolean
  error: string | null
  selectedId: number | null
  search: string
  onSelectThread: (id: number) => void
  onSearchChange: (search: string) => void
}

export default function ThreadList({
  threads,
  loading,
  error,
  selectedId,
  search,
  onSelectThread,
  onSearchChange,
}: Props) {
  return (
    <div className="flex flex-col h-full min-h-0 w-72 shrink-0 border-r border-border/50 bg-bg-surface">
      <div className="px-3 pt-3 pb-2 border-b border-border/50">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Zoek in threads..."
            className="w-full rounded-md border border-border bg-bg-surface-hover pl-8 pr-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-1.5 space-y-0.5">
        {loading ? (
          <div className="py-8 text-center text-xs text-text-muted">Laden...</div>
        ) : error ? (
          <div className="py-4 px-3 text-xs text-status-error">{error}</div>
        ) : threads.length === 0 ? (
          <div className="py-8 text-center text-xs text-text-muted">Geen threads gevonden.</div>
        ) : (
          threads.map((thread) => (
            <ThreadListItem
              key={thread.id}
              thread={thread}
              isSelected={thread.id === selectedId}
              onSelect={onSelectThread}
            />
          ))
        )}
      </div>
    </div>
  )
}
