import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Bell, BellRing, Monitor } from 'lucide-react'
import { listChannelAccounts } from '../lib/channel-accounts-api'
import { Switch } from '../components/ui/switch'
import { Card } from '../components/ui/card'
import { PageContent } from '../components/layout/PageContent'
import { useAuth } from '../context/AuthContext'
import { policyRoutes } from '../api/routes/policy.routes'
import {
  disableWebPush,
  enableWebPush,
  getCurrentPushSubscription,
  isWebPushSupported,
} from '../lib/web-push'

type ChannelKey = 'desktop' | 'email' | 'slack'

type NotificationRow = {
  id: string
  label: string
  // A missing key means the channel does not apply to this category
  // (e.g. digests are email-only, Slack only exists on decisions).
  channels: { desktop?: boolean; email?: boolean; slack?: boolean }
}

// Only categories the backend actually enforces at the emission point.
// Mirrors DEFAULT_NOTIFICATION_ROWS in apps/api/app/routers/inbox_settings.py.
const DEFAULT_ROWS: NotificationRow[] = [
  {
    id: 'assigned-to-me',
    label: 'When a conversation is assigned to you',
    channels: { desktop: true, email: false },
  },
  {
    id: 'mentions',
    label: 'When you are mentioned in conversations',
    channels: { desktop: true, email: false },
  },
  {
    id: 'decisions',
    label: 'When an agent needs your decision on an assigned conversation',
    channels: { desktop: true, email: false, slack: false },
  },
  {
    id: 'ops-run-failed',
    label: 'When an agent run or trigger fails',
    channels: { desktop: true, email: false },
  },
  {
    id: 'ops-channel-disconnect',
    label: 'When a connected channel stops syncing',
    channels: { desktop: true, email: false },
  },
  {
    id: 'billing-alerts',
    label: 'When LLM spend reaches 80% or 100% of the budget',
    channels: { desktop: true, email: false },
  },
  {
    id: 'digest-daily',
    label: 'Daily email digest (open threads, pending decisions, agent activity)',
    channels: { email: false },
  },
  {
    id: 'digest-weekly',
    label: 'Weekly email digest',
    channels: { email: false },
  },
]

const KNOWN_ROW_IDS = new Set(DEFAULT_ROWS.map((row) => row.id))
const DEFAULT_BY_ID = new Map(DEFAULT_ROWS.map((row) => [row.id, row]))

/** Keep persisted labels in English; the UI translates by row id. */
function canonicalizeRows(incoming: NotificationRow[]): NotificationRow[] {
  return incoming
    .filter((row) => KNOWN_ROW_IDS.has(row.id))
    .map((row) => {
      const fallback = DEFAULT_BY_ID.get(row.id)!
      return { ...fallback, channels: { ...fallback.channels, ...row.channels } }
    })
}

const STORAGE_KEY = 'bokito_notification_settings_v1'

export default function NotificationSettings() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [rows, setRows] = useState<NotificationRow[]>(DEFAULT_ROWS)
  const [loading, setLoading] = useState(true)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  // Slack toggles only make sense with a connected workspace.
  const [slackConnected, setSlackConnected] = useState(false)

  useEffect(() => {
    if (!token) return
    listChannelAccounts(token)
      .then((accounts) => setSlackConnected(accounts.some((a) => a.channel === 'slack' && a.isEnabled)))
      .catch(() => setSlackConnected(false))
  }, [token])

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
          const next = canonicalizeRows(parsed)
          setRows(next.length > 0 ? next : DEFAULT_ROWS)
        }
      } catch {
        // ignore
      }
      setLoading(false)
      return
    }
    setLoading(true)
    fetch(`/api${policyRoutes.notificationPreferences()}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(t('notificationsPage.loadFailed')))))
      .then((data: { rows?: NotificationRow[] }) => {
        if (Array.isArray(data.rows) && data.rows.length > 0) {
          const next = canonicalizeRows(data.rows)
          setRows(next.length > 0 ? next : DEFAULT_ROWS)
        }
      })
      .catch(() => setRows(DEFAULT_ROWS))
      .finally(() => setLoading(false))
  }, [token, t])

  const desktopEnabled = useMemo(
    () => rows.reduce((acc, row) => acc + (row.channels.desktop ? 1 : 0), 0),
    [rows],
  )

  // Browser push (web push via the service worker). Reflects the actual
  // browser subscription state rather than a stored preference.
  const pushSupported = isWebPushSupported()
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)

  useEffect(() => {
    if (!pushSupported) return
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
        const res = await fetch(`/api${policyRoutes.notificationPreferences()}`, {
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

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[1fr_84px_84px_84px] border-b border-border/60 px-5 py-3 text-xs font-semibold uppercase tracking-[0.07em] text-text-muted">
          <span>{t('notificationsPage.notifyMe')}</span>
          <span className="text-center">{t('notificationsPage.inApp')}</span>
          <span className="text-center">{t('notificationsPage.email')}</span>
          <span className="text-center">{t('notificationsPage.slack')}</span>
        </div>

        {rows.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[1fr_84px_84px_84px] items-center border-b border-border/60 px-5 py-3 last:border-b-0"
          >
            <p className="pr-3 text-sm text-text-primary">
              {t(`notificationsPage.rows.${row.id}`)}
            </p>
            {channelCell(row, 'desktop', t('notificationsPage.inApp'))}
            {channelCell(row, 'email', t('notificationsPage.email'))}
            {channelCell(row, 'slack', t('notificationsPage.slack'))}
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
              {pushSupported ? t('notificationsPage.pushBody') : t('notificationsPage.pushUnsupported')}
            </p>
            {pushError ? <p className="text-xs text-status-error">{pushError}</p> : null}
          </div>
          <Switch
            checked={pushEnabled}
            disabled={!pushSupported || pushBusy || !token}
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
            {!slackConnected ? (
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
            .
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
