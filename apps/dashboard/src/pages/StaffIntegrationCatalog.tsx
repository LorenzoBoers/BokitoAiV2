import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import ContentHeader from '../components/shell/ContentHeader'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import { useConfirm } from '../components/ui/confirm-dialog'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import {
  createCatalogHost,
  createCatalogProvider,
  deleteCatalogProvider,
  listCatalogHosts,
  listCatalogProviders,
  patchCatalogProvider,
  type CatalogHostRow,
  type CatalogProviderRow,
} from '../lib/staff-integration-catalog-api'

export default function StaffIntegrationCatalog() {
  const { t } = useTranslation('nav')
  const confirm = useConfirm()
  const { isStaff } = useAuth()
  const [hosts, setHosts] = useState<CatalogHostRow[]>([])
  const [providers, setProviders] = useState<CatalogProviderRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [hostSlug, setHostSlug] = useState('custom')
  const [url, setUrl] = useState('')
  const [authType, setAuthType] = useState('mcp_remote_oauth')
  const [status, setStatus] = useState('available')
  const [newHostSlug, setNewHostSlug] = useState('')
  const [newHostName, setNewHostName] = useState('')

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const [h, p] = await Promise.all([listCatalogHosts(), listCatalogProviders()])
      setHosts(h)
      setProviders(p)
      if (h.length && !h.some((row) => row.slug === hostSlug)) {
        setHostSlug(h[0]?.slug || 'custom')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load catalog')
    }
  }, [hostSlug])

  useEffect(() => {
    if (isStaff) void refresh()
  }, [isStaff, refresh])

  if (!isStaff) {
    return <Navigate to="/connections/marketplace" replace />
  }

  const handleCreateHost = async () => {
    if (!newHostSlug.trim() || !newHostName.trim()) return
    setSaving(true)
    setError(null)
    try {
      await createCatalogHost({
        slug: newHostSlug.trim(),
        name: newHostName.trim(),
        brand_color: '#475569',
        initials: newHostSlug.trim().slice(0, 2).toUpperCase(),
      })
      setNewHostSlug('')
      setNewHostName('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Host create failed')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateProvider = async () => {
    if (!slug.trim() || !name.trim() || !hostSlug.trim()) return
    setSaving(true)
    setError(null)
    try {
      await createCatalogProvider({
        slug: slug.trim(),
        name: name.trim(),
        host_slug: hostSlug,
        static_id: slug.trim(),
        auth_type: authType,
        mcp_remote_url: url.trim(),
        status,
        mcp_transport: 'streamable_http',
        category: 'Productivity',
        category_nl: 'Productiviteit',
        enabled: true,
      })
      setSlug('')
      setName('')
      setUrl('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Provider create failed')
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (row: CatalogProviderRow) => {
    setError(null)
    try {
      await patchCatalogProvider(row.slug, { enabled: !row.enabled })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    }
  }

  const removeProvider = async (row: CatalogProviderRow) => {
    if (!(await confirm({ description: `Delete ${row.slug}?`, destructive: true }))) return
    setError(null)
    try {
      await deleteCatalogProvider(row.slug)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <PageContent width="xl" className="space-y-8">
      <ContentHeader
        title={t('integrations.staffCatalog.title', {
          defaultValue: 'MCP marketplace catalog',
        })}
        subtitle={t('integrations.staffCatalog.description', {
          defaultValue:
            'Staff-only. Add remote MCP apps (URL + OAuth or API key). Changes appear on Marketplace without a deploy. Native adapters stay in code.',
        })}
      />
      {error ? <p className="text-sm text-status-error">{error}</p> : null}

        <section className="panel space-y-3 p-4">
          <h2 className="text-sm font-semibold text-text-heading">
            {t('integrations.staffCatalog.addHost', { defaultValue: 'Add host' })}
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>Slug</Label>
              <Input value={newHostSlug} onChange={(e) => setNewHostSlug(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input value={newHostName} onChange={(e) => setNewHostName(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button type="button" disabled={saving} onClick={() => void handleCreateHost()}>
                {t('integrations.staffCatalog.saveHost', { defaultValue: 'Save host' })}
              </Button>
            </div>
          </div>
        </section>

        <section className="panel space-y-3 p-4">
          <h2 className="text-sm font-semibold text-text-heading">
            {t('integrations.staffCatalog.addProvider', { defaultValue: 'Add remote MCP provider' })}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Slug</Label>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="acme_mcp"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme" />
            </div>
            <div className="grid gap-1.5">
              <Label>Host</Label>
              <Select value={hostSlug} onValueChange={setHostSlug}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {hosts.map((h) => (
                    <SelectItem key={h.slug} value={h.slug}>
                      {h.name} ({h.slug})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Auth</Label>
              <Select value={authType} onValueChange={setAuthType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mcp_remote_oauth">mcp_remote_oauth</SelectItem>
                  <SelectItem value="api_key">api_key</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>MCP URL</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp.example.com/mcp"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">available</SelectItem>
                  <SelectItem value="coming_soon">coming_soon</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="button" disabled={saving} onClick={() => void handleCreateProvider()}>
                {t('integrations.staffCatalog.saveProvider', { defaultValue: 'Save provider' })}
              </Button>
            </div>
          </div>
        </section>

        <section className="panel space-y-2 p-4">
          <h2 className="text-sm font-semibold text-text-heading">
            {t('integrations.staffCatalog.listTitle', { defaultValue: 'Catalog providers' })}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-text-muted">
                <tr>
                  <th className="py-2 pr-3">Slug</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Auth</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">URL</th>
                  <th className="py-2 pr-3">Enabled</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((row) => (
                  <tr key={row.slug} className="border-t border-border/40">
                    <td className="py-2 pr-3 font-mono text-xs">{row.slug}</td>
                    <td className="py-2 pr-3">{row.name}</td>
                    <td className="py-2 pr-3 text-xs">{row.auth_type}</td>
                    <td className="py-2 pr-3 text-xs">{row.status}</td>
                    <td className="max-w-[220px] truncate-fade py-2 pr-3 text-xs text-text-muted">
                      {row.mcp_remote_url || '—'}
                    </td>
                    <td className="py-2 pr-3 text-xs">{row.enabled ? 'yes' : 'no'}</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => void toggleEnabled(row)}
                        >
                          {row.enabled ? 'Disable' : 'Enable'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => void removeProvider(row)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      </section>
    </PageContent>
  )
}
