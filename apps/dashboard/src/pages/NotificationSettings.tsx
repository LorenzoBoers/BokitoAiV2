import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Bell, BellRing, Monitor } from 'lucide-react'
import { listChannelAccounts } from '../lib/channel-accounts-api'
import { isChannelParked } from '../lib/channel-surface'
import { Switch } from '../components/ui/switch'
import { Card } from '../components/ui/card'
import { PageContent } from '../components/layout/PageContent'
import { useAuth } from '../context/AuthContext'
import { policyRoutes } from '../api/routes/policy.routes'
import { APP_API_BASE } from '../lib/api.config'
import {
  canonicalizeNotificationRows,
  DEFAULT_NOTIFICATION_ROWS,
  desktopEnabledCount,
  pauseAllDesktop,
  restoreDefaultNotificationRows,
  type NotificationChannelKey,
  type NotificationPrefRow,
} from '../lib/notification-rows'
import {
  disableWebPush,
  enableWebPush,
  getCurrentPushSubscription,
  isWebPushServerConfigured,
  isWebPushSupported,
} from '../lib/web-push'

type ChannelKey = NotificationChannelKey
type NotificationRow = NotificationPrefRow

const STORAGE_KEY = 'bokito_notification_settings_v1'

export default function NotificationSettings() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [rows, setRows] = useState<NotificationRow[]>(DEFAULT_NOTIFICATION_ROWS)
  const [loading, setLoading] = useState(true)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  // Slack toggles only make sense with a connected workspace, and disappear
  // entirely while the channel is parked platform-wide.
  const slackAvailable = !isChannelParked('slack')
  const gridCols = slackAvailable
    ? 'grid-cols-[1fr_84px_84px_84px]'
    : 'grid-cols-[1fr_84px_84px]'
  const [slackConnected, setSlackConnected] = useState(false)

  useEffect(() => {
    if (!token || !slackAvailable) return
    listChannelAccounts(token)
      .then((accounts) => setSlackConnected(accounts.some((a) => a.channel === 'slack' && a.isEnabled)))
      .catch(() => setSlackConnected(false))
  }, [token, slackAvailable])

  // Fade the "Saved" confirmation shortly after the last successful save.
  useEffect(() => {
    if (savedAt == null) return
    const timer = window.setTimeout(() => setSavedAt(null), 2000)
    return () => window.clearTimeout(timer)
  }, [savedAt])

  useEffect(() => {
    if (!token) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return
        const parsed = JSON.parse(raw) as NotificationRow[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          const next = canonicalizeNotificationRows(parsed)
          setRows(next.length > 0 ? next : DEFAULT_NOTIFICATION_ROWS)
        }
      } catch {
        // ignore
      }
      setLoading(false)
      return
    }
    setLoading(true)
    fetch(`${APP_API_BASE}${policyRoutes.notificationPreferences()}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(t('notificationsPage.loadFailed')))))
      .then((data: { rows?: NotificationRow[] }) => {
        if (Array.isArray(data.rows) && data.rows.length > 0) {
          const next = canonicalizeNotificationRows(data.rows)
          setRows(next.length > 0 ? next : DEFAULT_NOTIFICATION_ROWS)
        }
      })
      .catch(() => setRows(DEFAULT_NOTIFICATION_ROWS))
      .finally(() => setLoading(false))
  }, [token, t])

  const desktopEnabled = useMemo(() => desktopEnabledCount(rows), [rows])

  // Browser push (web push via the service worker). Reflects the actual
  // browser subscription state rather than a stored preference.
  const pushSupported = isWebPushSupported()
  const [pushServerConfigured, setPushServerConfigured] = useState<boolean | null>(null)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)

  useEffect(() => {
    if (!pushSupported) {
      setPushServerConfigured(false)
      return
    }
    void isWebPushServerConfigured().then(setPushServerConfigured)
    void getCurrentPushSubscription().then((sub) => setPushEnabled(sub != null))
  }, [pushSupported])

  const togglePush = useCallback(
    async (checked: boolean) => {
      if (!token || pushBusy) return
      setPushBusy(true)
      setPushError(null)
      try {
        if (checked) {
          await enableWebPush(token)
          setPushEnabled(true)
        } else {
          await disableWebPush(token)
          setPushEnabled(false)
        }
      } catch (err) {
        setPushError(err instanceof Error ? err.message : t('notificationsPage.pushFailed'))
        setPushEnabled((await getCurrentPushSubscription()) != null)
      } finally {
        setPushBusy(false)
      }
    },
    [token, pushBusy, t],
  )

  const persistRows = useCallback(
    async (next: NotificationRow[]) => {
      if (token) {
        setSaveError(null)
        const res = await fetch(`${APP_API_BASE}${policyRoutes.notificationPreferences()}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ rows: next }),
        })
        if (!res.ok) {
          setSaveError(t('notificationsPage.saveFailed'))
        } else {
          setSavedAt(Date.now())
        }
        return
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        setSavedAt(Date.now())
      } catch {
        // ignore
      }
    },
    [token, t],
  )

  function applyRows(next: NotificationRow[]) {
    setRows(next)
    void persistRows(next)
  }

  function updateChannel(rowId: string, channel: ChannelKey, checked: boolean) {
    setRows((prev) => {
      const next = prev.map((row) =>
        row.id === rowId
          ? { ...row, channels: { ...row.channels, [channel]: checked } }
          : row,
      )
      void persistRows(next)
      return next
    })
  }

  function channelCell(row: NotificationRow, channel: ChannelKey, label: string) {
    if (row.channels[channel] === undefined) {
      return (
        <div className="flex justify-center">
          <span className="text-xs text-text-muted/50">-</span>
        </div>
      )
    }
    const gatedOnSlack = channel === 'slack' && !slackConnected
    return (
      <div className="flex justify-center">
        <Switch
          checked={gatedOnSlack ? false : Boolean(row.channels[channel])}
          disabled={gatedOnSlack}
          onCheckedChange={(checked) => updateChannel(row.id, channel, checked)}
          aria-label={`${t(`notificationsPage.rows.${row.id}`)} ${label}`}
          title={gatedOnSlack ? t('notificationsPage.slackFirst') : undefined}
        />
      </div>
    )
  }

  return (
    <PageContent width="lg" className="space-y-5 py-1">
      <p className="text-sm text-text-secondary">
        {t('notificationsPage.intro')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => applyRows(pauseAllDesktop(rows))}
          className="rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary hover:bg-bg-hover/60"
        >
          {t('notificationsPage.pauseInApp')}
        </button>
        <button
          type="button"
          onClick={() => applyRows(restoreDefaultNotificationRows())}
          className="rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary hover:bg-bg-hover/60"
        >
          {t('notificationsPage.restoreDefaults')}
        </button>
        <button
          type="button"
          onClick={() => toast.message(t('notificationsPage.previewTitle'), { description: t('notificationsPage.previewBody') })}
          className="rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary hover:bg-bg-hover/60"
        >
          {t('notificationsPage.preview')}
        </button>
      </div>

      <Card className="overflow-hidden">
        <div
          className={`grid ${gridCols} border-b border-border/60 px-5 py-3 text-xs font-semibold uppercase tracking-[0.07em] text-text-muted`}
        >
          <span>{t('notificationsPage.notifyMe')}</span>
          <span className="text-center">{t('notificationsPage.inApp')}</span>
          <span className="text-center">{t('notificationsPage.email')}</span>
          {slackAvailable ? (
            <span className="text-center">
              {slackConnected ? (
                t('notificationsPage.slack')
              ) : (
                <Link to="/settings/channels" className="normal-case tracking-normal text-accent hover:underline">
                  {t('notificationsPage.slackColumnHint')}
                </Link>
              )}
            </span>
          ) : null}
        </div>

        {rows.map((row) => (
          <div
            key={row.id}
            className={`grid ${gridCols} items-center border-b border-border/60 px-5 py-3 last:border-b-0`}
          >
            <p className="pr-3 text-sm text-text-primary">
              {t(`notificationsPage.rows.${row.id}`)}
            </p>
            {channelCell(row, 'desktop', t('notificationsPage.inApp'))}
            {channelCell(row, 'email', t('notificationsPage.email'))}
            {slackAvailable ? channelCell(row, 'slack', t('notificationsPage.slack')) : null}
          </div>
        ))}
      </Card>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="inline-flex items-center gap-2 text-sm font-medium text-text-heading">
              <BellRing size={14} className="text-text-muted" />
              {t('notificationsPage.pushTitle')}
            </p>
            <p className="text-xs text-text-secondary">
              {!pushSupported
                ? t('notificationsPage.pushUnsupported')
                : pushServerConfigured === false
                  ? t('notificationsPage.pushNotConfigured')
                  : t('notificationsPage.pushBody')}
            </p>
            {pushError ? <p className="text-xs text-status-error">{pushError}</p> : null}
          </div>
          <Switch
            checked={pushEnabled}
            disabled={
              !pushSupported ||
              pushBusy ||
              !token ||
              pushServerConfigured === false ||
              pushServerConfigured === null
            }
            onCheckedChange={(checked) => void togglePush(checked)}
            aria-label={t('notificationsPage.pushAria')}
          />
        </div>
      </Card>

      <Card className="p-4">
        <div className="space-y-1">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-text-heading">
            <Monitor size={14} className="text-text-muted" />
            {t('notificationsPage.channelsTitle')}
          </p>
          <p className="text-xs text-text-secondary">
            {t('notificationsPage.channelsBody')}
            {slackAvailable && !slackConnected ? (
              <>
                {' '}
                <Link to="/settings/channels" className="text-accent hover:underline">
                  {t('notificationsPage.connectSlack')}
                </Link>{' '}
                {t('notificationsPage.enableSlack')}
              </>
            ) : null}
          </p>
          <p className="text-xs text-text-secondary">
            {t('notificationsPage.budgetHint')}{' '}
            <Link to="/cockpit/usage" className="text-accent hover:underline">
              {t('notificationsPage.openUsage')}
            </Link>
            {'.'}
          </p>
          <p className="text-xs font-medium text-text-muted">
            {t('notificationsPage.inAppEnabled', { count: desktopEnabled })}
          </p>
        </div>
      </Card>

      {loading ? <p className="text-sm text-text-muted">{t('notificationsPage.loading')}</p> : null}
      {saveError ? <p className="text-sm text-status-error">{saveError}</p> : null}
      <div className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-bg-elevated/55 px-3 py-2 text-xs text-text-secondary">
        <Bell size={13} className="text-text-muted" />
        {savedAt ? t('notificationsPage.saved') : t('notificationsPage.savedHint')}
      </div>
    </PageContent>
  )
}
