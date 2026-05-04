import { activities } from '../../data/mock-data'

const typeColors: Record<string, string> = {
  message: 'bg-accent-muted text-accent',
  agent: 'bg-status-info/15 text-status-info',
  system: 'bg-bg-elevated text-text-muted',
  user: 'bg-status-warning/15 text-status-warning',
}

export default function ActivityFeed() {
  return (
    <div className="panel flex-1 flex flex-col min-h-0">
      <div className="panel-header">
        <h3 className="text-sm font-semibold text-text-heading">Recente activiteit</h3>
        <button className="text-xs text-text-secondary hover:text-accent transition-colors">
          Alles bekijken
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {activities.map((item) => (
          <div
            key={item.id}
            className="flex items-start gap-3 px-4 py-2.5 border-b border-border/60 hover:bg-bg-hover/40 transition-colors"
          >
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5 ${typeColors[item.type]}`}
            >
              {item.avatar}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs leading-relaxed">
                <span className="font-semibold text-text-primary">{item.user}</span>{' '}
                <span className="text-text-secondary">{item.action}</span>{' '}
                <span className="font-medium text-accent">{item.target}</span>
              </p>
              <span className="text-2xs text-text-muted">{item.timestamp}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
