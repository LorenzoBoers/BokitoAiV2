import { Gauge, Cpu } from 'lucide-react'
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

export default function AgentCardGrid({
  agents,
  selectedId,
  onSelect,
}: {
  agents: CloudAgent[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-fr">
      {agents.map((agent) => {
        const selected = agent.id === selectedId
        return (
          <button
            key={agent.id}
            type="button"
            onClick={() => onSelect(agent.id)}
            className={`text-left rounded-lg border transition-colors flex flex-col h-full min-h-[160px] p-4 bg-bg-surface hover:border-border-light ${
              selected
                ? 'border-accent/50 ring-1 ring-accent/25'
                : 'border-border'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <AiAvatar name={agent.name} seed={agent.id} size={36} />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-text-heading truncate">
                    {agent.name}
                  </h3>
                  <p className="text-2xs font-mono text-text-muted truncate">
                    {agent.slug}
                  </p>
                </div>
              </div>
              <span
                className={`flex-shrink-0 text-2xs font-semibold px-2 py-0.5 rounded-full ${statusClass[agent.status]}`}
              >
                {statusLabel[agent.status]}
              </span>
            </div>

            <p className="text-xs text-text-secondary line-clamp-2 flex-1 leading-relaxed mb-3">
              {agent.description}
            </p>

            <div className="flex flex-wrap gap-3 text-2xs text-text-muted pt-2 border-t border-border/80">
              <span className="inline-flex items-center gap-1 min-w-0" title={agent.model}>
                <Cpu size={11} className="text-text-muted flex-shrink-0" />
                <span className="font-mono truncate">{agent.model}</span>
              </span>
              <span className="inline-flex items-center gap-1" title="Requests 24u">
                <Gauge size={11} className="text-text-muted" />
                {agent.requests24h.toLocaleString('nl-NL')}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
