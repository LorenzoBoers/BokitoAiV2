import { useCallback, useEffect, useState } from 'react'
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
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-accent/40 bg-accent/8 px-2.5 py-1">
      <Building2 size={14} className="shrink-0 text-accent" />
      <div className="hidden min-w-0 sm:block">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-accent">{t('staffBar.label')}</p>
        <p className="truncate text-[11px] text-text-muted">{t('staffBar.viewing', { workspace: label })}</p>
      </div>
      {loading ? (
        <Loader2 size={14} className="animate-spin text-text-muted" />
      ) : (
        <Select
          value={activeTenantId || undefined}
          onValueChange={(value) => void onTenantChange(value)}
          disabled={switching || tenants.length === 0}
        >
          <SelectTrigger className="h-8 min-w-[160px] max-w-[280px] border-0 bg-transparent px-2 text-[13px] shadow-none focus:ring-0">
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
      {switching ? <Loader2 size={14} className="animate-spin text-text-muted" /> : null}
      {error ? <span className="truncate text-[11px] text-status-error">{error}</span> : null}
    </div>
  )
}
