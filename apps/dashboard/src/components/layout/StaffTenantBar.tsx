import { useCallback, useEffect, useState } from 'react'
import { Building2, Loader2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { isBokitoMode } from '../../lib/bokito-mode'
import { listStaffTenants, type StaffTenantOption } from '../../lib/staff-api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

export default function StaffTenantBar() {
  const { user, token, isStaff, switchStaffTenant } = useAuth()
  const [tenants, setTenants] = useState<StaffTenantOption[]>([])
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeTenantId = user?.organisationId ?? ''

  useEffect(() => {
    if (!isBokitoMode() || !isStaff || !token) return
    let cancelled = false
    setLoading(true)
    setError(null)
    listStaffTenants(token)
      .then((rows) => {
        if (!cancelled) setTenants(rows)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load tenants')
          setTenants([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isStaff, token])

  const onTenantChange = useCallback(
    async (nextId: string) => {
      if (!nextId || nextId === activeTenantId || switching) return
      setSwitching(true)
      setError(null)
      try {
        await switchStaffTenant(nextId)
        window.location.reload()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to switch tenant')
        setSwitching(false)
      }
    },
    [activeTenantId, switchStaffTenant, switching],
  )

  if (!isBokitoMode() || !isStaff) return null

  const label = tenants.find((t) => t.id === activeTenantId)?.name ?? user?.tenant?.name ?? 'Tenant'

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-bg-elevated/40 px-2.5 py-1">
      <Building2 size={14} className="shrink-0 text-text-muted" />
      <span className="hidden text-[11px] font-medium uppercase tracking-wide text-text-muted sm:inline">
        Staff
      </span>
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
              <SelectItem key={tenant.id} value={tenant.id}>
                {tenant.name} ({tenant.slug})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {switching ? <Loader2 size={14} className="animate-spin text-text-muted" /> : null}
      {error ? <span className="truncate text-[11px] text-red-600">{error}</span> : null}
    </div>
  )
}
