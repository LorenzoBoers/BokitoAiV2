import { Search } from 'lucide-react'
import type { CloudAgent } from '../../types'
import { AiAvatar } from '../ui/AiAvatar'

const statusLabel: Record<CloudAgent['status'], string> = {
  active: 'Actief',
  paused: 'Gepauzeerd',
  deploying: 'Deploy…',
  error: 'Fout',
}

const statusClass: Record<CloudAgent['status'], string> = {
  active: 'bg-accent-muted text-accent',
  paused: 'bg-bg-elevated text-text-muted',
  deploying: 'bg-status-warning/15 text-status-warning',
  error: 'bg-status-error/15 text-status-error',
}

export default function AgentList({
  agents,
  selectedId,
  onSelect,
}: {
  agents: CloudAgent[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="panel flex flex-col h-full min-h-0 w-full max-w-md flex-shrink-0 rounded-lg border">
      <div className="panel-header py-2.5">
        <div className="relative w-full">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
          />
          <input
            type="search"
            placeholder="Zoek agents…"
            className="w-full pl-8 pr-2 py-1.5 rounded-md bg-bg-elevated border border-border text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-border-focus"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {agents.map((agent) => {
          const selected = agent.id === selectedId
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelect(agent.id)}
              className={`w-full text-left rounded-md px-2.5 py-2 transition-colors border ${
                selected
                  ? 'border-accent/40 ring-1 ring-inset ring-accent/25'
                  : 'border-transparent hover:bg-bg-hover'
              }`}
            >
              <div className="mb-0.5 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <AiAvatar name={agent.name} seed={agent.id} size={24} />
                  <span className="truncate text-sm font-medium text-text-heading">{agent.name}</span>
                </span>
                <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-2xs font-semibold ${statusClass[agent.status]}`}>
                  {statusLabel[agent.status]}
                </span>
              </div>
              <div className="text-2xs text-text-muted truncate font-mono">
                {agent.slug}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
