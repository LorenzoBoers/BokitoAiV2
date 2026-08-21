import { useCallback, useEffect, useMemo, useState } from 'react'
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

const STORAGE_KEY = 'bokito_notification_settings_v1'

export default function NotificationSettings() {
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
        if (Array.isArray(parsed) && parsed.length > 0) setRows(parsed)
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
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Load failed'))))
      .then((data: { rows?: NotificationRow[] }) => {
        if (Array.isArray(data.rows) && data.rows.length > 0) {
          const filtered = data.rows.filter((row) => KNOWN_ROW_IDS.has(row.id))
          setRows(filtered.length > 0 ? filtered : DEFAULT_ROWS)
        }
      })
      .catch(() => setRows(DEFAULT_ROWS))
      .finally(() => setLoading(false))
  }, [token])

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
        setPushError(err instanceof Error ? err.message : 'Could not update push notifications.')
        setPushEnabled((await getCurrentPushSubscription()) != null)
      } finally {
        setPushBusy(false)
      }
    },
    [token, pushBusy],
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
          setSaveError('Could not save notification preferences.')
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
    [token],
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
          aria-label={`${row.label} ${label}`}
          title={gatedOnSlack ? 'Connect a Slack workspace first (Settings > Email & messages)' : undefined}
        />
      </div>
    )
  }

  return (
    <PageContent width="lg" className="space-y-5 py-1">
      <p className="text-sm text-text-secondary">
        Choose which in-app notifications you receive in Bokito.
      </p>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[1fr_84px_84px_84px] border-b border-border/60 px-5 py-3 text-xs font-semibold uppercase tracking-[0.07em] text-text-muted">
          <span>Notify me about</span>
          <span className="text-center">In-app</span>
          <span className="text-center">Email</span>
          <span className="text-center">Slack</span>
        </div>

        {rows.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[1fr_84px_84px_84px] items-center border-b border-border/60 px-5 py-3 last:border-b-0"
          >
            <p className="pr-3 text-sm text-text-primary">{row.label}</p>
            {channelCell(row, 'desktop', 'in-app')}
            {channelCell(row, 'email', 'email')}
            {channelCell(row, 'slack', 'Slack')}
          </div>
        ))}
      </Card>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="inline-flex items-center gap-2 text-sm font-medium text-text-heading">
              <BellRing size={14} className="text-text-muted" />
              Push notifications on this device
            </p>
            <p className="text-xs text-text-secondary">
              {pushSupported
                ? 'Get a system notification for new messages and pending decisions, even when Bokito is closed. Applies to this browser only; decision pushes follow your in-app preference above.'
                : 'This browser does not support push notifications.'}
            </p>
            {pushError ? <p className="text-xs text-status-error">{pushError}</p> : null}
          </div>
          <Switch
            checked={pushEnabled}
            disabled={!pushSupported || pushBusy || !token}
            onCheckedChange={(checked) => void togglePush(checked)}
            aria-label="Push notifications on this device"
          />
        </div>
      </Card>

      <Card className="p-4">
        <div className="space-y-1">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-text-heading">
            <Monitor size={14} className="text-text-muted" />
            Channels
          </p>
          <p className="text-xs text-text-secondary">
            In-app notifications appear in the bell menu in the top bar. Email notifications are
            sent to your account address. Slack sends a direct message with Approve/Deny buttons
            and requires a connected Slack workspace.
            {!slackConnected ? (
              <>
                {' '}
                <Link to="/settings/channels" className="text-accent hover:underline">
                  Connect Slack
                </Link>{' '}
                to enable the Slack toggles.
              </>
            ) : null}
          </p>
          <p className="text-xs font-medium text-text-muted">{desktopEnabled} in-app enabled</p>
        </div>
      </Card>

      {loading ? <p className="text-sm text-text-muted">Loading preferences...</p> : null}
      {saveError ? <p className="text-sm text-status-error">{saveError}</p> : null}
      <div className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-bg-elevated/55 px-3 py-2 text-xs text-text-secondary">
        <Bell size={13} className="text-text-muted" />
        {savedAt ? 'Saved.' : 'Preferences are saved to your account.'}
      </div>
    </PageContent>
  )
}
