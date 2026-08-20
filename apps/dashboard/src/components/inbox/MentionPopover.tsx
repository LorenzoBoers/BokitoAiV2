import { Bot } from 'lucide-react'
import { UserAvatar } from '../ui/UserAvatar'
import type { MentionItem } from '../../lib/mentions'

type Props = {
  items: MentionItem[]
  activeIndex: number
  onSelect: (item: MentionItem) => void
  onHover: (index: number) => void
}

/**
 * Mention suggestion list shown above a composer while typing `@...`.
 * Renders teammates (and agents, when provided) with avatars.
 */
export default function MentionPopover({ items, activeIndex, onSelect, onHover }: Props) {
  if (items.length === 0) return null
  return (
    <div className="absolute bottom-full left-0 z-30 mb-1.5 w-72 overflow-hidden rounded-xl border border-border/60 bg-bg-surface shadow-overlay">
      <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-text-muted">
        Mention
      </div>
      <ul className="max-h-56 overflow-y-auto pb-1.5">
        {items.map((item, index) => (
          <li key={`${item.type}-${item.id}`}>
            <button
              type="button"
              // Mousedown so the textarea keeps focus (blur would close the menu).
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(item)
              }}
              onMouseEnter={() => onHover(index)}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
                index === activeIndex ? 'bg-bg-hover' : ''
              }`}
            >
              {item.type === 'agent' ? (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <Bot size={13} />
                </span>
              ) : (
                <UserAvatar name={item.name} email={item.email ?? ''} avatarUrl={item.avatarUrl ?? null} size={24} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-text-primary">{item.name}</span>
                {item.email ? (
                  <span className="block truncate text-[11px] text-text-muted">{item.email}</span>
                ) : null}
              </span>
              {item.type === 'agent' ? (
                <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-accent">
                  Agent
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
