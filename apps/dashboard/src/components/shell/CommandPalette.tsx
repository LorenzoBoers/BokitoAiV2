import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CornerDownLeft, Inbox, MessageSquare, Moon, Plus, User } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useChatSessions } from '../../context/ChatSessionsContext'
import { TAB_GROUPS, iconForTab, pathForTab, subtitleForTab, titleForTab } from '../../lib/navigation'
import { assistantPath, inboxPath } from '../../lib/messages-paths'
import { listSignalThreads } from '../../lib/signals-api'
import { listContacts, type ContactRow } from '../../lib/contacts-api'
import type { InboxThread } from '../../lib/inbox-api'
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
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const { toggleMode, isDark } = useTheme()
  const { conversations, startNewChat } = useChatSessions()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [threadResults, setThreadResults] = useState<InboxThread[]>([])
  const [contactResults, setContactResults] = useState<ContactRow[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Remote search: threads and contacts matching the typed query (debounced).
  useEffect(() => {
    const q = query.trim()
    if (!token || q.length < 2) {
      setThreadResults([])
      setContactResults([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void listSignalThreads(token, { search: q, perPage: 5 })
        .then((res) => {
          if (!cancelled) setThreadResults(res.items)
        })
        .catch(() => {
          if (!cancelled) setThreadResults([])
        })
      void listContacts(token, { search: q })
        .then((rows) => {
          if (!cancelled) setContactResults(rows.slice(0, 5))
        })
        .catch(() => {
          if (!cancelled) setContactResults([])
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [token, query])

  const items = useMemo<PaletteItem[]>(() => {
    const nav: PaletteItem[] = TAB_GROUPS.flatMap((group) =>
      group.tabs.map((tab) => ({
        id: `nav-${tab}`,
        label: t(`tabs.${tab}.title`, { defaultValue: titleForTab(tab) }),
        hint: t(`tabs.${tab}.subtitle`, { defaultValue: subtitleForTab(tab) }),
        group: t('palette.groupGoTo'),
        icon: iconForTab(tab),
        run: () => navigate(pathForTab(tab)),
      })),
    )
    const sessions: PaletteItem[] = conversations.slice(0, 8).map((c) => ({
      id: `session-${c.id}`,
      label: c.title || t('palette.untitledConversation'),
      group: t('palette.groupSessions'),
      icon: MessageSquare,
      run: () => navigate(assistantPath(c.id)),
    }))
    const actions: PaletteItem[] = [
      {
        id: 'action-new-chat',
        label: t('palette.newChat'),
        group: t('palette.groupActions'),
        icon: Plus,
        run: () => startNewChat(),
      },
      {
        id: 'action-theme',
        label: isDark ? t('palette.switchToLight') : t('palette.switchToDark'),
        group: t('palette.groupActions'),
        icon: Moon,
        run: () => toggleMode(),
      },
    ]
    return [...nav, ...sessions, ...actions]
  }, [conversations, navigate, startNewChat, toggleMode, isDark, t])

  const remoteItems = useMemo<PaletteItem[]>(() => {
    const threads: PaletteItem[] = threadResults.map((thread) => ({
      id: `thread-${thread.id}`,
      label: thread.emailSubject || t('palette.untitledConversation'),
      hint: thread.contactName || thread.contactEmail || undefined,
      group: t('palette.groupThreads'),
      icon: Inbox,
      run: () => navigate(inboxPath('all', String(thread.id))),
    }))
    const contacts: PaletteItem[] = contactResults.map((contact) => ({
      id: `contact-${contact.id}`,
      label: contact.displayName || contact.address || t('palette.unnamedContact'),
      hint: contact.address || undefined,
      group: t('palette.groupContacts'),
      icon: User,
      run: () => navigate(`/contacts/${contact.id}`),
    }))
    return [...threads, ...contacts]
  }, [threadResults, contactResults, navigate, t])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    const local = items.filter(
      (item) => item.label.toLowerCase().includes(q) || item.hint?.toLowerCase().includes(q),
    )
    return [...local, ...remoteItems]
  }, [items, remoteItems, query])

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
          placeholder={t('palette.placeholder')}
          className="w-full border-b border-border/60 bg-transparent px-4 py-3.5 text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        <div ref={listRef} className="max-h-[340px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-text-muted">{t('palette.noResults')}</p>
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
