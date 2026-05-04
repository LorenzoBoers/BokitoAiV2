import {
  MessageSquarePlus,
  Bot,
  BarChart3,
  Building2,
} from 'lucide-react'
import { quickActions } from '../../data/mock-data'

const iconMap: Record<string, React.ElementType> = {
  'message-square-plus': MessageSquarePlus,
  bot: Bot,
  'bar-chart-3': BarChart3,
  'building-2': Building2,
}

export default function QuickActions() {
  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="text-sm font-semibold text-text-heading">Snelle acties</h3>
      </div>
      <div className="p-2 grid grid-cols-1 gap-1">
        {quickActions.map((action) => {
          const Icon = iconMap[action.icon] || MessageSquarePlus
          return (
            <button
              key={action.id}
              className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-bg-hover transition-colors text-left group/action"
            >
              <div className="w-8 h-8 rounded-md bg-accent-subtle flex items-center justify-center group-hover/action:bg-accent-muted transition-colors">
                <Icon size={15} className="text-accent" />
              </div>
              <div>
                <div className="text-[13px] font-medium text-text-primary">
                  {action.label}
                </div>
                <div className="text-[11px] text-text-muted">{action.description}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
