import {
  Inbox,
  Mail,
  Search,
} from 'lucide-react'
import type { EmailConnection } from '../../lib/email-api'

function ChannelItem({
  connection,
  selected,
  onClick,
}: {
  connection: EmailConnection
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
        selected
          ? 'text-accent'
          : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      <Inbox size={14} className="flex-shrink-0 opacity-60" />
      <span className="truncate flex-1 text-left">{connection.displayName || connection.mailboxEmail}</span>
      <span className="text-2xs text-text-muted">{connection.provider === 'gmail' ? 'Gmail' : 'Outlook'}</span>
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="section-label px-2">{title}</div>
      <div className="flex flex-col gap-0.5 px-1.5">{children}</div>
    </div>
  )
}

type ChannelSidebarProps = {
  connections: EmailConnection[]
  selectedConnectionId: number | null
  onSelectConnectionId: (id: number) => void
}

export default function ChannelSidebar({
  connections,
  selectedConnectionId,
  onSelectConnectionId,
}: ChannelSidebarProps) {
  return (
    <div className="w-[218px] bg-bg-sidebar/45 border-r border-border/70 flex flex-col h-full flex-shrink-0">
      {/* Header */}
      <div className="h-10 flex items-center justify-between px-3 border-b border-border/70 flex-shrink-0">
        <span className="text-[13px] font-semibold text-text-heading">Mailboxen</span>
      </div>

      <div className="px-2.5 pt-2 pb-1">
        <div className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted">
          <Search size={12} />
          Zoeken in mailbox...
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2 space-y-1">
        <Section title="Mailbox verbindingen">
          {connections.length > 0 ? (
            connections.map((connection) => (
              <ChannelItem
                key={connection.id}
                connection={connection}
                selected={selectedConnectionId === connection.id}
                onClick={() => onSelectConnectionId(connection.id)}
              />
            ))
          ) : (
            <div className="px-2.5 py-2 text-xs text-text-muted flex items-center gap-1.5">
              <Mail size={12} />
              No active mailboxes
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}
