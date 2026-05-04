import {
  MessageSquare,
  Users,
  Zap,
  Cpu,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react'
import type { StatCard as StatCardType } from '../../types'

const iconMap: Record<string, React.ElementType> = {
  'message-square': MessageSquare,
  users: Users,
  zap: Zap,
  cpu: Cpu,
}

const changeIcon: Record<string, React.ElementType> = {
  up: TrendingUp,
  down: TrendingDown,
  neutral: Minus,
}

const changeColor: Record<string, string> = {
  up: 'text-status-success',
  down: 'text-status-error',
  neutral: 'text-text-muted',
}

export default function StatsCard({ stat }: { stat: StatCardType }) {
  const Icon = iconMap[stat.icon] || MessageSquare
  const ChangeIcon = changeIcon[stat.changeType] || Minus

  return (
    <div className="stat-card group/stat hover:border-border-light transition-colors">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary font-medium">{stat.label}</span>
        <Icon size={15} className="text-text-muted group-hover/stat:text-accent transition-colors" />
      </div>
      <div className="text-xl font-semibold text-text-heading tracking-tight">
        {stat.value}
      </div>
      <div className={`flex items-center gap-1 text-xs font-medium ${changeColor[stat.changeType]}`}>
        <ChangeIcon size={12} />
        <span>{stat.change}</span>
        <span className="text-text-muted font-normal ml-1">vs vorige periode</span>
      </div>
    </div>
  )
}
