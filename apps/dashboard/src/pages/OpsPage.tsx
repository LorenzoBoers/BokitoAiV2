import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2, Lock, Search, Shield } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import { useConfirm } from '../components/ui/confirm-dialog'
import { Input } from '../components/ui/input'
import {
  deleteStaffOpsTenant,
  getStaffOpsDirectory,
  impersonateStaffOpsUser,
  setStaffTenantCustomModels,
  type StaffOpsDirectory,
  type StaffOpsTenant,
  type StaffOpsUser,
} from '../lib/ops-api'

function envLabel(environment: string, apiUrl: string): string {
  const env = environment.trim().toLowerCase()
  if (env === 'prod' || env === 'production') return 'production'
  if (env === 'staging' || env === 'acceptatie' || env === 'acceptance') return 'acceptance'
  if (apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1')) return 'local'
  if (env === 'dev' || env === 'development') return 'local'
  return environment || 'unknown'
}

function formatWhen(value: string | null, locale: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(locale === 'nl' ? 'nl-NL' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export default function OpsPage() {
  const { t, i18n } = useTranslation('nav')
  const { token, isStaff, switchStaffTenant, adoptWorkspaceSession, user } = useAuth()
  const confirm = useConfirm()
  const [data, setData] = useState<StaffOpsDirectory | null>(null)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enteringId, setEnteringId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [featuringId, setFeaturingId] = useState<string | null>(null)
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null)

  const load = useCallback(async (q: string) => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const payload = await getStaffOpsDirectory(token, q)
      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ops.loadError'))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [token, t])

  useEffect(() => {
    if (!isStaff || !token) return
    void load(appliedQuery)
  }, [isStaff, token, appliedQuery, load])

  const activeTenantId = user?.organisationId ?? ''

  const onSearch = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      setAppliedQuery(query.trim())
    },
    [query],
  )

  const onEnter = useCallback(
    async (tenantId: string) => {
      if (!tenantId || tenantId === activeTenantId || enteringId) return
      setEnteringId(tenantId)
      setError(null)
      try {
        await switchStaffTenant(tenantId)
        window.location.assign('/')
      } catch (err) {
        setError(err instanceof Error ? err.message : t('ops.enterError'))
        setEnteringId(null)
      }
    },
    [activeTenantId, enteringId, switchStaffTenant, t],
  )

  const onToggleCustomModels = useCallback(
    async (tenant: StaffOpsTenant, enabled: boolean) => {
      if (!token || featuringId) return
      setFeaturingId(tenant.id)
      setError(null)
      try {
        await setStaffTenantCustomModels(token, tenant.id, enabled)
        setData((prev) =>
          prev
            ? {
                ...prev,
                tenants: prev.tenants.map((row) =>
                  row.id === tenant.id ? { ...row, custom_models: enabled } : row,
                ),
              }
            : prev,
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : t('ops.customModelsError'))
      } finally {
        setFeaturingId(null)
      }
    },
    [token, featuringId, t],
  )

  const onImpersonate = useCallback(
    async (row: StaffOpsUser) => {
      if (!token || impersonatingId || row.is_staff || !row.is_active) return
      const eligible = (row.memberships ?? []).filter((m) => m.support_allowed)
      if (eligible.length === 0) {
        setError(t('ops.impersonateNoWorkspace'))
        return
      }
      let tenantId = eligible[0].tenant_id
      if (eligible.length > 1) {
        const hint = eligible.map((m) => m.slug).join(', ')
        const typed = window.prompt(t('ops.impersonatePickWorkspace', { slugs: hint }))
        if (typed == null) return
        const match = eligible.find((m) => m.slug.toLowerCase() === typed.trim().toLowerCase())
        if (!match) {
          setError(t('ops.impersonateSlugMismatch'))
          return
        }
        tenantId = match.tenant_id
      }
      setImpersonatingId(row.id)
      setError(null)
      try {
        const session = await impersonateStaffOpsUser(token, row.id, tenantId)
        const nextToken = session.authToken ?? session.access_token
        if (!nextToken) throw new Error(t('ops.impersonateError'))
        adoptWorkspaceSession(nextToken)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('ops.impersonateError'))
        setImpersonatingId(null)
      }
    },
    [token, impersonatingId, adoptWorkspaceSession, t],
  )

  const onDeleteTenant = useCallback(
    async (tenant: StaffOpsTenant) => {
      if (!token || deletingId) return
      const typed = window.prompt(t('ops.deletePrompt', { slug: tenant.slug, name: tenant.name }))
      if (typed == null) return
      if (typed.trim().toLowerCase() !== tenant.slug.toLowerCase()) {
        setError(t('ops.deleteSlugMismatch'))
        return
      }
      if (!(await confirm({ description: t('ops.deleteConfirm', { name: tenant.name }), destructive: true }))) return
      setDeletingId(tenant.id)
      setError(null)
      try {
        await deleteStaffOpsTenant(token, tenant.id, typed.trim())
        if (tenant.id === activeTenantId) {
          window.location.assign('/ops')
          return
        }
        await load(appliedQuery)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('ops.deleteError'))
      } finally {
        setDeletingId(null)
      }
    },
    [token, deletingId, activeTenantId, load, appliedQuery, t, confirm],
  )

  const env = useMemo(
    () => (data ? envLabel(data.environment, data.api_url) : null),
    [data],
  )

  if (!isStaff) {
    return <Navigate to="/" replace />
  }

  return (
    <PageContent width="xl" className="space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-text">{t('ops.title')}</h1>
            {env ? (
              <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-muted">
                {t(`ops.env.${env}`, { defaultValue: env })}
              </span>
            ) : null}
          </div>
          <p className="max-w-2xl text-sm text-text-muted">{t('ops.subtitle')}</p>
          {data?.api_url ? (
            <p className="font-mono text-xs text-text-muted">{data.api_url}</p>
          ) : null}
        </div>
        <Link
          to="/settings/models"
          className="text-xs font-medium text-accent hover:underline"
        >
          {t('ops.modelsLink')}
        </Link>
      </header>

      <form onSubmit={onSearch} className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('ops.searchPlaceholder')}
            className="pl-8"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={loading}>
          {t('ops.search')}
        </Button>
      </form>

      {error ? (
        <p className="rounded-md border border-status-error/30 bg-status-error/8 px-3 py-2 text-sm text-status-error">
          {error}
        </p>
      ) : null}

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 size={16} className="animate-spin" />
          {t('ops.loading')}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-surface px-4 py-3">
              <p className="text-xs font-medium text-text-muted">{t('ops.stats.tenants')}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-text">{data.tenant_count}</p>
            </div>
            <div className="rounded-lg border border-border bg-surface px-4 py-3">
              <p className="text-xs font-medium text-text-muted">{t('ops.stats.users')}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-text">{data.user_count}</p>
            </div>
            <div className="rounded-lg border border-border bg-surface px-4 py-3">
              <p className="text-xs font-medium text-text-muted">{t('ops.stats.supportOn')}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-text">
                {data.tenants.filter((row) => row.support_allowed).length}
                <span className="text-base font-normal text-text-muted">
                  {' / '}
                  {data.tenants.length}
                </span>
              </p>
            </div>
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text">{t('ops.tenantsTitle')}</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-border bg-surface-2 text-xs text-text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('ops.col.workspace')}</th>
                    <th className="px-3 py-2 font-medium">{t('ops.col.members')}</th>
                    <th className="px-3 py-2 font-medium">{t('ops.col.support')}</th>
                    <th className="px-3 py-2 font-medium">{t('ops.col.customModels')}</th>
                    <th className="px-3 py-2 font-medium">{t('ops.col.created')}</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {data.tenants.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-text-muted">
                        {t('ops.emptyTenants')}
                      </td>
                    </tr>
                  ) : (
                    data.tenants.map((tenant) => {
                      const isActive = tenant.id === activeTenantId
                      const locked = !tenant.support_allowed
                      return (
                        <tr key={tenant.id} className="border-b border-border last:border-0">
                          <td className="px-3 py-2.5">
                            <div className="font-medium text-text">{tenant.name}</div>
                            <div className="font-mono text-xs text-text-muted">{tenant.slug}</div>
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-text-muted">{tenant.member_count}</td>
                          <td className="px-3 py-2.5">
                            {locked ? (
                              <span className="inline-flex items-center gap-1 text-text-muted">
                                <Lock size={12} />
                                {t('ops.supportOff')}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-text">
                                <Shield size={12} className="text-accent" />
                                {t('ops.supportOn')}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <label className="inline-flex items-center gap-2 text-xs text-text">
                              <input
                                type="checkbox"
                                checked={tenant.custom_models === true}
                                disabled={featuringId === tenant.id}
                                onChange={(e) => void onToggleCustomModels(tenant, e.target.checked)}
                                className="rounded border-border"
                              />
                              {featuringId === tenant.id ? (
                                <Loader2 size={12} className="animate-spin text-text-muted" />
                              ) : tenant.custom_models ? (
                                t('ops.customModelsOn')
                              ) : (
                                t('ops.customModelsOff')
                              )}
                            </label>
                          </td>
                          <td className="px-3 py-2.5 text-text-muted">
                            {formatWhen(tenant.created_at, i18n.language)}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {isActive ? (
                                <span className="text-xs text-text-muted">{t('ops.current')}</span>
                              ) : (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  disabled={locked || enteringId === tenant.id || deletingId === tenant.id}
                                  onClick={() => void onEnter(tenant.id)}
                                >
                                  {enteringId === tenant.id ? (
                                    <Loader2 size={14} className="animate-spin" />
                                  ) : (
                                    t('ops.enter')
                                  )}
                                </Button>
                              )}
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="text-status-error hover:text-status-error"
                                disabled={deletingId === tenant.id}
                                onClick={() => void onDeleteTenant(tenant)}
                              >
                                {deletingId === tenant.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  t('ops.delete')
                                )}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text">{t('ops.usersTitle')}</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-border bg-surface-2 text-xs text-text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('ops.col.user')}</th>
                    <th className="px-3 py-2 font-medium">{t('ops.col.role')}</th>
                    <th className="px-3 py-2 font-medium">{t('ops.col.memberships')}</th>
                    <th className="px-3 py-2 font-medium">{t('ops.col.created')}</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {data.users.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-text-muted">
                        {t('ops.emptyUsers')}
                      </td>
                    </tr>
                  ) : (
                    data.users.map((row) => {
                      const eligible = (row.memberships ?? []).filter((m) => m.support_allowed)
                      const canImpersonate = !row.is_staff && row.is_active && eligible.length > 0
                      return (
                        <tr key={row.id} className="border-b border-border last:border-0">
                          <td className="px-3 py-2.5">
                            <div className="font-medium text-text">{row.display_name || row.email}</div>
                            {row.display_name ? (
                              <div className="text-xs text-text-muted">{row.email}</div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 text-text-muted">
                            {row.is_staff ? t('ops.staff') : t('ops.customer')}
                            {!row.is_active ? ` · ${t('ops.inactive')}` : ''}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-text-muted">{row.membership_count}</td>
                          <td className="px-3 py-2.5 text-text-muted">
                            {formatWhen(row.created_at, i18n.language)}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {canImpersonate ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={impersonatingId === row.id}
                                onClick={() => void onImpersonate(row)}
                              >
                                {impersonatingId === row.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  t('ops.impersonate')
                                )}
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text">{t('ops.logsTitle')}</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b border-border bg-surface-2 text-xs text-text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('ops.col.when')}</th>
                    <th className="px-3 py-2 font-medium">{t('ops.col.staff')}</th>
                    <th className="px-3 py-2 font-medium">{t('ops.col.workspace')}</th>
                    <th className="px-3 py-2 font-medium">{t('ops.col.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.access_logs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-text-muted">
                        {t('ops.emptyLogs')}
                      </td>
                    </tr>
                  ) : (
                    data.access_logs.map((row) => (
                      <tr key={row.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2.5 text-text-muted">
                          {formatWhen(row.created_at, i18n.language)}
                        </td>
                        <td className="px-3 py-2.5 text-text">{row.staff_email || '—'}</td>
                        <td className="px-3 py-2.5">
                          <div className="text-text">{row.tenant_name || '—'}</div>
                          {row.tenant_slug ? (
                            <div className="font-mono text-xs text-text-muted">{row.tenant_slug}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-text-muted">{row.action}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </PageContent>
  )
}
