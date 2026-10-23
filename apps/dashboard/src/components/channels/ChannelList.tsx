import { Spinner } from '../ui/spinner'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Play, RefreshCw, Wifi } from 'lucide-react'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { channelFolderPath } from '../../lib/open-entity'
import { AiHandlingIcon } from '../ai/AiHandlingIcon'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { ChannelRowsSkeleton } from '../ui/skeleton'
import { ChannelIcon, ChannelStatus } from './ChannelStatus'
import { channelFix, type ChannelActions, type ChannelFix } from './channel-actions'
import { AI_HANDLING_CHANNELS } from '../../lib/ai-handling'
import { formatAppDateTime } from '../../lib/app-locale'
import { channelSettingsPath, type ChannelRow } from '../../lib/channels-api'
import { inboxPath } from '../../lib/messages-paths'
import { TextLink } from '../ui/text-link'
import { EmptyState } from '../ui/empty-state'

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
        <Play size={14} />
        {t('channelsPage.turnOn')}
      </Button>
    )
  }
  if (fix === 'reconnect') {
    return (
      <Button variant="secondary" size="sm" onClick={() => actions.reconnect(row)}>
        <Wifi size={14} />
        {t('channelsPage.reconnect')}
      </Button>
    )
  }
  return (
    <Button variant="secondary" size="sm" disabled={busy} onClick={() => actions.sync(row)}>
      {busy ? <Spinner size="md" /> : <RefreshCw size={14} />}
      {busy ? t('channelsPage.syncing') : t('channelsPage.retrySync')}
    </Button>
  )
}

/**
 * Every channel is the same row: icon, name, state, AI handling, optional repair.
 * The row opens the channel's settings page.
 */
const ATTENTION_STATES = new Set(['setup_required', 'action_required', 'error'])
const ConversationIcon = ENTITY_ICONS.conversation

export default function ChannelList({ channels, loading, busyId, actions, onAddChannel }: ChannelListProps) {
  const { t, i18n } = useTranslation('nav')
  const { t: tc } = useTranslation('common')
  const [query, setQuery] = useState('')
  const [attentionOnly, setAttentionOnly] = useState(false)

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

  const needle = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    return sorted.filter((row) => {
      if (attentionOnly && !ATTENTION_STATES.has(row.state)) return false
      if (!needle) return true
      const kind = t(`channelsPage.kind.${row.kind}`, { defaultValue: row.kind })
      return [row.label, row.address ?? '', kind, row.kind].some((part) => part.toLowerCase().includes(needle))
    })
  }, [sorted, attentionOnly, needle, t])

  const showFilter = sorted.length > 3

  if (loading && sorted.length === 0) {
    return <ChannelRowsSkeleton />
  }

  if (!loading && sorted.length === 0) {
    return (
      <EmptyState
        tone="plain"
        size="sm"
        title={t('channelsPage.noChannels')}
        action={
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
          <TextLink type="button" onClick={onAddChannel} className="text-sm">
            {t('channelsPage.addChannel')}
          </TextLink>
          <Link to="/settings/setup" className="text-sm font-medium text-accent hover:underline">
            {t('channelsPage.openSetup')}
          </Link>
          <Link to={inboxPath('open')} className="text-sm font-medium text-accent hover:underline">
            {t('channelsPage.openCommunication')}
          </Link>
        </div>
        }
      />
    )
  }

  return (
    <div>
      {showFilter ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('')
            }}
            placeholder={t('channelsPage.search')}
            aria-label={t('channelsPage.search')}
            type="search"
            className="h-8 max-w-xs"
          />
          <Button
            type="button"
            size="sm"
            variant={attentionOnly ? 'secondary' : 'ghost'}
            aria-pressed={attentionOnly}
            onClick={() => setAttentionOnly((current) => !current)}
          >
            {t('channelsPage.attentionOnly')}
          </Button>
        </div>
      ) : null}
      {filtered.length === 0 ? (
        <EmptyState tone="plain" size="sm" title={t('channelsPage.searchEmpty')} />
      ) : (
    <ul className="divide-y divide-border/50">
      {filtered.map((row) => {
        const busy = busyId === row.id
        const fix = channelFix(row)
        const lastActivity = row.lastEventAt ?? row.lastSyncAt
        const mode =
          row.isEnabled && AI_HANDLING_CHANNELS.has(row.channel) ? row.aiHandling?.effective : undefined
        const folderHref = row.state === 'archived' ? null : channelFolderPath(row)
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
                        : t('channelsPage.noActivityYet' /* design-system-ignore: waarde, label of keuze, geen lege lijst */)}
                    </span>
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-text-muted" aria-hidden />
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
                {folderHref ? (
                  <Link
                    to={folderHref}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition hover:bg-bg-elevated hover:text-accent"
                    title={t('channelsPage.openFolder', { name: row.label })}
                    aria-label={t('channelsPage.openFolder', { name: row.label })}
                    data-testid="channel-row-folder"
                  >
                    <ConversationIcon size={14} aria-hidden />
                  </Link>
                ) : null}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
      )}
    </div>
  )
}
