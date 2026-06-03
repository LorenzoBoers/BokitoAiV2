import { useEffect, useState } from 'react'
import type { ApiConfig, Conversation } from '../index'
import { deleteConversation, listConversations, renameConversation } from '../index'

type Props = {
  config: ApiConfig
  activeId?: string | null
  onSelect: (conversation: Conversation) => void
  onCreate?: () => void
  channel?: string
}

export function ThreadList({ config, activeId, onSelect, onCreate, channel }: Props) {
  const [threads, setThreads] = useState<Conversation[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  async function refresh() {
    const items = await listConversations(config, channel)
    setThreads(items)
  }

  useEffect(() => {
    void refresh().catch(console.error)
  }, [config, channel])

  async function handleRename(id: string) {
    const title = editTitle.trim()
    if (!title) return
    setBusyId(id)
    try {
      await renameConversation(config, id, title)
      setEditingId(null)
      await refresh()
    } catch (e) {
      console.error(e)
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this conversation?')) return
    setBusyId(id)
    try {
      await deleteConversation(config, id)
      await refresh()
    } catch (e) {
      console.error(e)
    } finally {
      setBusyId(null)
    }
  }

  function formatWhen(value: string) {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return value
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  return (
    <div className="bk-thread-list">
      <div className="bk-thread-list-header">
        <span>Threads</span>
        {onCreate ? (
          <button type="button" className="bk-thread-list-new" onClick={onCreate}>
            New
          </button>
        ) : null}
      </div>
      <ul className="bk-thread-list-items">
        {threads.length === 0 ? (
          <li className="bk-thread-list-empty">No conversations yet.</li>
        ) : (
          threads.map((thread) => (
            <li
              key={thread.id}
              className={`bk-thread-list-item${activeId === thread.id ? ' bk-thread-list-item--active' : ''}`}
            >
              {editingId === thread.id ? (
                <div className="bk-thread-list-edit">
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleRename(thread.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    autoFocus
                  />
                  <button type="button" onClick={() => void handleRename(thread.id)} disabled={busyId === thread.id}>
                    Save
                  </button>
                </div>
              ) : (
                <>
                  <button type="button" className="bk-thread-list-select" onClick={() => onSelect(thread)}>
                    <span className="bk-thread-list-title">{thread.title}</span>
                    <span className="bk-thread-list-meta">
                      {thread.ai_paused ? 'Human' : 'AI'} · {formatWhen(thread.updated_at)}
                    </span>
                  </button>
                  <div className="bk-thread-list-actions">
                    <button
                      type="button"
                      aria-label="Rename"
                      disabled={busyId === thread.id}
                      onClick={() => {
                        setEditingId(thread.id)
                        setEditTitle(thread.title)
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      aria-label="Delete"
                      disabled={busyId === thread.id}
                      onClick={() => void handleDelete(thread.id)}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
