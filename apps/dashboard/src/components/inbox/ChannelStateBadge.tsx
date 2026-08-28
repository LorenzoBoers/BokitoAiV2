import { useTranslation } from 'react-i18next'
import { Badge } from '../ui/badge'
import { channelStateLabel } from '../../lib/status-labels'
import type { ChannelCapability, ChannelState } from '../../lib/channels-api'

const STATE_VARIANTS: Record<ChannelState, 'success' | 'warning' | 'error' | 'neutral' | 'info'> = {
  active: 'success',
  connecting: 'info',
  degraded: 'warning',
  setup_required: 'warning',
  action_required: 'error',
  error: 'error',
  paused: 'neutral',
}

/** The one channel state badge: same wording in the list, the hub, and the cockpit. */
export function ChannelStateBadge({ state }: { state: ChannelState }) {
  const { t } = useTranslation('communication')
  return <Badge variant={STATE_VARIANTS[state] ?? 'neutral'}>{channelStateLabel(state, t)}</Badge>
}

export function ChannelCapabilityChips({ capabilities }: { capabilities: ChannelCapability[] }) {
  const { t } = useTranslation('nav')
  if (capabilities.length === 0) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {capabilities.map((capability) => (
        <span
          key={capability}
          className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted"
        >
          {t(`channelsPage.capability.${capability}`)}
        </span>
      ))}
    </span>
  )
}
