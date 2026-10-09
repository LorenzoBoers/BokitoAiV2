import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Play, RefreshCw, Wifi } from 'lucide-react'
import { AiHandlingIcon } from '../ai/AiHandlingIcon'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ChannelIcon, ChannelStatus } from './ChannelStatus'
import { channelFix, type ChannelActions, type ChannelFix } from './channel-actions'
import { AI_HANDLING_CHANNELS } from '../../lib/ai-handling'
import { formatAppDateTime } from '../../lib/app-locale'
import { channelSettingsPath, type ChannelRow } from '../../lib/channels-api'
import { inboxPath } from '../../lib/messages-paths'

export type ChannelListProps = {
  channels: ChannelRow[]
  loading: boolean
  busyId: string | null
  actions: Pick<ChannelActions, 'setPaused' | 'sync' | 'reconnect'>
  onAddChannel: () => void
}

function FixButton({
  fix,
  row,
  busy,
  actions,
}: {
  fix: ChannelFix
  row: ChannelRow
  busy: boolean
  actions: ChannelListProps['actions']
}) {
  const { t } = useTranslation('nav')
  if (fix === 'resume') {
    return (
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => actions.setPaused(row, false)}>
        <Play size={13} />
        {t('channelsPage.turnOn')}
      </Button>
    )
  }
  if (fix === 'reconnect') {
    return (
      <Button variant="secondary" size="sm" onClick={() => actions.reconnect(row)}>
        <Wifi size={13} />
        {t('channelsPage.reconnect')}
      </Button>
    )
  }
  return (
    <Button variant="secondary" size="sm" disabled={busy} onClick={() => actions.sync(row)}>
      <RefreshCw size={13} className={busy ? 'animate-spin' : undefined} />
      {busy ? t('channelsPage.syncing') : t('channelsPage.retrySync')}
    </Button>
  )
}

/**
 * Every channel is the same row: icon, name, state, AI handling, optional repair.
 * The row opens the channel's settings page.
 */
export default function ChannelList({ channels, loading, busyId, actions, onAddChannel }: ChannelListProps) {
  const { t, i18n } = useTranslation('nav')
  const { t: tc } = useTranslation('common')

  const sorted = useMemo(
    () =>
      [...channels].sort((a, b) => {
        const archivedA = a.state === 'archived' ? 1 : 0
        const archivedB = b.state === 'archived' ? 1 : 0
        if (archivedA !== archivedB) return archivedA - archivedB
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
        return a.label.localeCompare(b.label)
      }),
    [channels],
  )

  if (!loading && sorted.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-text-muted">
        <p>{t('channelsPage.noChannels')}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
          <button type="button" onClick={onAddChannel} className="text-sm font-medium text-accent hover:underline">
            {t('channelsPage.addChannel')}
          </button>
          <Link to="/settings/setup" className="text-sm font-medium text-accent hover:underline">
            {t('channelsPage.openSetup')}
          </Link>
          <Link to={inboxPath('open')} className="text-sm font-medium text-accent hover:underline">
            {t('channelsPage.openCommunication')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <ul className="divide-y divide-border/50">
      {sorted.map((row) => {
        const busy = busyId === row.id
        const fix = channelFix(row)
        const lastActivity = row.lastEventAt ?? row.lastSyncAt
        const mode =
          row.isEnabled && AI_HANDLING_CHANNELS.has(row.channel) ? row.aiHandling?.effective : undefined
        return (
          <li key={row.id} className="px-4 py-3" data-testid="channel-row" data-kind={row.kind}>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to={channelSettingsPath(row.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm"
              >
                <ChannelIcon row={row} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text-heading">{row.label}</span>
                    <span className="text-xs text-text-muted">
                      {t(`channelsPage.kind.${row.kind}`, { defaultValue: row.kind })}
                    </span>
                    {row.isPrimary ? (
                      <Badge variant="success" className="px-1.5 py-0 text-2xs">
                        {t('channelsPage.primary')}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-muted">
                    {row.address ? <span className="truncate-fade text-text-secondary">{row.address}</span> : null}
                    <span>
                      {lastActivity
                        ? t('channelsPage.lastActivity', {
                            when: formatAppDateTime(new Date(lastActivity), i18n.language),
                          })
                        : t('channelsPage.noActivityYet')}
                    </span>
                  </span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-text-muted" aria-hidden />
              </Link>

              <div className="flex shrink-0 flex-wrap items-center gap-3">
                {mode ? (
                  <span
                    className="inline-flex items-center gap-1.5 text-xs text-text-secondary"
                    title={tc('aiHandling.title')}
                    data-testid="channel-row-ai-handling"
                    data-mode={mode}
                  >
                    <AiHandlingIcon mode={mode} size={13} />
                    {tc(`aiHandling.modes.${mode}.label`)}
                  </span>
                ) : null}
                <ChannelStatus state={row.state} />
                {fix ? <FixButton fix={fix} row={row} busy={busy} actions={actions} /> : null}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
