import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Bell, BellRing, ChevronDown, ChevronRight } from 'lucide-react'
import { Switch } from '../components/ui/switch'
import { Card } from '../components/ui/card'
import { PageContent } from '../components/layout/PageContent'
import { useAuth } from '../context/AuthContext'
import { policyRoutes } from '../api/routes/policy.routes'
import { APP_API_BASE } from '../lib/api.config'
import {
  CATEGORY_ALLOWED,
  defaultNotificationPrefs,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TIERS,
  normalizeNotificationPrefs,
  setCategoryChannel,
  setTierChannel,
  TIER_ALLOWED,
  type NotificationChannel,
  type NotificationPrefs,
} from '../lib/notification-prefs'
import {
  disableWebPush,
  enableWebPush,
  getCurrentPushSubscription,
  isWebPushServerConfigured,
  isWebPushSupported,
} from '../lib/web-push'

const GRID = 'grid-cols-[1fr_72px_72px_72px]'

function Cell({
  allowed,
  checked,
  label,
  onChange,
}: {
  allowed: boolean
  checked: boolean
  label: string
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex justify-center">
      {allowed ? (
        <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
      ) : (
        <span className="text-xs text-text-muted/50">-</span>
      )}
    </div>
  )
}

export default function NotificationSettings() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [prefs, setPrefs] = useState<NotificationPrefs>(defaultNotificationPrefs)
  const [loading, setLoading] = useState(true)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [showEvents, setShowEvents] = useState(false)

  useEffect(() => {
    if (savedAt == null) return
    const timer = window.setTimeout(() => setSavedAt(null), 2000)
    return () => window.clearTimeout(timer)
  }, [savedAt])

  useEffect(() => {
    if (!token) return
    setLoading(true)
    fetch(`${APP_API_BASE}${policyRoutes.notificationPreferences()}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(t('notificationsPage.loadFailed')))))
      .then((data: unknown) => setPrefs(normalizeNotificationPrefs(data)))
      .catch(() => setPrefs(defaultNotificationPrefs()))
      .finally(() => setLoading(false))
  }, [token, t])

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

  const save = useCallback(
    async (next: NotificationPrefs) => {
      setPrefs(next)
      if (!token) return
      setSaveError(null)
      const res = await fetch(`${APP_API_BASE}${policyRoutes.notificationPreferences()}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(next),
      })
      if (res.ok) setSavedAt(Date.now())
      else setSaveError(t('notificationsPage.saveFailed'))
    },
    [token, t],
  )

  const channelLabel = (channel: NotificationChannel) =>
    t(`notificationsPage.${channel === 'inapp' ? 'inApp' : channel}`)

  const header = (first: string) => (
    <div className={`grid ${GRID} border-b border-border/60 px-5 py-3 text-xs font-semibold text-text-muted`}>
      <span>{first}</span>
      {NOTIFICATION_CHANNELS.map((channel) => (
        <span key={channel} className="text-center">
          {channelLabel(channel)}
        </span>
      ))}
    </div>
  )

  return (
    <PageContent width="lg" className="space-y-5 py-1">
      <p className="text-sm text-text-secondary">{t('notificationsPage.intro')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save(defaultNotificationPrefs())}
          className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover/60"
        >
          {t('notificationsPage.restoreDefaults')}
        </button>
        <button
          type="button"
          onClick={() =>
            toast.message(t('notificationsPage.previewTitle'), { description: t('notificationsPage.previewBody') })
          }
          className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover/60"
        >
          {t('notificationsPage.preview')}
        </button>
      </div>

      <Card className="overflow-hidden" data-testid="notification-tiers">
        {header(t('notificationsPage.tierColumn'))}
        {NOTIFICATION_TIERS.map((tier) => (
          <div key={tier} className={`grid ${GRID} items-center border-b border-border/60 px-5 py-3 last:border-b-0`}>
            <div className="pr-3">
              <p className="text-sm text-text-primary">{t(`notificationsPage.tiers.${tier}.title`)}</p>
              <p className="text-xs text-text-muted">{t(`notificationsPage.tiers.${tier}.hint`)}</p>
            </div>
            {NOTIFICATION_CHANNELS.map((channel) => (
              <Cell
                key={channel}
                allowed={TIER_ALLOWED[tier].includes(channel)}
                checked={prefs.tiers[tier][channel]}
                label={`${t(`notificationsPage.tiers.${tier}.title`)} ${channelLabel(channel)}`}
                onChange={(value) => void save(setTierChannel(prefs, tier, channel, value))}
              />
            ))}
          </div>
        ))}
      </Card>

      <div>
        <button
          type="button"
          onClick={() => setShowEvents((v) => !v)}
          aria-expanded={showEvents}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-heading"
        >
          {showEvents ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t('notificationsPage.perEvent')}
        </button>
        {showEvents ? (
          <Card className="mt-2 overflow-hidden" data-testid="notification-events">
            {header(t('notificationsPage.notifyMe'))}
            {prefs.rows.map((row) => (
              <div key={row.id} className={`grid ${GRID} items-center border-b border-border/60 px-5 py-3 last:border-b-0`}>
                <p className="pr-3 text-sm text-text-primary">{t(`notificationsPage.rows.${row.id}`)}</p>
                {NOTIFICATION_CHANNELS.map((channel) => (
                  <Cell
                    key={channel}
                    allowed={(CATEGORY_ALLOWED[row.id] ?? []).includes(channel)}
                    checked={row.channels[channel]}
                    label={`${t(`notificationsPage.rows.${row.id}`)} ${channelLabel(channel)}`}
                    onChange={(value) => void save(setCategoryChannel(prefs, row.id, channel, value))}
                  />
                ))}
              </div>
            ))}
          </Card>
        ) : null}
      </div>

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
            disabled={!pushSupported || pushBusy || !token || pushServerConfigured !== true}
            onCheckedChange={(checked) => void togglePush(checked)}
            aria-label={t('notificationsPage.pushAria')}
          />
        </div>
      </Card>

      <Card className="p-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-heading">{t('notificationsPage.channelsTitle')}</p>
          <p className="text-xs text-text-secondary">{t('notificationsPage.channelsBody')}</p>
          <p className="text-xs text-text-secondary">
            {t('notificationsPage.budgetHint')}{' '}
            <Link to="/cockpit/usage" className="text-accent hover:underline">
              {t('notificationsPage.openUsage')}
            </Link>
            {'.'}
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
