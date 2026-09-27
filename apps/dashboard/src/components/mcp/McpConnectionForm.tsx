import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { installMcpConnection, type McpAuthType } from '../../lib/mcp-integrations'
import { moduleSlugFromPathname } from '../../lib/integration-setup-url'

export type McpConnectPreset =
  | 'custom_mcp'
  | 'bjorn_lunden_mcp'
  | 'king_accountancy'
  | 'alpaca_mcp'

type AdministratieRow = {
  id: string
  name: string
  omgevingscode: string
}

function newAdministratieRow(): AdministratieRow {
  return {
    id: crypto.randomUUID(),
    name: '',
    omgevingscode: '',
  }
}

type McpConnectionFormProps = {
  presetProvider: McpConnectPreset
  /** When set, install uses this provider slug instead of the form preset. */
  installProviderSlug?: string
  defaultName?: string
  defaultServerUrl?: string
  onSaved: () => void
  onCancel?: () => void
  showActions?: boolean
}

export function McpConnectionForm({
  presetProvider,
  installProviderSlug,
  defaultName,
  defaultServerUrl,
  onSaved,
  onCancel,
  showActions = true,
}: McpConnectionFormProps) {
  const { t } = useTranslation('nav')
  const provider = presetProvider
  const isCustom = provider === 'custom_mcp'
  const isBjorn = provider === 'bjorn_lunden_mcp'
  const isKing = provider === 'king_accountancy'
  const isAlpaca = provider === 'alpaca_mcp'

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [authType, setAuthType] = useState<McpAuthType>('api_key')
  const [secret, setSecret] = useState('')
  const [blClientId, setBlClientId] = useState('')
  const [blClientSecret, setBlClientSecret] = useState('')
  const [blCompanyKey, setBlCompanyKey] = useState('')
  const [alpacaKeyId, setAlpacaKeyId] = useState('')
  const [alpacaSecret, setAlpacaSecret] = useState('')
  const [alpacaPaper, setAlpacaPaper] = useState(true)
  const [administraties, setAdministraties] = useState<AdministratieRow[]>([newAdministratieRow()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(
      defaultName ||
        (isKing ? 'KING Accountancy' : isBjorn ? 'Bjorn Lunden' : isAlpaca ? 'Alpaca' : ''),
    )
    setUrl(defaultServerUrl || '')
    setAuthType('api_key')
    setSecret('')
    setBlClientId('')
    setBlClientSecret('')
    setBlCompanyKey('')
    setAlpacaKeyId('')
    setAlpacaSecret('')
    setAlpacaPaper(true)
    setAdministraties([newAdministratieRow()])
    setError(null)
    setSaving(false)
  }, [provider, isBjorn, isKing, isAlpaca, defaultName, defaultServerUrl])

  const kingReady = administraties.some(
    (row) => row.omgevingscode.trim().length > 0 && row.name.trim().length > 0,
  )
  const blReady = blClientId.trim().length > 0 && blClientSecret.trim().length > 0
  const alpacaReady = alpacaKeyId.trim().length > 0 && alpacaSecret.trim().length > 0
  const canSave = isKing
    ? kingReady
    : isBjorn
      ? blReady
      : isAlpaca
        ? alpacaReady
        : secret.trim().length > 0 && name.trim().length > 0 && url.trim().length > 0

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const blAuth = isBjorn
        ? {
            client_id: blClientId.trim(),
            client_secret: blClientSecret.trim(),
            user_key: blCompanyKey.trim() || undefined,
          }
        : undefined
      const kingAuth = isKing
        ? {
            administraties: administraties
              .map((row) => ({
                id: row.id,
                name: row.name.trim(),
                omgevingscode: row.omgevingscode.trim(),
              }))
              .filter((row) => row.omgevingscode.length > 0),
          }
        : undefined
      const alpacaAuth = isAlpaca
        ? {
            api_key_id: alpacaKeyId.trim(),
            api_secret_key: alpacaSecret.trim(),
            paper: alpacaPaper,
            // Same env names as https://github.com/alpacahq/alpaca-mcp-server
            ALPACA_API_KEY: alpacaKeyId.trim(),
            ALPACA_SECRET_KEY: alpacaSecret.trim(),
            ALPACA_PAPER_TRADE: alpacaPaper,
          }
        : undefined
      await installMcpConnection({
        provider: installProviderSlug || provider,
        api_key: isAlpaca
          ? `${alpacaKeyId.trim()}:${alpacaSecret.trim()}`
          : secret.trim(),
        display_name: name.trim() || undefined,
        server_url: url.trim() || undefined,
        auth_type: authType,
        module_slug: moduleSlugFromPathname(window.location.pathname) ?? undefined,
        ...(blAuth ? { auth: blAuth } : {}),
        ...(kingAuth ? { auth: kingAuth } : {}),
        ...(alpacaAuth ? { auth: alpacaAuth } : {}),
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Install failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="mcp-connection-name">{t('integrations.mcp.servers.name')}</Label>
        <Input
          id="mcp-connection-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('integrations.mcp.servers.name')}
        />
      </div>
      {isBjorn || isKing || isAlpaca ? null : (
        <div className="grid gap-2">
          <Label htmlFor="mcp-connection-url">{t('integrations.mcp.servers.url')}</Label>
          <Input
            id="mcp-connection-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
          />
          <p className="text-xs text-text-muted">{t('integrations.mcp.servers.reachabilityHint')}</p>
        </div>
      )}
      {isCustom ? (
        <div className="grid gap-2">
          <Label>{t('integrations.mcp.servers.authType')}</Label>
          <Select value={authType} onValueChange={(v) => setAuthType(v as McpAuthType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="api_key">{t('integrations.mcp.servers.authApiKey')}</SelectItem>
              <SelectItem value="bearer">{t('integrations.mcp.servers.authBearer')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {isKing ? (
        <div className="grid gap-3">
          <p className="text-xs text-text-secondary">{t('integrations.mcp.servers.kingPartnerKeyHint')}</p>
          <div className="flex items-center justify-between gap-2">
            <Label>{t('integrations.mcp.servers.kingAdministraties')}</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() => setAdministraties((rows) => [...rows, newAdministratieRow()])}
            >
              <Plus size={14} />
              {t('integrations.mcp.servers.kingAddAdministratie')}
            </Button>
          </div>
          {administraties.map((row, index) => (
            <div key={row.id} className="grid gap-2 rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-muted">
                  {t('integrations.mcp.servers.kingAdministratieN', { n: index + 1 })}
                </span>
                {administraties.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() =>
                      setAdministraties((rows) => rows.filter((item) => item.id !== row.id))
                    }
                    aria-label={t('integrations.mcp.servers.kingRemoveAdministratie')}
                  >
                    <Trash2 size={14} />
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`king-adm-name-${row.id}`}>
                  {t('integrations.mcp.servers.kingAdministratieName')}
                </Label>
                <Input
                  id={`king-adm-name-${row.id}`}
                  value={row.name}
                  onChange={(e) =>
                    setAdministraties((rows) =>
                      rows.map((item) =>
                        item.id === row.id ? { ...item, name: e.target.value } : item,
                      ),
                    )
                  }
                  placeholder={t('integrations.mcp.servers.kingAdministratieNameHint')}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`king-adm-code-${row.id}`}>
                  {t('integrations.mcp.servers.kingOmgevingscode')}
                </Label>
                <Input
                  id={`king-adm-code-${row.id}`}
                  type="password"
                  value={row.omgevingscode}
                  onChange={(e) =>
                    setAdministraties((rows) =>
                      rows.map((item) =>
                        item.id === row.id ? { ...item, omgevingscode: e.target.value } : item,
                      ),
                    )
                  }
                  placeholder={t('integrations.mcp.servers.kingOmgevingscodeHint')}
                  autoComplete="off"
                />
              </div>
            </div>
          ))}
        </div>
      ) : isBjorn ? (
        <>
          <div className="grid gap-2">
            <Label htmlFor="mcp-bl-client-id">{t('integrations.mcp.servers.bjornClientId')}</Label>
            <Input
              id="mcp-bl-client-id"
              value={blClientId}
              onChange={(e) => setBlClientId(e.target.value)}
              placeholder={t('integrations.mcp.servers.bjornClientIdRequired', {
                defaultValue: 'Required',
              })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mcp-bl-client-secret">
              {t('integrations.mcp.servers.bjornClientSecret')}
            </Label>
            <Input
              id="mcp-bl-client-secret"
              type="password"
              value={blClientSecret}
              onChange={(e) => setBlClientSecret(e.target.value)}
              placeholder={t('integrations.mcp.servers.bjornClientSecretRequired', {
                defaultValue: 'Required',
              })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mcp-bl-company-key">
              {t('integrations.mcp.servers.bjornCompanyKey')}
            </Label>
            <Input
              id="mcp-bl-company-key"
              value={blCompanyKey}
              onChange={(e) => setBlCompanyKey(e.target.value)}
              placeholder={t('integrations.mcp.servers.bjornCompanyKeyHint')}
            />
          </div>
        </>
      ) : isAlpaca ? (
        <>
          <p className="text-xs text-text-secondary">{t('integrations.mcp.servers.alpacaHint')}</p>
          <div className="grid gap-2">
            <Label htmlFor="mcp-alpaca-key-id">{t('integrations.mcp.servers.alpacaApiKey')}</Label>
            <Input
              id="mcp-alpaca-key-id"
              value={alpacaKeyId}
              onChange={(e) => setAlpacaKeyId(e.target.value)}
              placeholder={t('integrations.mcp.servers.alpacaApiKeyHint')}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mcp-alpaca-secret">{t('integrations.mcp.servers.alpacaSecretKey')}</Label>
            <Input
              id="mcp-alpaca-secret"
              type="password"
              value={alpacaSecret}
              onChange={(e) => setAlpacaSecret(e.target.value)}
              placeholder={t('integrations.mcp.servers.alpacaSecretKeyHint')}
              autoComplete="off"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={alpacaPaper}
              onChange={(e) => setAlpacaPaper(e.target.checked)}
              className="rounded border-border"
            />
            {t('integrations.mcp.servers.alpacaPaper')}
          </label>
        </>
      ) : (
        <div className="grid gap-2">
          <Label htmlFor="mcp-connection-secret">{t('integrations.mcp.servers.secret')}</Label>
          <Input
            id="mcp-connection-secret"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </div>
      )}
      {error ? <p className="text-xs text-status-error">{error}</p> : null}
      {showActions ? (
        <div className="flex justify-end gap-2 pt-1">
          {onCancel ? (
            <Button type="button" variant="secondary" onClick={onCancel}>
              {t('integrations.mcp.servers.cancel')}
            </Button>
          ) : null}
          <Button type="button" disabled={!canSave || saving} onClick={() => void handleSave()}>
            {saving ? t('integrations.mcp.servers.saving') : t('integrations.mcp.servers.save')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
