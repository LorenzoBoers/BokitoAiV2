import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AccessPicker, type AccessState } from '../access/AccessPicker'
import { CalendarSwatch } from '../agenda/CalendarSwatch'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Input } from '../ui/input'
import { CalendarListSkeleton } from '../ui/skeleton'
import { EmptyState } from '../ui/empty-state'
import { Switch } from '../ui/switch'
import {
  getCalendarAccess,
  listTenantCalendars,
  patchTenantCalendar,
  setCalendarAccess,
  setCalendarTags,
  type TenantCalendar,
} from '../../lib/calendars-api'
import { TextLink } from '../ui/text-link'

const LEVELS = ['use', 'manage'] as const

/** Per-calendar sync, tags and access for one connected account. */
export function CalendarTenantSettings({
  connectionId,
  onChanged,
}: {
  connectionId: string
  onChanged?: () => Promise<void> | void
}) {
  const { t } = useTranslation('calendar')
  const [rows, setRows] = useState<TenantCalendar[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const refresh = async () => {
    const all = await listTenantCalendars()
    setRows(all.filter((c) => c.connection_id === connectionId))
  }

  useEffect(() => {
    let alive = true
    listTenantCalendars()
      .then((all) => {
        if (!alive) return
        setRows(all.filter((c) => c.connection_id === connectionId))
      })
      .catch(() => alive && setRows([]))
    return () => {
      alive = false
    }
  }, [connectionId])

  if (rows == null) {
    return <CalendarListSkeleton rows={3} />
  }
  if (rows.length === 0) {
    return <EmptyState tone="plain" size="sm" className="px-0 py-1" title={t('tenant.empty')} />
  }

  return (
    <div className="space-y-2" data-testid="calendar-tenant-settings">
      <div>
        <p className="text-xs font-medium text-text-heading">{t('tenant.title')}</p>
        <p className="mt-0.5 text-xs text-text-muted">{t('tenant.hint')}</p>
      </div>
      <ul className="space-y-2">
        {rows.map((cal) => (
          <li key={cal.id} className="rounded-md border border-border/50 px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Switch
                checked={cal.sync_enabled}
                disabled={!cal.can_manage}
                onCheckedChange={(on) => {
                  void patchTenantCalendar(cal.id, { sync_enabled: on })
                    .then(async () => {
                      await refresh()
                      await onChanged?.()
                    })
                    .catch((err) =>
                      toast.error(formatApiErrorMessage(err, t('calendars.saveError'))),
                    )
                }}
                aria-label={cal.name}
              />
              <CalendarSwatch color={cal.color} />
              <span className="min-w-0 flex-1 truncate text-sm text-text-heading">{cal.name}</span>
              {cal.tags.length > 0 ? (
                <span className="text-2xs text-text-muted">
                  {cal.tags.map((tag) => `#${tag.name}`).join(' ')}
                </span>
              ) : null}
              {cal.can_manage ? (
                <TextLink
                  type="button"
                  className="text-xs"
                  onClick={() => setOpenId((id) => (id === cal.id ? null : cal.id))}
                >
                  {openId === cal.id ? t('actions.close') : t('tenant.configure')}
                </TextLink>
              ) : null}
            </div>
            {openId === cal.id && cal.can_manage ? (
              <CalendarDetailEditor
                calendar={cal}
                onSaved={async () => {
                  await refresh()
                  await onChanged?.()
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function CalendarDetailEditor({
  calendar,
  onSaved,
}: {
  calendar: TenantCalendar
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation('calendar')
  const [tagText, setTagText] = useState(
    () => calendar.tags.map((tag) => tag.name).join(', '),
  )
  const [access, setAccess] = useState<AccessState<'use' | 'manage'> | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    getCalendarAccess(calendar.id)
      .then((res) =>
        alive &&
        setAccess({
          entries: res.entries as AccessState<'use' | 'manage'>['entries'],
          isDefault: res.is_default,
        }),
      )
      .catch(() => alive && setAccess({ entries: [], isDefault: true }))
    return () => {
      alive = false
    }
  }, [calendar.id])

  const saveTags = async () => {
    setBusy(true)
    try {
      const names = tagText
        .split(/[,\s]+/)
        .map((s) => s.replace(/^#/, '').trim())
        .filter(Boolean)
      await setCalendarTags(calendar.id, names)
      await onSaved()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('tenant.tagsError')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 space-y-4 border-t border-border/40 pt-3">
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-text-heading">{t('tenant.tags')}</p>
        <p className="text-2xs text-text-muted">{t('tenant.tagsHint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            placeholder={t('tenant.tagsPlaceholder')}
            className="h-8 max-w-sm text-xs"
            disabled={busy}
          />
          <TextLink
            type="button"
            className="text-xs"
            disabled={busy}
            onClick={() => void saveTags()}
          >
            {t('tenant.saveTags')}
          </TextLink>
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-text-heading">{t('tenant.access')}</p>
        <p className="text-2xs text-text-muted">{t('tenant.accessHint')}</p>
        {access ? (
          <AccessPicker
            access={access}
            levels={[...LEVELS]}
            canEdit
            copy={{
              title: t('tenant.access'),
              description: t('tenant.accessHint'),
              hint: t('tenant.accessHint'),
              adminsNote: t('access.hint'),
            }}
            save={async (entries) => {
              const res = await setCalendarAccess(calendar.id, entries)
              const next = {
                entries: res.entries as AccessState<'use' | 'manage'>['entries'],
                isDefault: res.is_default,
              }
              setAccess(next)
              await onSaved()
              return next
            }}
          />
        ) : null}
      </div>
    </div>
  )
}
