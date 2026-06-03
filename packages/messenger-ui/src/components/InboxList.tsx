import { useEffect, useState } from 'react'
import type { ApiConfig, InboxItem } from '../index'
import { listInbox } from '../index'

const CHANNEL_LABELS: Record<string, string> = {
  assistant: 'Assistent',
  customer_widget: 'Widget',
  email: 'E-mail',
  decision: 'Beslissing',
  conversation: 'Chat',
}

function channelLabel(channel: string, kind: InboxItem['kind']) {
  if (kind === 'decision') return CHANNEL_LABELS.decision
  if (kind === 'email_thread') return CHANNEL_LABELS.email
  return CHANNEL_LABELS[channel] ?? channel
}

function formatWhen(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const now = Date.now()
  const diffMs = now - d.getTime()
  if (diffMs < 60_000) return 'Just now'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

type Props = {
  config: ApiConfig
  onSelect?: (item: InboxItem) => void
  channelFilter?: string
  limit?: number
}

export function InboxList({ config, onSelect, channelFilter, limit = 50 }: Props) {
  const [items, setItems] = useState<InboxItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    listInbox(config, { channel: channelFilter, limit })
      .then(setItems)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [config, channelFilter, limit])

  if (loading) {
    return <p className="bk-inbox-empty">Loading inbox...</p>
  }

  if (items.length === 0) {
    return <p className="bk-inbox-empty">Inbox is empty.</p>
  }

  return (
    <ul className="bk-inbox-list">
      {items.map((item) => (
        <li key={`${item.kind}-${item.id}`}>
          <button type="button" className="bk-inbox-item" onClick={() => onSelect?.(item)}>
            <span className={`bk-inbox-channel bk-inbox-channel--${item.channel.replace(/[^a-z0-9_-]/gi, '_')}`}>
              {channelLabel(item.channel, item.kind)}
            </span>
            <span className="bk-inbox-title">{item.title}</span>
            <span className="bk-inbox-time">{formatWhen(item.updated_at)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
