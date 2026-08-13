import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, Monitor } from 'lucide-react'
import { Switch } from '../components/ui/switch'
import { Card } from '../components/ui/card'
import { PageContent } from '../components/layout/PageContent'
import { useAuth } from '../context/AuthContext'
import { policyRoutes } from '../api/routes/policy.routes'

type NotificationRow = {
  id: string
  label: string
  channels: { desktop: boolean; email: boolean; mobile: boolean }
}

// Only categories the backend actually enforces at the emission point.
const DEFAULT_ROWS: NotificationRow[] = [
  {
    id: 'assigned-to-me',
    label: 'When a conversation is assigned to you',
    channels: { desktop: true, email: false, mobile: false },
  },
  {
    id: 'mentions',
    label: 'When you are mentioned in conversations',
    channels: { desktop: true, email: false, mobile: false },
  },
]

const KNOWN_ROW_IDS = new Set(DEFAULT_ROWS.map((row) => row.id))

const STORAGE_KEY = 'bokito_notification_settings_v1'

export default function NotificationSettings() {
  const { token } = useAuth()
  const [rows, setRows] = useState<NotificationRow[]>(DEFAULT_ROWS)
  const [loading, setLoading] = useState(true)
  const [saveError, setSaveError] = useState<string | null>(null)

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
        }
        return
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
    },
    [token],
  )

  function updateDesktop(rowId: string, checked: boolean) {
    setRows((prev) => {
      const next = prev.map((row) =>
        row.id === rowId
          ? { ...row, channels: { ...row.channels, desktop: checked } }
          : row,
      )
      void persistRows(next)
      return next
    })
  }

  return (
    <PageContent width="lg" className="space-y-5 py-1">
      <p className="text-sm text-text-secondary">
        Choose which in-app notifications you receive in Bokito.
      </p>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[1fr_120px] border-b border-border/65 px-5 py-3 text-xs font-semibold uppercase tracking-[0.07em] text-text-muted">
          <span>Notify me about</span>
          <span className="text-center">In-app</span>
        </div>

        {rows.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[1fr_120px] items-center border-b border-border/60 px-5 py-3 last:border-b-0"
          >
            <p className="pr-3 text-sm text-text-primary">{row.label}</p>
            <div className="flex justify-center">
              <Switch
                checked={row.channels.desktop}
                onCheckedChange={(checked) => updateDesktop(row.id, checked)}
                aria-label={`${row.label} in-app`}
              />
            </div>
          </div>
        ))}
      </Card>

      <Card className="p-4">
        <div className="space-y-1">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-text-heading">
            <Monitor size={14} className="text-text-muted" />
            In-app notifications
          </p>
          <p className="text-xs text-text-secondary">
            Shown in the bell menu in the top bar. Email and mobile push are not available yet.
          </p>
          <p className="text-xs font-medium text-text-muted">{desktopEnabled} enabled</p>
        </div>
      </Card>

      {loading ? <p className="text-sm text-text-muted">Loading preferences...</p> : null}
      {saveError ? <p className="text-sm text-status-error">{saveError}</p> : null}
      <div className="inline-flex items-center gap-2 rounded-lg border border-border/65 bg-bg-elevated/55 px-3 py-2 text-xs text-text-secondary">
        <Bell size={13} className="text-text-muted" />
        Preferences are saved to your account.
      </div>
    </PageContent>
  )
}
