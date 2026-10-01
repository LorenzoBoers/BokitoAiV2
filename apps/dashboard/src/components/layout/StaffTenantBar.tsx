import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Building2, Loader2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { listStaffTenants, type StaffTenantOption } from '../../lib/staff-api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

export default function StaffTenantBar() {
  const { t } = useTranslation('nav')
  const { user, token, isStaff, switchStaffTenant } = useAuth()
  const [tenants, setTenants] = useState<StaffTenantOption[]>([])
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeTenantId = user?.organisationId ?? ''

  useEffect(() => {
    if (!isStaff || !token) return
    let cancelled = false
    setLoading(true)
    setError(null)
    listStaffTenants(token)
      .then((rows) => {
        if (!cancelled) setTenants(rows)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('staffBar.loadError'))
          setTenants([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isStaff, token, t])

  const onTenantChange = useCallback(
    async (nextId: string) => {
      const next = tenants.find((row) => row.id === nextId)
      if (!nextId || nextId === activeTenantId || switching || next?.supportAllowed === false) return
      setSwitching(true)
      setError(null)
      try {
        await switchStaffTenant(nextId)
        window.location.reload()
      } catch (err) {
        setError(err instanceof Error ? err.message : t('staffBar.switchError'))
        setSwitching(false)
      }
    },
    [activeTenantId, switchStaffTenant, switching, t, tenants],
  )

  if (!isStaff) return null

  const active = tenants.find((row) => row.id === activeTenantId)
  const label = active?.name ?? user?.tenant?.name ?? t('staffBar.label')

  return (
    <div
      className="flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-accent/30 pl-2 pr-1 text-xs"
      title={t('staffBar.viewing', { workspace: label })}
    >
      <Building2 size={12} className="shrink-0 text-accent" aria-hidden />
      <span className="hidden shrink-0 text-2xs font-medium text-accent sm:inline">{t('staffBar.label')}</span>
      {loading ? (
        <Loader2 size={12} className="animate-spin text-text-muted" />
      ) : (
        <Select
          value={activeTenantId || undefined}
          onValueChange={(value) => void onTenantChange(value)}
          disabled={switching || tenants.length === 0}
        >
          <SelectTrigger className="h-6 min-w-[120px] max-w-[220px] gap-1 border-0 bg-transparent px-1.5 text-xs shadow-none focus:ring-0">
            <SelectValue placeholder={label}>{label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {tenants.map((tenant) => (
              <SelectItem key={tenant.id} value={tenant.id} disabled={!tenant.supportAllowed}>
                {tenant.name} ({tenant.slug})
                {!tenant.supportAllowed ? ` — ${t('staffBar.locked')}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {switching ? <Loader2 size={12} className="animate-spin text-text-muted" /> : null}
      <Link
        to="/ops"
        className="flex h-5 shrink-0 items-center rounded-sm px-1.5 text-2xs font-medium text-text-secondary hover:bg-bg-hover hover:text-text-heading"
      >
        {t('staffBar.ops')}
      </Link>
      {error ? <span className="truncate-fade text-2xs text-status-error">{error}</span> : null}
    </div>
  )
}
