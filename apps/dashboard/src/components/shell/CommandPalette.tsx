import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, MessageSquare, Moon, Plus } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import { useChatSessions } from '../../context/ChatSessionsContext'
import { TAB_GROUPS, iconForTab, pathForTab, subtitleForTab, titleForTab } from '../../lib/navigation'
import { assistantPath } from '../../lib/messages-paths'
import type { LucideIcon } from 'lucide-react'

type PaletteItem = {
  id: string
  label: string
  hint?: string
  group: string
  icon: LucideIcon
  run: () => void
}

type CommandPaletteProps = {
  open: boolean
  onClose: () => void
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate()
  const { toggleMode, isDark } = useTheme()
  const { conversations, startNewChat } = useChatSessions()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo<PaletteItem[]>(() => {
    const nav: PaletteItem[] = TAB_GROUPS.flatMap((group) =>
      group.tabs.map((tab) => ({
        id: `nav-${tab}`,
        label: titleForTab(tab),
        hint: subtitleForTab(tab),
        group: 'Go to',
        icon: iconForTab(tab),
        run: () => navigate(pathForTab(tab)),
      })),
    )
    const sessions: PaletteItem[] = conversations.slice(0, 8).map((c) => ({
      id: `session-${c.id}`,
      label: c.title || 'Untitled conversation',
      group: 'Sessions',
      icon: MessageSquare,
      run: () => navigate(assistantPath(c.id)),
    }))
    const actions: PaletteItem[] = [
      {
        id: 'action-new-chat',
        label: 'New chat',
        group: 'Actions',
        icon: Plus,
        run: () => startNewChat(),
      },
      {
        id: 'action-theme',
        label: isDark ? 'Switch to light mode' : 'Switch to dark mode',
        group: 'Actions',
        icon: Moon,
        run: () => toggleMode(),
      },
    ]
    return [...nav, ...sessions, ...actions]
  }, [conversations, navigate, startNewChat, toggleMode, isDark])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (item) => item.label.toLowerCase().includes(q) || item.hint?.toLowerCase().includes(q),
    )
  }, [items, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (!open) return null

  const runItem = (item: PaletteItem) => {
    onClose()
    item.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[selectedIndex]
      if (item) runItem(item)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  let lastGroup: string | null = null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[14vh]">
      <button
        type="button"
        aria-label="Close command palette"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-[560px] overflow-hidden rounded-xl border border-border/70 bg-bg-surface shadow-2xl"
        role="dialog"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search pages, sessions, actions..."
          className="w-full border-b border-border/60 bg-transparent px-4 py-3.5 text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        <div ref={listRef} className="max-h-[340px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-text-muted">No results</p>
          ) : (
            filtered.map((item, index) => {
              const showGroup = item.group !== lastGroup
              lastGroup = item.group
              const Icon = item.icon
              const selected = index === selectedIndex
              return (
                <div key={item.id}>
                  {showGroup ? (
                    <p className="px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                      {item.group}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    data-selected={selected}
                    onClick={() => runItem(item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                      selected ? 'bg-accent/12 text-text-primary' : 'text-text-secondary'
                    }`}
                  >
                    <Icon size={14} className={selected ? 'text-accent' : 'text-text-muted'} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint ? (
                      <span className="hidden max-w-[200px] truncate text-[11px] text-text-muted sm:block">
                        {item.hint}
                      </span>
                    ) : null}
                    {selected ? <CornerDownLeft size={12} className="text-text-muted" /> : null}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
