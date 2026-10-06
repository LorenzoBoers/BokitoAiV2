import { useTranslation } from 'react-i18next'
import { Pause, Play, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import AgentBindingPicker from '../settings/AgentBindingPicker'
import { useAuth } from '../../context/AuthContext'
import { AccessPicker } from '../access/AccessPicker'
import ChannelTeamPicker from './ChannelTeamPicker'
import ChannelAiHandlingSetting from './ChannelAiHandlingSetting'
import { ChannelSection, ChannelSetting } from './ChannelSetting'
import { CheckLine } from './ChannelStatus'
import { CHANNEL_KIND_SETTINGS } from './channel-kind-settings'
import { AI_HANDLING_CHANNELS } from '../../lib/ai-handling'
import type { ChannelRow } from '../../lib/channels-api'
import { updateChannelAccess } from '../../lib/channel-accounts-api'

const CHANNEL_LEVELS = ['view', 'handle'] as const
import type { ChannelActions } from './channel-actions'

/**
 * The same four sections for every channel: what works (Status), how
 * conversations are handled (General), what only this kind has, and pause or
 * remove (Manage).
 */
export default function ChannelPanel({
  row,
  busy,
  actions,
  hideKindSettings = false,
}: {
  row: ChannelRow
  busy: boolean
  actions: ChannelActions
  hideKindSettings?: boolean
}) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const KindSettings = CHANNEL_KIND_SETTINGS[row.kind]
  const canPause = row.actions.includes('pause') || row.actions.includes('resume')
  const canRemove = row.actions.includes('remove')

  return (
    <div className="space-y-5" data-testid="channel-panel">
      <ChannelSection title={t('channelsPage.section.status')}>
        <div className="py-2.5">
          {row.checks.length === 0 ? (
            <p className="text-xs text-text-muted">{t('channelsPage.noChecks')}</p>
          ) : (
            <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {row.checks.map((check) => (
                <CheckLine key={check.id} check={check} />
              ))}
            </ul>
          )}
          {row.lastError ? <p className="mt-2 text-xs text-status-error">{row.lastError}</p> : null}
        </div>
      </ChannelSection>

      <ChannelSection title={t('channelsPage.section.general')}>
        <ChannelSetting label={t('channelsPage.name')} hint={t('channelsPage.renameHint')}>
          <span className="max-w-[14rem] truncate-fade text-sm text-text-secondary">{row.label}</span>
          <Button variant="secondary" size="sm" onClick={() => actions.rename(row)}>
            {t('channelsPage.edit')}
          </Button>
        </ChannelSetting>
        {row.aiHandling && AI_HANDLING_CHANNELS.has(row.channel) ? (
          <ChannelAiHandlingSetting row={row} onChanged={(next) => actions.aiHandlingChanged(row, next)} />
        ) : null}
        <ChannelSetting label={t('channelsPage.team')} hint={t('channelsPage.teamHint')}>
          <ChannelTeamPicker
            accountId={row.id}
            teamId={row.defaultTeamId}
            onChanged={() => actions.accessChanged(row)}
          />
        </ChannelSetting>
        <ChannelSetting label={t('channelsPage.agent')} hint={t('channelsPage.agentHint')}>
          <AgentBindingPicker
            channel={row.channel}
            channelAccountId={row.id}
            aria-label={t('bindingPicker.ariaLabel')}
          />
        </ChannelSetting>
        <ChannelSetting label={t('channelsPage.access')} hint={t('channelsPage.accessHint')}>
          <AccessPicker
            access={row.access}
            levels={CHANNEL_LEVELS}
            copy={{
              title: t('channelAccess.title'),
              description: t('channelAccess.description'),
              hint: t('channelAccess.hint'),
              adminsNote: t('channelAccess.adminsNote'),
            }}
            save={(entries) => updateChannelAccess(token ?? '', row.id, entries)}
            onChanged={() => actions.accessChanged(row)}
          />
        </ChannelSetting>
      </ChannelSection>

      {KindSettings && !hideKindSettings ? (
        <ChannelSection title={t(`channelsPage.kind.${row.kind}`, { defaultValue: row.kind })}>
          <KindSettings row={row} busy={busy} actions={actions} />
        </ChannelSection>
      ) : null}

      {canPause || canRemove ? (
        <ChannelSection title={t('channelsPage.section.manage')}>
          {canPause ? (
            <ChannelSetting
              label={row.isEnabled ? t('channelsPage.pauseTitle') : t('channelsPage.resumeTitle')}
              hint={row.isEnabled ? t('channelsPage.pauseHint') : t('channelsPage.resumeHint')}
            >
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => actions.setPaused(row, row.isEnabled)}
                data-testid="channel-pause-toggle"
              >
                {row.isEnabled ? <Pause size={13} /> : <Play size={13} />}
                {row.isEnabled ? t('channelsPage.pause') : t('channelsPage.resume')}
              </Button>
            </ChannelSetting>
          ) : null}
          {canRemove ? (
            <ChannelSetting label={t('channelsPage.removeTitleShort')} hint={t('channelsPage.removeHint')}>
              <Button variant="destructive" size="sm" disabled={busy} onClick={() => actions.remove(row)}>
                <Trash2 size={13} />
                {t('channelsPage.remove')}
              </Button>
            </ChannelSetting>
          ) : null}
        </ChannelSection>
      ) : null}
    </div>
  )
}
