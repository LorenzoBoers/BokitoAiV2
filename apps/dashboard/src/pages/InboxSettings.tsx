import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { MessageSquare, Plus } from 'lucide-react'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { Button } from '../components/ui/button'
import { LoadingBlock } from '../components/ui/loading-block'
import { PageContent } from '../components/layout/PageContent'
import { PageIntro } from '../components/layout/PageIntro'
import { PageRelatedLinks } from '../components/layout/PageRelatedLinks'
import { SettingsSection } from '../components/layout/SettingsSection'
import { OauthRedirectAlert } from '../components/email/OauthRedirectAlert'
import CommunicationTagsCard from '../components/inbox/CommunicationTagsCard'
import SavedRepliesManager from '../components/inbox/SavedRepliesManager'
import AutomationRulesManager from '../components/inbox/AutomationRulesManager'
import ChannelList, { type ChannelListProps } from '../components/channels/ChannelList'
import AddChannelDialog from '../components/inbox/AddChannelDialog'
import { BrandMark } from '../components/integrations/BrandMark'
import { useAuth } from '../context/AuthContext'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import {
  describeOAuthCallbackSummary,
  logOAuthRedirectDebugInDev,
  parseOAuthCallback,
  providerFriendlyName,
} from '../lib/email-oauth'
import { cn } from '../lib/utils'
import { listChannels, patchChannel, syncChannel, type ChannelRow } from '../lib/channels-api'
import { isChannelParked } from '../lib/channel-surface'
import { WEBSITE_WIDGET_PATH } from '../lib/assistant-settings-path'
import { inboxPath } from '../lib/messages-paths'

type InboxSettingsAlert =
  | { kind: 'oauth_success'; message: string }
  | {
      kind: 'oauth_error'
      title: string
      summary: string
      code: string
      detail: string | null
    }
  | { kind: 'simple_error'; message: string }

/** Overlapping marks for every connectable channel kind next to the section title. */
function ChannelKindsMark() {
  const chips: ReactNode[] = [
    <BrandMark key="outlook" slug="outlook" size={13} />,
    <BrandMark key="gmail" slug="gmail" size={13} />,
    <BrandMark key="whatsapp" slug="whatsapp" size={13} />,
    ...(isChannelParked('slack') ? [] : [<BrandMark key="slack" slug="slack" size={13} />]),
    <MessageSquare key="widget" size={12} className="text-text-secondary" />,
  ]
  return (
    <span className="relative isolate inline-flex items-center" aria-hidden>
      {chips.map((chip, index) => (
        <span
          key={index}
          className={cn(
            'relative flex h-6 w-6 items-center justify-center rounded-full border-2 border-bg-surface bg-bg-elevated',
            index > 0 && '-ml-1.5',
          )}
          style={{ zIndex: chips.length - index }}
        >
          {chip}
        </span>
      ))}
    </span>
  )
}

export default function InboxSettings() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { refresh: refreshConnections } = useMailboxConnections()
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [pageAlert, setPageAlert] = useState<InboxSettingsAlert | null>(null)

  const refreshChannels = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      setChannels(await listChannels(token))
      setError(null)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('channelsPage.loadError')))
    } finally {
      setLoading(false)
    }
  }, [token, t])

  useEffect(() => {
    void refreshChannels()
  }, [refreshChannels])

  const applyRow = useCallback((next: ChannelRow | null) => {
    if (!next) return
    setChannels((prev) => prev.map((row) => (row.id === next.id ? next : row)))
  }, [])

  const handleSetPaused = useCallback(
    async (row: ChannelRow, paused: boolean) => {
      if (!token) return
      setBusyId(row.id)
      try {
        applyRow(
          await patchChannel(token, row.id, {
            is_enabled: !paused,
            // A paused channel should not stay the primary sender.
            ...(paused ? { is_primary: false } : {}),
          }),
        )
        await refreshConnections()
      } catch (err) {
        setPageAlert({
          kind: 'simple_error',
          message: formatApiErrorMessage(err, t('channelsPage.mailboxSaveError')),
        })
      } finally {
        setBusyId(null)
      }
    },
    [token, applyRow, refreshConnections, t],
  )

  const handleSync = useCallback(
    async (row: ChannelRow) => {
      if (!token) return
      setBusyId(row.id)
      try {
        const result = await syncChannel(token, row.id)
        applyRow(result.channel)
        toast.success(
          result.synced > 0
            ? t('channelsPage.syncedCount', { count: result.synced })
            : t('channelsPage.syncedNone'),
        )
      } catch (err) {
        toast.error(formatApiErrorMessage(err, t('channelsPage.couldNotSync')))
      } finally {
        setBusyId(null)
      }
    },
    [token, applyRow, t],
  )

  const channelActions = useMemo<ChannelListProps['actions']>(
    () => ({
      setPaused: (row, paused) => void handleSetPaused(row, paused),
      sync: (row) => void handleSync(row),
      reconnect: () => setAddOpen(true),
    }),
    [handleSetPaused, handleSync],
  )

  useEffect(() => {
    if (!location.hash) return
    const id = location.hash.slice(1)
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [location.hash, loading])

  useEffect(() => {
    const callback = parseOAuthCallback(searchParams)
    if (!callback.handled) return

    logOAuthRedirectDebugInDev(searchParams, callback)

    if (callback.status === 'connected' && callback.provider) {
      setPageAlert({
        kind: 'oauth_success',
        message: t('channelsPage.oauthConnected', {
          provider: providerFriendlyName(callback.provider),
        }),
      })
      void refreshChannels()
    } else if (callback.error) {
      setPageAlert({
        kind: 'oauth_error',
        title: t('channelsPage.oauthFailedTitle', {
          provider: providerFriendlyName(callback.provider ?? 'outlook'),
        }),
        summary: describeOAuthCallbackSummary(callback),
        code: callback.error,
        detail: callback.detail,
      })
    }
    const next = new URLSearchParams(searchParams)
    next.delete('oauth_provider')
    next.delete('oauth_status')
    next.delete('oauth_error')
    next.delete('outlook')
    next.delete('outlook_error')
    next.delete('aad_detail')
    next.delete('oauth_detail')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, refreshChannels, t])

  return (
    <PageContent width="full" className="flex min-h-0 flex-col gap-5">
      <PageIntro description={t('pageHeaders.emailMessages')} guide="channels" />

      {channels.some((row) => row.state === 'setup_required' || row.state === 'action_required' || row.state === 'error') ? (
        <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm">
          <p className="font-medium text-text-heading">
            {t('channelsPage.setupNeededAlert.title', {
              count: channels.filter(
                (row) =>
                  row.state === 'setup_required' ||
                  row.state === 'action_required' ||
                  row.state === 'error',
              ).length,
            })}
          </p>
          <p className="mt-1 text-text-secondary">{t('channelsPage.setupNeededAlert.body')}</p>
        </div>
      ) : null}

      {pageAlert?.kind === 'oauth_success' ? (
        <OauthRedirectAlert variant="success" onDismiss={() => setPageAlert(null)}>
          {pageAlert.message}
        </OauthRedirectAlert>
      ) : null}
      {pageAlert?.kind === 'oauth_error' ? (
        <OauthRedirectAlert
          variant="error"
          title={pageAlert.title}
          errorCode={pageAlert.code}
          technicalDetail={pageAlert.detail}
          onDismiss={() => setPageAlert(null)}
        >
          {pageAlert.summary}
        </OauthRedirectAlert>
      ) : null}
      {pageAlert?.kind === 'simple_error' ? (
        <div className="rounded-lg border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error">
          <div className="flex flex-wrap items-start justify-between gap-2 gap-x-4">
            <span className="min-w-0 flex-1 leading-snug">{pageAlert.message}</span>
            <button
              type="button"
              className="shrink-0 underline opacity-90 hover:opacity-100"
              onClick={() => setPageAlert(null)}
            >
              {t('channelsPage.close')}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? <LoadingBlock variant="inline" label={t('channelsPage.loadingChannels')} /> : null}
      {error ? <p className="text-sm text-status-error">{error}</p> : null}

      <div id="channels" className="scroll-mt-6">
        <SettingsSection
          title={t('channelsPage.listTitle')}
          icon={<ChannelKindsMark />}
          description={t('channelsPage.listDescription')}
          actions={
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus size={14} />
              {t('channelsPage.addChannel')}
            </Button>
          }
          className="overflow-hidden"
          bodyClassName="p-0"
        >
          <ChannelList
            channels={channels}
            loading={loading}
            busyId={busyId}
            actions={channelActions}
            onAddChannel={() => setAddOpen(true)}
          />
        </SettingsSection>
      </div>

      <div id="inbox-automations">
        <AutomationRulesManager />
      </div>

      <CommunicationTagsCard />

      <SavedRepliesManager />

      <AddChannelDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onChannelAdded={() => {
          void refreshChannels()
          void refreshConnections()
        }}
      />

      <PageRelatedLinks
        className="mt-2"
        links={[
          { to: inboxPath('open'), label: t('channelsPage.crossLinks.communication') },
          { to: '/settings/communication', label: t('channelsPage.crossLinks.inboxAi') },
          { to: WEBSITE_WIDGET_PATH, label: t('channelsPage.crossLinks.widget') },
          { to: '/connections/marketplace?kind=inbox', label: t('channelsPage.crossLinks.integrations') },
        ]}
      />
    </PageContent>
  )
}
