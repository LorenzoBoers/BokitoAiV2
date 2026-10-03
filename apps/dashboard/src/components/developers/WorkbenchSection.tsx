import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Hammer } from 'lucide-react'
import { AiToolProviderRow } from './AiToolProviderRow'
import { useAuth } from '../../context/AuthContext'
import { WORKBENCH_PROVIDERS } from '../../lib/ai-tool-providers'
import {
  connectWorkbenchProvider,
  disconnectWorkbenchProvider,
  listWorkbenchConnections,
  workbenchBackendId,
  type WorkbenchConnection,
} from '../../lib/workbench-api'

const DOCS_PATH = '/docs/developers/workbench'

/** Outbound Workbench: connect Cursor, Claude Managed Agents, or Devin. */
export function WorkbenchSection() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [connections, setConnections] = useState<WorkbenchConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState<Record<string, string>>({})
  const [orgId, setOrgId] = useState('')
  const [gitToken, setGitToken] = useState('')

  async function reload() {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      setConnections(await listWorkbenchConnections(token))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when auth token appears
  }, [token])

  function connectionFor(uiId: string): WorkbenchConnection | undefined {
    const backend = workbenchBackendId(uiId)
    if (!backend) return undefined
    return connections.find((c) => c.provider === backend && c.status === 'active')
  }

  async function onConnect(uiId: string) {
    const backend = workbenchBackendId(uiId)
    if (!backend) return
    const key = (apiKey[uiId] || '').trim()
    if (!key) {
      setError(t('developersPage.workbench.connect.keyRequired'))
      return
    }
    setBusy(uiId)
    setError('')
    try {
      if (!token) return
      await connectWorkbenchProvider(token, {
        provider: backend,
        api_key: key,
        org_id: backend === 'devin' ? orgId.trim() || undefined : undefined,
        git_token: backend === 'claude_managed' ? gitToken.trim() || undefined : undefined,
      })
      setApiKey((prev) => ({ ...prev, [uiId]: '' }))
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function onDisconnect(uiId: string) {
    const conn = connectionFor(uiId)
    if (!conn) return
    setBusy(uiId)
    setError('')
    try {
      if (!token) return
      await disconnectWorkbenchProvider(token, conn.id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section id="workbench" data-testid="workbench-providers">
      <h2 className="flex items-center gap-1.5 text-lg font-semibold text-text-heading">
        <Hammer size={15} className="text-text-muted" />
        {t('developersPage.workbench.title')}
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-text-secondary">{t('developersPage.workbench.body')}</p>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      <div className="mt-4 space-y-2">
        {WORKBENCH_PROVIDERS.map((provider) => {
          const base = `developersPage.workbench.providers.${provider.id}`
          const backend = workbenchBackendId(provider.id)
          const conn = connectionFor(provider.id)
          const connectable = provider.phase === 1 && Boolean(backend)
          const tone = conn ? 'connected' : connectable ? 'available' : 'muted'
          const status = conn
            ? t('developersPage.workbench.connected')
            : connectable
              ? t('developersPage.workbench.connectable')
              : t('developersPage.workbench.notYet')

          return (
            <AiToolProviderRow
              key={provider.id}
              brand={provider.brand}
              name={t(`${base}.name`)}
              description={t(`${base}.description`)}
              status={loading ? t('developersPage.workbench.loading') : status}
              tone={tone}
              testId={`workbench-${provider.id}`}
            >
              <p className="text-sm leading-relaxed text-text-secondary">{t(`${base}.body`)}</p>
              <p className="text-xs text-text-muted">
                {t(`developersPage.workbench.phase${provider.phase}`)}
              </p>

              {connectable && !conn ? (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-text-secondary">
                    {t('developersPage.workbench.connect.apiKey')}
                    <input
                      type="password"
                      autoComplete="off"
                      className="mt-1 w-full rounded-md border border-border bg-bg-surface px-3 py-2 text-sm text-text-heading"
                      value={apiKey[provider.id] || ''}
                      onChange={(e) =>
                        setApiKey((prev) => ({ ...prev, [provider.id]: e.target.value }))
                      }
                      data-testid={`workbench-key-${provider.id}`}
                    />
                  </label>
                  {backend === 'devin' ? (
                    <label className="block text-xs font-medium text-text-secondary">
                      {t('developersPage.workbench.connect.orgId')}
                      <input
                        type="text"
                        className="mt-1 w-full rounded-md border border-border bg-bg-surface px-3 py-2 text-sm text-text-heading"
                        value={orgId}
                        onChange={(e) => setOrgId(e.target.value)}
                        data-testid="workbench-org-devin"
                      />
                    </label>
                  ) : null}
                  {backend === 'claude_managed' ? (
                    <label className="block text-xs font-medium text-text-secondary">
                      {t('developersPage.workbench.connect.gitToken')}
                      <input
                        type="password"
                        autoComplete="off"
                        className="mt-1 w-full rounded-md border border-border bg-bg-surface px-3 py-2 text-sm text-text-heading"
                        value={gitToken}
                        onChange={(e) => setGitToken(e.target.value)}
                        data-testid="workbench-git-claudeManaged"
                      />
                    </label>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    disabled={busy === provider.id}
                    onClick={() => void onConnect(provider.id)}
                    data-testid={`workbench-connect-${provider.id}`}
                  >
                    {busy === provider.id
                      ? t('developersPage.workbench.connect.saving')
                      : t('developersPage.workbench.connect.submit')}
                  </button>
                </div>
              ) : null}

              {conn ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-xs text-text-muted">
                    {t('developersPage.workbench.connect.activeHint')}
                  </p>
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-surface-hover disabled:opacity-50"
                    disabled={busy === provider.id}
                    onClick={() => void onDisconnect(provider.id)}
                    data-testid={`workbench-disconnect-${provider.id}`}
                  >
                    {t('developersPage.workbench.connect.disconnect')}
                  </button>
                </div>
              ) : null}

              <Link to={DOCS_PATH} className="inline-block text-xs font-medium text-accent hover:underline">
                {t('developersPage.workbench.docsLink')}
              </Link>
            </AiToolProviderRow>
          )
        })}
      </div>
    </section>
  )
}
