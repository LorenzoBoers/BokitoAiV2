import { Loader2, Pause, Play, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { CardTitle } from '../ui/card'
import { type WorkforceNode } from '../../lib/workforce-graph'

interface Props {
  workforceTitle: string
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  realtimeDebug: string | null
  isLoading: boolean
  isActioning: boolean
  managerNode: WorkforceNode | null
  onOpenAssistantConfig?: () => void
  onOpenControl?: () => void
  onRefresh: () => void
  onToggleManager: (status: 'active' | 'standby') => void
}

export default function WorkforceHeader({
  workforceTitle,
  connectionState,
  realtimeDebug,
  isLoading,
  isActioning,
  managerNode,
  onOpenAssistantConfig,
  onOpenControl,
  onRefresh,
  onToggleManager,
}: Props) {
  const managerRunning =
    managerNode?.status === 'active' ||
    managerNode?.status === 'activating' ||
    managerNode?.status === 'awaiting'

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <CardTitle className="text-sm truncate">{workforceTitle}</CardTitle>
        <Badge variant={connectionState === 'connected' ? 'success' : 'warning'}>
          {connectionState === 'connected' ? <Wifi size={10} className="mr-1" /> : <WifiOff size={10} className="mr-1" />}
          {connectionState === 'connected' ? 'Live' : 'Polling'}
        </Badge>
        {connectionState !== 'connected' && realtimeDebug ? (
          <span className="text-2xs text-text-muted truncate max-w-[300px]" title={realtimeDebug}>
            {realtimeDebug}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-bg-elevated/90 p-1 shadow-sm shrink-0">
        <Button size="sm" variant="secondary" className="h-7 font-semibold" onClick={onOpenAssistantConfig}>
          Assistent
        </Button>
        <Button size="sm" variant="secondary" className="h-7 font-semibold" onClick={onOpenControl}>
          Control
        </Button>
        <Button size="sm" variant="ghost" className="h-7" onClick={onRefresh} disabled={isLoading}>
          {isLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </Button>
        {managerNode ? (
          managerRunning ? (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 font-semibold"
              onClick={() => onToggleManager('standby')}
              disabled={isActioning}
            >
              {isActioning ? <Loader2 size={13} className="animate-spin" /> : <Pause size={13} />}
              Standby
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 font-semibold"
              onClick={() => onToggleManager('active')}
              disabled={isActioning}
            >
              {isActioning ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              Activeer
            </Button>
          )
        ) : null}
      </div>
    </div>
  )
}
