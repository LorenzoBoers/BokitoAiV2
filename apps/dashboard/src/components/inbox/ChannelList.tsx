import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import * as Dialog from '@radix-ui/react-dialog'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  Folder,
  Mail,
  MessageSquare,
  MinusCircle,
  MoreHorizontal,
  PenLine,
  RefreshCw,
  Settings as SettingsIcon,
  Star,
  Trash2,
  Wifi,
  XCircle,
} from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import ProviderLogo from '../email/ProviderLogo'
import { BrandMark } from '../integrations/BrandMark'
import AgentBindingPicker from '../settings/AgentBindingPicker'
import ChannelVisibilityPicker from '../settings/ChannelVisibilityPicker'
import { ChannelCapabilityChips, ChannelStateBadge } from './ChannelStateBadge'
import { formatAppDateTime } from '../../lib/app-locale'
import type { ChannelCheck, ChannelCheckState, ChannelRow } from '../../lib/channels-api'
import type { Provider } from '../../lib/email-oauth'
import { WEBSITE_WIDGET_PATH } from '../../lib/assistant-settings-path'
import { inboxPath } from '../../lib/messages-paths'

const CHECK_ICONS: Record<ChannelCheckState, typeof Check> = {
  ok: Check,
  warn: AlertTriangle,
  fail: XCircle,
  pending: Circle,
  na: MinusCircle,
}

const CHECK_COLORS: Record<ChannelCheckState, string> = {
  ok: 'text-status-success',
  warn: 'text-status-warning',
  fail: 'text-status-error',
  pending: 'text-text-muted',
  na: 'text-text-muted',
}

function ChannelIcon({ row }: { row: ChannelRow }) {
  if (row.kind === 'email_mailbox') {
    return (
      <ProviderLogo
        provider={row.provider as Provider}
        className="h-5 w-5 shrink-0 object-contain"
      />
    )
  }
  if (row.kind === 'email_relay') {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent/10 text-accent">
        <Mail size={13} />
      </span>
    )
  }
  if (row.kind === 'whatsapp') return <BrandMark slug="whatsapp" />
  if (row.kind === 'slack') return <BrandMark slug="slack" />
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-bg-elevated text-text-secondary">
      <MessageSquare size={13} />
    </span>
  )
}

const ISO_DETAIL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/** Backfill windows offered per sync channel; 0 means no limit. */
const SYNC_WINDOW_OPTIONS = [7, 30, 90, 365, 0]

function CheckLine({ check }: { check: ChannelCheck }) {
  const { t, i18n } = useTranslation('nav')
  const Icon = CHECK_ICONS[check.state] ?? Circle
  const label = t(`channelsPage.checks.${check.id}`, {
    defaultValue: check.id.replace(/_/g, ' '),
  })
  const detail = ISO_DETAIL.test(check.detail)
    ? formatAppDateTime(new Date(check.detail), i18n.language)
    : check.detail
  return (
    <li className="flex items-start gap-2 text-xs">
      <Icon size={13} className={`mt-0.5 shrink-0 ${CHECK_COLORS[check.state]}`} aria-hidden />
      <span className="min-w-0">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-muted"> · {t(`channelsPage.checkState.${check.state}`)}</span>
        {detail ? (
          <span className="block truncate text-text-muted" title={detail}>
            {detail}
          </span>
        ) : null}
      </span>
    </li>
  )
}

export type ChannelListProps = {
  channels: ChannelRow[]
  loading: boolean
  busyId: string | null
  onToggleEnabled: (row: ChannelRow, enabled: boolean) => void
  onSync: (row: ChannelRow) => void
  onReconnect: (row: ChannelRow) => void
  onMakePrimary: (row: ChannelRow) => void
  onRename: (row: ChannelRow, label: string) => void
  onRemove: (row: ChannelRow) => void
  onSyncWindowChange: (row: ChannelRow, days: number) => void
  onFolders: (row: ChannelRow) => void
  onSignature: (row: ChannelRow) => void
  onRouting: (row: ChannelRow) => void
  onVisibilityChanged: (row: ChannelRow) => void
  onAddChannel: () => void
}

/**
 * Every channel as one kind of row: name, state, capabilities, and a
 * disclosure with the granular checks behind that state. Kind-specific depth
 * (folders, signature, routing, widget design) opens from the row.
 */
export default function ChannelList({
  channels,
  loading,
  busyId,
  onToggleEnabled,
  onSync,
  onReconnect,
  onMakePrimary,
  onRename,
  onRemove,
  onSyncWindowChange,
  onFolders,
  onSignature,
  onRouting,
  onVisibilityChanged,
  onAddChannel,
}: ChannelListProps) {
  const { t, i18n } = useTranslation('nav')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<ChannelRow | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  // Auto-open the check list when a channel still needs attention — first-time
  // users otherwise only see "Setup required" next to an enabled switch.
  useEffect(() => {
    setExpanded((prev) => {
      let changed = false
      const next = { ...prev }
      for (const row of channels) {
        if (
          (row.state === 'setup_required' ||
            row.state === 'action_required' ||
            row.state === 'error') &&
          next[row.id] === undefined
        ) {
          next[row.id] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [channels])

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const copyAddress = useCallback(
    async (row: ChannelRow) => {
      try {
        await navigator.clipboard.writeText(row.address)
        setCopiedId(row.id)
        window.setTimeout(() => setCopiedId(null), 2000)
      } catch {
        toast.error(t('channelsPage.copyAddressError'))
      }
    },
    [t],
  )

  const sorted = useMemo(
    () =>
      [...channels].sort((a, b) => {
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
          <button
            type="button"
            onClick={onAddChannel}
            className="text-sm font-medium text-accent hover:underline"
          >
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
        const isOpen = expanded[row.id] === true
        const busy = busyId === row.id
        const canSync = row.capabilities.includes('sync')
        const needsReconnect = row.actions.includes('reconnect') && row.state === 'action_required'
        const lastActivity = row.lastEventAt ?? row.lastSyncAt
        return (
          <li key={row.id} className="px-4 py-3">
            <div className="flex flex-wrap items-start gap-3">
              <button
                type="button"
                onClick={() => toggleExpanded(row.id)}
                aria-expanded={isOpen}
                aria-label={t('channelsPage.toggleChecks')}
                className="mt-0.5 text-text-muted transition-colors hover:text-text-primary"
              >
                {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
              <div className="mt-0.5">
                <ChannelIcon row={row} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-text-heading">{row.label}</span>
                  <Badge variant="neutral" className="px-1.5 py-0 text-[10px] uppercase tracking-wide">
                    {t(`channelsPage.kind.${row.kind}`, { defaultValue: row.kind })}
                  </Badge>
                  {row.isPrimary ? (
                    <Badge variant="success" className="px-1.5 py-0 text-[10px] uppercase tracking-wide">
                      {t('channelsPage.primary')}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-secondary">
                  {row.address ? <span className="truncate">{row.address}</span> : null}
                  <span className="text-text-muted">
                    {lastActivity
                      ? t('channelsPage.lastActivity', {
                          when: formatAppDateTime(new Date(lastActivity), i18n.language),
                        })
                      : t('channelsPage.noActivityYet')}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <ChannelCapabilityChips capabilities={row.capabilities} />
                <ChannelStateBadge state={row.state} />
                <Switch
                  checked={row.isEnabled}
                  disabled={busy}
                  onCheckedChange={(checked) => onToggleEnabled(row, checked)}
                  aria-label={t('channelsPage.toggleEnabledAria')}
                />
                {needsReconnect ? (
                  <button
                    type="button"
                    onClick={() => onReconnect(row)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-bg-surface px-2.5 py-1 text-xs font-medium text-text-heading transition-colors hover:bg-bg-hover/70"
                  >
                    <Wifi size={13} />
                    {t('channelsPage.reconnect')}
                  </button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={t('channelsPage.actionsFor', { email: row.label })}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 text-text-secondary hover:bg-bg-hover/70 hover:text-text-primary"
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem
                      className="gap-2 text-xs"
                      onSelect={() => {
                        setRenameTarget(row)
                        setRenameDraft(row.displayName || row.label || '')
                      }}
                    >
                      <PenLine size={13} />
                      {t('channelsPage.rename')}
                    </DropdownMenuItem>
                    {canSync ? (
                      <DropdownMenuItem className="gap-2 text-xs" disabled={busy} onSelect={() => onSync(row)}>
                        <RefreshCw size={13} />
                        {t('channelsPage.syncNow')}
                      </DropdownMenuItem>
                    ) : null}
                    {row.address ? (
                      <DropdownMenuItem className="gap-2 text-xs" onSelect={() => void copyAddress(row)}>
                        {copiedId === row.id ? <Check size={13} /> : <Copy size={13} />}
                        {t('channelsPage.copyAddress')}
                      </DropdownMenuItem>
                    ) : null}
                    {row.channel === 'email' ? (
                      <>
                        {row.kind === 'email_mailbox' ? (
                          <DropdownMenuItem className="gap-2 text-xs" onSelect={() => onFolders(row)}>
                            <Folder size={13} />
                            {t('channelsPage.folders')}
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem className="gap-2 text-xs" onSelect={() => onSignature(row)}>
                          <PenLine size={13} />
                          {t('channelsPage.signature')}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2 text-xs" onSelect={() => onRouting(row)}>
                          <SettingsIcon size={13} />
                          {t('channelsPage.routing')}
                        </DropdownMenuItem>
                        {!row.isPrimary ? (
                          <DropdownMenuItem
                            className="gap-2 text-xs"
                            disabled={busy || !row.isEnabled}
                            onSelect={() => onMakePrimary(row)}
                          >
                            <Star size={13} />
                            {t('channelsPage.makePrimary')}
                          </DropdownMenuItem>
                        ) : null}
                      </>
                    ) : null}
                    {row.configureHref ? (
                      <DropdownMenuItem asChild className="gap-2 text-xs">
                        <Link to={row.configureHref}>
                          <SettingsIcon size={13} />
                          {t('channelsPage.configure')}
                        </Link>
                      </DropdownMenuItem>
                    ) : null}
                    {row.actions.includes('remove') ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="gap-2 text-xs text-status-error focus:text-status-error"
                          disabled={busy}
                          onSelect={() => onRemove(row)}
                        >
                          <Trash2 size={13} />
                          {t('channelsPage.remove')}
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {isOpen ? (
              <div className="mt-3 grid gap-4 rounded-lg border border-border/50 bg-bg-elevated/30 p-3 sm:grid-cols-2">
                <div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    {t('channelsPage.checksTitle')}
                  </h4>
                  <ul className="mt-2 space-y-1.5">
                    {row.checks.length === 0 ? (
                      <li className="text-xs text-text-muted">{t('channelsPage.noChecks')}</li>
                    ) : (
                      row.checks.map((check) => <CheckLine key={check.id} check={check} />)
                    )}
                  </ul>
                  {row.lastError ? (
                    <p className="mt-2 text-xs text-status-error">{row.lastError}</p>
                  ) : null}
                </div>
                <div className="space-y-3">
                  {canSync ? (
                    <div>
                      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {t('channelsPage.history')}
                      </h4>
                      <select
                        value={String(row.syncWindowDays)}
                        disabled={busy}
                        onChange={(e) => onSyncWindowChange(row, Number(e.target.value))}
                        aria-label={t('channelsPage.historyAria')}
                        className="mt-2 rounded-md border border-border/60 bg-bg-elevated/60 px-2 py-1 text-xs text-text-primary outline-none focus:border-accent/60"
                      >
                        {SYNC_WINDOW_OPTIONS.map((days) => (
                          <option key={days} value={days}>
                            {days === 0
                              ? t('channelsPage.everything')
                              : days === 365
                                ? t('channelsPage.oneYear')
                                : t('channelsPage.days', { count: days })}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      {t('channelsPage.colAgent')}
                    </h4>
                    <div className="mt-2">
                      <AgentBindingPicker
                        channel={row.channel}
                        channelAccountId={row.id}
                        aria-label={t('bindingPicker.ariaLabel')}
                      />
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      {t('channelsPage.colVisibility')}
                    </h4>
                    <div className="mt-2">
                      <ChannelVisibilityPicker
                        accountId={row.id}
                        visibility={row.visibility}
                        onChanged={() => onVisibilityChanged(row)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>

      <Dialog.Root
        open={renameTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null)
            setRenameDraft('')
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[400px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-bg-surface p-5 shadow-xl">
            <Dialog.Title className="mb-1 text-lg font-semibold text-text-heading">
              {t('channelsPage.renameTitle')}
            </Dialog.Title>
            <p className="mb-3 text-sm text-text-secondary">
              {t('channelsPage.renameBody', {
                address: renameTarget?.address || renameTarget?.label || '',
              })}
            </p>
            <label className="block text-xs text-text-muted">
              <span className="mb-1 block font-medium text-text-secondary">
                {t('channelsPage.renameLabel')}
              </span>
              <input
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                placeholder={renameTarget?.address || ''}
                autoFocus
                className="w-full rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-accent/60"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && renameTarget) {
                    e.preventDefault()
                    onRename(renameTarget, renameDraft.trim())
                    setRenameTarget(null)
                    setRenameDraft('')
                  }
                }}
              />
            </label>
            <p className="mt-1.5 text-[11px] text-text-muted">{t('channelsPage.renameHint')}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setRenameTarget(null)
                  setRenameDraft('')
                }}
              >
                {t('channelsPage.close')}
              </Button>
              <Button
                size="sm"
                disabled={busyId === renameTarget?.id}
                onClick={() => {
                  if (!renameTarget) return
                  onRename(renameTarget, renameDraft.trim())
                  setRenameTarget(null)
                  setRenameDraft('')
                }}
              >
                {t('channelsPage.renameSave')}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
