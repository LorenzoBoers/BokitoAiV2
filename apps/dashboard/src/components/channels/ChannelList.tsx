import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDown, ChevronRight, Play, RefreshCw, Wifi } from 'lucide-react'
import { AiHandlingIcon } from '../ai/AiHandlingIcon'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import ChannelPanel from './ChannelPanel'
import { ChannelIcon, ChannelStatus } from './ChannelStatus'
import { channelFix, type ChannelActions, type ChannelFix } from './channel-actions'
import { AI_HANDLING_CHANNELS } from '../../lib/ai-handling'
import { formatAppDateTime } from '../../lib/app-locale'
import { WEBSITE_WIDGET_PATH } from '../../lib/assistant-settings-path'
import { inboxPath } from '../../lib/messages-paths'
import type { ChannelRow } from '../../lib/channels-api'

const NEEDS_ATTENTION = new Set(['setup_required', 'action_required', 'error'])

export type ChannelListProps = {
  channels: ChannelRow[]
  loading: boolean
  busyId: string | null
  actions: Omit<ChannelActions, 'rename'> & { saveLabel: (row: ChannelRow, label: string) => void }
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
        {t('channelsPage.resume')}
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
 * Every channel is the same row: icon, name, one state, how AI handles it,
 * and at most one repair button. Settings open below the row in the same
 * sections for every kind; only the kind block differs.
 */
export default function ChannelList({ channels, loading, busyId, actions, onAddChannel }: ChannelListProps) {
  const { t, i18n } = useTranslation('nav')
  const { t: tc } = useTranslation('common')
  const [openId, setOpenId] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<ChannelRow | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const autoOpened = useRef(false)

  // Open the first channel that needs a human once, so its checks are in view.
  useEffect(() => {
    if (autoOpened.current || channels.length === 0) return
    autoOpened.current = true
    const first = channels.find((row) => NEEDS_ATTENTION.has(row.state))
    if (first) setOpenId(first.id)
  }, [channels])

  const sorted = useMemo(
    () =>
      [...channels].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
        return a.label.localeCompare(b.label)
      }),
    [channels],
  )

  const panelActions: ChannelActions = useMemo(
    () => ({
      ...actions,
      rename: (row) => {
        setRenameTarget(row)
        setRenameDraft(row.displayName || row.label || '')
      },
    }),
    [actions],
  )

  const closeRename = () => {
    setRenameTarget(null)
    setRenameDraft('')
  }
  const submitRename = () => {
    if (!renameTarget) return
    actions.saveLabel(renameTarget, renameDraft.trim())
    closeRename()
  }

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
          <Link to={WEBSITE_WIDGET_PATH} className="text-sm font-medium text-accent hover:underline">
            {t('channelsPage.openWidget')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <>
      <ul className="divide-y divide-border/50">
        {sorted.map((row) => {
          const isOpen = openId === row.id
          const busy = busyId === row.id
          const fix = channelFix(row)
          const lastActivity = row.lastEventAt ?? row.lastSyncAt
          const mode =
            row.isEnabled && AI_HANDLING_CHANNELS.has(row.channel) ? row.aiHandling?.effective : undefined
          return (
            <li key={row.id} className="px-4 py-3" data-testid="channel-row" data-kind={row.kind}>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : row.id)}
                  aria-expanded={isOpen}
                  aria-label={t('channelsPage.toggleSettings', { name: row.label })}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm"
                >
                  <span className="text-text-muted">
                    {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </span>
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
                </button>

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

              {isOpen ? <ChannelPanel row={row} busy={busy} actions={panelActions} /> : null}
            </li>
          )
        })}
      </ul>

      <Dialog.Root open={renameTarget != null} onOpenChange={(open) => (open ? null : closeRename())}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[400px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-bg-surface p-5 shadow-overlay">
            <Dialog.Title className="mb-1 text-lg font-semibold text-text-heading">
              {t('channelsPage.renameTitle')}
            </Dialog.Title>
            <p className="mb-3 text-sm text-text-secondary">
              {t('channelsPage.renameBody', { address: renameTarget?.address || renameTarget?.label || '' })}
            </p>
            <label className="block text-xs text-text-muted">
              <span className="mb-1 block font-medium text-text-secondary">{t('channelsPage.renameLabel')}</span>
              <input
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                placeholder={renameTarget?.address || ''}
                autoFocus
                className="w-full rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent/60"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submitRename()
                  }
                }}
              />
            </label>
            <p className="mt-1.5 text-xs text-text-muted">{t('channelsPage.renameHint')}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={closeRename}>
                {t('channelsPage.close')}
              </Button>
              <Button size="sm" disabled={busyId === renameTarget?.id} onClick={submitRename}>
                {t('channelsPage.renameSave')}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
