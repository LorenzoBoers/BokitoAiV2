import { useMemo, useState } from 'react'
import { Bell, Mail, Monitor, Smartphone } from 'lucide-react'
import { Switch } from '../components/ui/switch'

type ChannelKey = 'desktop' | 'email' | 'mobile'

type NotificationRow = {
  id: string
  label: string
  channels: Record<ChannelKey, boolean>
}

const DEFAULT_ROWS: NotificationRow[] = [
  {
    id: 'unassigned',
    label: 'Activity from all unassigned conversations',
    channels: { desktop: true, email: false, mobile: false },
  },
  {
    id: 'assigned-to-me',
    label: 'Activity for conversations assigned to you',
    channels: { desktop: true, email: true, mobile: true },
  },
  {
    id: 'team-conversations',
    label: 'Activity from your team conversations',
    channels: { desktop: true, email: false, mobile: false },
  },
  {
    id: 'assigned-to-others',
    label: 'Activity from conversations assigned to other teammates',
    channels: { desktop: false, email: false, mobile: false },
  },
  {
    id: 'mentions',
    label: 'When you are mentioned in conversations',
    channels: { desktop: true, email: true, mobile: true },
  },
  {
    id: 'started-by-you',
    label: 'Activity on conversations you started',
    channels: { desktop: true, email: true, mobile: true },
  },
  {
    id: 'status-changes',
    label: 'Ticket status changes',
    channels: { desktop: true, email: true, mobile: true },
  },
]

const STORAGE_KEY = 'bokito_notification_settings_v1'

export default function NotificationSettings() {
  const [rows, setRows] = useState<NotificationRow[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return DEFAULT_ROWS
      const parsed = JSON.parse(raw) as NotificationRow[]
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_ROWS
    } catch {
      return DEFAULT_ROWS
    }
  })

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => ({
        desktop: acc.desktop + (row.channels.desktop ? 1 : 0),
        email: acc.email + (row.channels.email ? 1 : 0),
        mobile: acc.mobile + (row.channels.mobile ? 1 : 0),
      }),
      { desktop: 0, email: 0, mobile: 0 },
    )
  }, [rows])

  function updateRow(rowId: string, channel: ChannelKey, checked: boolean) {
    setRows((prev) => {
      const next = prev.map((row) =>
        row.id === rowId
          ? { ...row, channels: { ...row.channels, [channel]: checked } }
          : row,
      )
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  return (
    <div className="mx-auto w-full max-w-[980px] space-y-4 px-1 py-1">
      <section className="space-y-1">
        <h2 className="text-[26px] font-semibold leading-tight text-text-heading">Notifications</h2>
        <p className="text-sm text-text-secondary">
          Change what notifications you receive from Bokito.
        </p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/70 bg-bg-surface/92">
        <div className="grid grid-cols-[1fr_96px_88px_88px] border-b border-border/65 px-5 py-3 text-xs font-semibold uppercase tracking-[0.07em] text-text-muted">
          <span>Notify me about</span>
          <span className="text-center">Desktop</span>
          <span className="text-center">Email</span>
          <span className="text-center">Mobile</span>
        </div>

        {rows.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[1fr_96px_88px_88px] items-center border-b border-border/60 px-5 py-3 last:border-b-0"
          >
            <p className="pr-3 text-sm text-text-primary">{row.label}</p>
            <div className="flex justify-center">
              <Switch
                checked={row.channels.desktop}
                onCheckedChange={(checked) => updateRow(row.id, 'desktop', checked)}
                aria-label={`${row.label} desktop`}
              />
            </div>
            <div className="flex justify-center">
              <Switch
                checked={row.channels.email}
                onCheckedChange={(checked) => updateRow(row.id, 'email', checked)}
                aria-label={`${row.label} email`}
              />
            </div>
            <div className="flex justify-center">
              <Switch
                checked={row.channels.mobile}
                onCheckedChange={(checked) => updateRow(row.id, 'mobile', checked)}
                aria-label={`${row.label} mobile`}
              />
            </div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-3 rounded-2xl border border-border/70 bg-bg-surface/92 p-4 sm:grid-cols-3">
        <div className="space-y-1">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-text-heading">
            <Monitor size={14} className="text-text-muted" />
            Desktop
          </p>
          <p className="text-xs text-text-secondary">A banner in the corner of your screen.</p>
          <p className="text-xs font-medium text-text-muted">{summary.desktop} enabled</p>
        </div>
        <div className="space-y-1">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-text-heading">
            <Mail size={14} className="text-text-muted" />
            Email
          </p>
          <p className="text-xs text-text-secondary">Conversations sent to your inbox.</p>
          <p className="text-xs font-medium text-text-muted">{summary.email} enabled</p>
        </div>
        <div className="space-y-1">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-text-heading">
            <Smartphone size={14} className="text-text-muted" />
            Mobile
          </p>
          <p className="text-xs text-text-secondary">Push notifications on your phone.</p>
          <p className="text-xs font-medium text-text-muted">{summary.mobile} enabled</p>
        </div>
      </section>

      <div className="inline-flex items-center gap-2 rounded-lg border border-border/65 bg-bg-input/55 px-3 py-2 text-xs text-text-secondary">
        <Bell size={13} className="text-text-muted" />
        Notification preferences are saved locally as UX draft.
      </div>
    </div>
  )
}
