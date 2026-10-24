import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessagesSquare } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import type { InboxThread } from '../../lib/inbox-api'
import { listSignalThreads } from '../../lib/signals-api'
import { cn } from '../../lib/utils'
import { EmptyState } from '../ui/empty-state'
import { Input } from '../ui/input'
import { Pressable } from '../ui/pressable'

const SEARCH_DEBOUNCE_MS = 220

/** Search box plus a short list of conversations; picking one calls `onPick`. */
export function ConversationPicker({
  excludeId,
  selectedId,
  onPick,
  autoFocus = true,
}: {
  excludeId?: string | null
  selectedId?: string | null
  onPick: (thread: { id: string; title: string }) => void
  autoFocus?: boolean
}) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<InboxThread[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setLoading(true)
    const id = window.setTimeout(() => {
      void listSignalThreads(token, { search: query.trim() || undefined, perPage: 8 })
        .then((res) => {
          if (!cancelled) setRows([...res.items, ...res.outsideItems].filter((row) => row.id !== excludeId).slice(0, 8))
        })
        .catch(() => {
          if (!cancelled) setRows([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [token, query, excludeId])

  return (
    <div className="space-y-2">
      <Input
        autoFocus={autoFocus}
        value={query}
        placeholder={t('moveConversation.search')}
        aria-label={t('moveConversation.search')}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="max-h-56 overflow-y-auto rounded-md border border-border" role="listbox">
        {rows.length ? (
          rows.map((row) => {
            const title = row.emailSubject || t('chatStack.untitled')
            return (
              <Pressable
                key={row.id}
                role="option"
                aria-selected={selectedId === row.id}
                className={cn(
                  'flex items-center gap-2 rounded-none px-3 py-2 text-sm',
                  selectedId === row.id ? 'bg-bg-hover text-text-heading' : 'hover:bg-bg-hover/50',
                )}
                onClick={() => onPick({ id: row.id, title })}
              >
                <MessagesSquare size={14} className="shrink-0 text-text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{title}</span>
              </Pressable>
            )
          })
        ) : (
          <EmptyState
            tone="plain"
            size="sm"
            className="py-3"
            title={loading ? t('moveConversation.searching') : t('moveConversation.noResults')}
          />
        )}
      </div>
    </div>
  )
}
