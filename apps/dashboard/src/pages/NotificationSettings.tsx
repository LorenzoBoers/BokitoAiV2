import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/button'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Bell, BellRing, RotateCcw, Volume2 } from 'lucide-react'
import { Switch } from '../components/ui/switch'
import { Card } from '../components/ui/card'
import { NotificationMatrixSkeleton } from '../components/ui/skeleton'
import { PageContent } from '../components/layout/PageContent'
import { useAuth } from '../context/AuthContext'
import { policyRoutes } from '../api/routes/policy.routes'
import { APP_API_BASE } from '../lib/api.config'
import {
  CATEGORY_ALLOWED,
  categoryCellsOn,
  defaultNotificationPrefs,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_SECTIONS,
  NOTIFICATION_TIERS,
  normalizeNotificationPrefs,
  setCategoryCells,
  setCategoryChannel,
  setTierCells,
  setTierChannel,
  TIER_ALLOWED,
  tierCellsOn,
  type NotificationChannel,
  type NotificationPrefs,
  type NotificationTier,
} from '../lib/notification-prefs'
import {
  playIncomingNotificationSound,
  setNotificationSoundEnabled,
  unlockNotificationAudio,
} from '../lib/notification-sound'
import {
  ensureWebPush,
  getCurrentPushSubscription,
  getNotificationPermission,
  isWebPushServerConfigured,
  isWebPushSupported,
  reopenPushSoftPrompt,
} from '../lib/web-push'
import { cn } from '../lib/utils'
import { Tip } from '../components/ui/Tip'
import { useConfirm } from '../components/ui/confirm-dialog'

const GRID = 'grid-cols-[minmax(0,1fr)_72px_72px_72px]'

function MatrixRow({
  title,
  hint,
  allowed,
  channels,
  channelLabel,
  onChannel,
  locked,
}: {
  title: string
  hint?: string
  allowed: NotificationChannel[]
  channels: Record<NotificationChannel, boolean>
  channelLabel: (channel: NotificationChannel) => string
  onChannel: (channel: NotificationChannel, value: boolean) => void
  locked?: NotificationChannel[]
}) {
  return (
    <div className={`grid ${GRID} items-center border-b border-border px-5 py-3 last:border-b-0`}>
      <div className="min-w-0 pr-3">
        <p className="text-sm text-text-primary">{title}</p>
        {hint ? <p className="text-xs text-text-muted">{hint}</p> : null}
      </div>
      {NOTIFICATION_CHANNELS.map((channel) => (
        <Cell
          key={channel}
          allowed={allowed.includes(channel)}
          checked={channels[channel] || locked?.includes(channel) === true}
          label={channelLabel(channel)}
          disabled={locked?.includes(channel)}
          onChange={(value) => onChannel(channel, value)}
        />
      ))}
    </div>
  )
}

function SectionHead({
  testId,
  title,
  channelOn,
  channelAllowed,
  channelLabel,
  onChannel,
}: {
  testId: string
  title: string
  channelOn: (channel: NotificationChannel) => boolean
  channelAllowed: (channel: NotificationChannel) => boolean
  channelLabel: (channel: NotificationChannel) => string
  onChannel: (channel: NotificationChannel, value: boolean) => void
}) {
  return (
    <div
      className={`grid ${GRID} items-center border-b border-border bg-bg-elevated px-5 py-2.5`}
      data-testid={testId}
    >
      <p className="pr-3 text-xs font-semibold text-text-muted">{title}</p>
      {NOTIFICATION_CHANNELS.map((channel) => (
        <Cell
          key={channel}
          allowed={channelAllowed(channel)}
          checked={channelOn(channel)}
          label={channelLabel(channel)}
          onChange={(value) => onChannel(channel, value)}
        />
      ))}
    </div>
  )
}

function Cell({
  allowed,
  checked,
  label,
  disabled,
  onChange,
}: {
  allowed: boolean
  checked: boolean
  label: string
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className={cn('flex justify-center', disabled && 'opacity-40')}>
      {allowed ? (
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
          aria-label={label}
        />
      ) : (
        <span className="text-xs text-text-muted">-</span>
      )}
    </div>
  )
}

export default function NotificationSettings() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const confirm = useConfirm()
  const [prefs, setPrefs] = useState<NotificationPrefs>(defaultNotificationPrefs)
  const savedPrefs = useRef(prefs)
  const [loading, setLoading] = useState(true)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [pushReady, setPushReady] = useState(false)
  const [pushServerConfigured, setPushServerConfigured] = useState<boolean | null>(null)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)

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
      .then((data: unknown) => {
        const next = normalizeNotificationPrefs(data)
        savedPrefs.current = next
        setNotificationSoundEnabled(next.sound)
        setPrefs(next)
      })
      .catch(() => {
        const next = defaultNotificationPrefs()
        setNotificationSoundEnabled(next.sound)
        setPrefs(next)
      })
      .finally(() => setLoading(false))
  }, [token, t])

  const refreshPush = useCallback(async () => {
    if (!isWebPushSupported()) {
      setPushReady(false)
      setPushServerConfigured(false)
      return
    }
    setPushServerConfigured(await isWebPushServerConfigured())
    setPushReady((await getCurrentPushSubscription()) != null)
  }, [])

  useEffect(() => {
    void refreshPush()
  }, [refreshPush])

  const enrollPush = useCallback(async () => {
    if (!token || pushBusy) return false
    setPushBusy(true)
    setPushError(null)
    try {
      await ensureWebPush(token)
      setPushReady(true)
      return true
    } catch (err) {
      setPushError(err instanceof Error ? err.message : t('notificationsPage.pushFailed'))
      setPushReady((await getCurrentPushSubscription()) != null)
      reopenPushSoftPrompt()
      return false
    } finally {
      setPushBusy(false)
    }
  }, [token, pushBusy, t])

  const save = useCallback(
    async (next: NotificationPrefs) => {
      setPrefs(next)
      setNotificationSoundEnabled(next.sound)
      if (!token) return
      setSaveError(null)
      const res = await fetch(`${APP_API_BASE}${policyRoutes.notificationPreferences()}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(next),
      })
      if (res.ok) {
        savedPrefs.current = next
        setSavedAt(Date.now())
      } else {
        setPrefs(savedPrefs.current)
        setNotificationSoundEnabled(savedPrefs.current.sound)
        setSaveError(t('notificationsPage.saveFailed'))
      }
    },
    [token, t],
  )

  const playTestSound = useCallback(() => {
    unlockNotificationAudio()
    void playIncomingNotificationSound({ force: true })
  }, [])

  /** Persist prefs; when push turns on, enroll this browser first. */
  const apply = useCallback(
    async (next: NotificationPrefs, opts?: { enablingPush?: boolean }) => {
      if (opts?.enablingPush && !pushReady) {
        const ok = await enrollPush()
        if (!ok) return
      }
      await save(next)
    },
    [pushReady, enrollPush, save],
  )

  const channelLabel = (channel: NotificationChannel) =>
    t(`notificationsPage.${channel === 'inapp' ? 'inApp' : channel}`)

  const wantsPush =
    NOTIFICATION_TIERS.some((tier) => TIER_ALLOWED[tier].includes('push') && prefs.tiers[tier].push) ||
    prefs.rows.some((row) => (CATEGORY_ALLOWED[row.id] ?? []).includes('push') && row.channels.push)

  const pushSupported = isWebPushSupported()
  const permission = getNotificationPermission()
  const showDeviceBanner =
    pushSupported &&
    pushServerConfigured === true &&
    !pushReady &&
    (wantsPush || permission === 'denied')

  return (
    <PageContent width="lg" className="space-y-5 py-1">
      <p className="text-sm text-text-secondary">{t('notificationsPage.intro')}</p>

      {showDeviceBanner ? (
        <Card className="p-4" data-testid="push-device-banner">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="inline-flex items-center gap-2 text-sm font-medium text-text-heading">
                <BellRing size={14} className="text-text-muted" />
                {t('notificationsPage.pushEnableTitle')}
              </p>
              <p className="text-xs text-text-secondary">
                {permission === 'denied'
                  ? t('notificationsPage.pushBlockedBody')
                  : t('notificationsPage.pushEnableBody')}
              </p>
              {pushError ? <p className="text-xs text-status-error">{pushError}</p> : null}
            </div>
            {permission === 'denied' ? null : (
              <Button variant="secondary"
                type="button"
                disabled={pushBusy || !token}
                onClick={() => void enrollPush()}
                className="shrink-0"
              >
                {t('notificationsPage.pushEnable')}
              </Button>
            )}
          </div>
        </Card>
      ) : null}

      {!pushSupported || pushServerConfigured === false ? (
        <p className="text-xs text-text-muted">
          {!pushSupported
            ? t('notificationsPage.pushUnsupported')
            : t('notificationsPage.pushNotConfigured')}
        </p>
      ) : null}

      <Card className="p-4" data-testid="notification-sound-card">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="inline-flex items-center gap-2 text-sm font-medium text-text-heading">
              <Volume2 size={14} className="text-text-muted" />
              {t('notificationsPage.soundTitle')}
            </p>
            <p className="text-xs text-text-secondary">{t('notificationsPage.soundBody')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary"
              type="button"
              onClick={playTestSound}
             
            >
              {t('notificationsPage.soundTest')}
            </Button>
            <Switch
              checked={prefs.sound}
              onCheckedChange={(value) => void apply({ ...prefs, sound: value })}
              aria-label={t('notificationsPage.soundTitle')}
            />
          </div>
        </div>
      </Card>

      {prefs.reach ? (
        <Card className="space-y-3 p-4" data-testid="notification-reach-card">
          <div className="space-y-1">
            <p className="text-sm font-medium text-text-heading">{t('notificationsPage.reach.title')}</p>
            <p className="text-xs text-text-secondary">{t('notificationsPage.reach.body')}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-xs text-text-muted">
              <span>{t('notificationsPage.reach.quietFrom')}</span>
              <input
                type="time"
                value={prefs.reach.quiet_from ?? ''}
                onChange={(event) =>
                  void apply({ ...prefs, reach: { ...prefs.reach!, quiet_from: event.target.value || null } })
                }
                className="h-8 w-full rounded-md border border-border bg-bg-input/60 px-2 text-sm text-text-heading outline-none focus:ring-1 focus:ring-border"
              />
            </label>
            <label className="space-y-1 text-xs text-text-muted">
              <span>{t('notificationsPage.reach.quietTo')}</span>
              <input
                type="time"
                value={prefs.reach.quiet_to ?? ''}
                onChange={(event) =>
                  void apply({ ...prefs, reach: { ...prefs.reach!, quiet_to: event.target.value || null } })
                }
                className="h-8 w-full rounded-md border border-border bg-bg-input/60 px-2 text-sm text-text-heading outline-none focus:ring-1 focus:ring-border"
              />
            </label>
            <label className="space-y-1 text-xs text-text-muted">
              <span>{t('notificationsPage.reach.maxPerDay')}</span>
              <input
                type="number"
                min={0}
                max={200}
                value={prefs.reach.max_per_day}
                onChange={(event) =>
                  void apply({
                    ...prefs,
                    reach: { ...prefs.reach!, max_per_day: Math.max(0, Math.min(200, Number(event.target.value) || 0)) },
                  })
                }
                className="h-8 w-full rounded-md border border-border bg-bg-input/60 px-2 text-sm text-text-heading outline-none focus:ring-1 focus:ring-border"
              />
            </label>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm text-text-heading">{t('notificationsPage.reach.callTitle')}</p>
              <p className="text-xs text-text-secondary">{t('notificationsPage.reach.callBody')}</p>
            </div>
            <Switch
              checked={prefs.reach.agents_may_call}
              onCheckedChange={(value) => void apply({ ...prefs, reach: { ...prefs.reach!, agents_may_call: value } })}
              aria-label={t('notificationsPage.reach.callTitle')}
            />
          </div>
        </Card>
      ) : null}

      {saveError ? <p className="text-sm text-status-error">{saveError}</p> : null}

      {loading ? <NotificationMatrixSkeleton /> : null}

      <Card className={`overflow-hidden ${loading ? 'hidden' : ''}`} data-testid="notification-tiers">
        <div className={`grid ${GRID} border-b border-border px-5 py-3 text-xs font-semibold text-text-muted`}>
          <span className="flex items-center gap-1.5">
            {t('notificationsPage.notifyMe')}
            <Tip label={t('notificationsPage.restoreDefaults')}>
              <Button variant="ghost" size="iconSm"
                type="button"
                onClick={() => {
                  void (async () => {
                    if (!(await confirm({ description: t('notificationsPage.restoreConfirm') }))) return
                    await apply(defaultNotificationPrefs())
                  })()
                }}
                aria-label={t('notificationsPage.restoreDefaults')}
               
              >
                <RotateCcw size={14} aria-hidden />
              </Button>
            </Tip>
          </span>
          {NOTIFICATION_CHANNELS.map((channel) => (
            <span key={channel} className="text-center">
              {channelLabel(channel)}
            </span>
          ))}
        </div>
        <SectionHead
          testId="notification-section-delivery"
          title={t('notificationsPage.sections.delivery')}
          channelOn={(channel) => tierCellsOn(prefs, NOTIFICATION_TIERS, [channel])}
          channelAllowed={(channel) => NOTIFICATION_TIERS.some((tier) => TIER_ALLOWED[tier].includes(channel))}
          channelLabel={(channel) =>
            `${t('notificationsPage.sections.delivery')} ${channelLabel(channel)}`
          }
          onChannel={(channel, value) =>
            void apply(setTierCells(prefs, NOTIFICATION_TIERS, [channel], value), {
              enablingPush: channel === 'push' && value,
            })
          }
        />
        {NOTIFICATION_TIERS.map((tier) => (
          <MatrixRow
            key={tier}
            title={t(`notificationsPage.tiers.${tier}.title`)}
            hint={t(`notificationsPage.tiers.${tier}.hint`)}
            allowed={TIER_ALLOWED[tier]}
            channels={prefs.tiers[tier]}
            channelLabel={(channel) => `${t(`notificationsPage.tiers.${tier}.title`)} ${channelLabel(channel)}`}
            onChannel={(channel, value) =>
              void apply(setTierChannel(prefs, tier as NotificationTier, channel, value), {
                enablingPush: channel === 'push' && value,
              })
            }
          />
        ))}
        {NOTIFICATION_SECTIONS.map((section) => (
          <div key={section.id}>
            <SectionHead
              testId={`notification-section-${section.id}`}
              title={t(`notificationsPage.sections.${section.id}`)}
              channelOn={(channel) => categoryCellsOn(prefs, section.rows, [channel])}
              channelAllowed={(channel) => section.rows.some((id) => (CATEGORY_ALLOWED[id] ?? []).includes(channel))}
              channelLabel={(channel) =>
                `${t(`notificationsPage.sections.${section.id}`)} ${channelLabel(channel)}`
              }
              onChannel={(channel, value) =>
                void apply(setCategoryCells(prefs, section.rows, [channel], value), {
                  enablingPush: channel === 'push' && value,
                })
              }
            />
            {section.rows.map((id) => {
              const row = prefs.rows.find((item) => item.id === id)
              if (!row) return null
              const label = t(`notificationsPage.rows.${id}`)
              return (
                <MatrixRow
                  key={id}
                  title={label}
                  hint={id.startsWith('ops-') ? t('notificationsPage.opsAlways') : undefined}
                  allowed={CATEGORY_ALLOWED[id] ?? []}
                  channels={row.channels}
                  locked={id.startsWith('ops-') ? ['inapp'] : undefined}
                  channelLabel={(channel) => `${label} ${channelLabel(channel)}`}
                  onChannel={(channel, value) =>
                    void apply(setCategoryChannel(prefs, id, channel, value), {
                      enablingPush: channel === 'push' && value,
                    })
                  }
                />
              )
            })}
          </div>
        ))}
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

      <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-bg-elevated/55 px-3 py-2 text-xs text-text-secondary">
        <Bell size={14} className="text-text-muted" />
        {savedAt ? t('notificationsPage.saved') : t('notificationsPage.savedHint')}
      </div>
    </PageContent>
  )
}
