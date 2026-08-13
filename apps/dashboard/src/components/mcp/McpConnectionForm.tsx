import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

export type McpConnectPreset = 'custom_mcp' | 'bjorn_lunden_mcp'

type McpConnectionFormProps = {
  presetProvider: McpConnectPreset
  onSaved: () => void
  onCancel?: () => void
  showActions?: boolean
}

export function McpConnectionForm({
  presetProvider,
  onSaved,
  onCancel,
  showActions = true,
}: McpConnectionFormProps) {
  const { t } = useTranslation('nav')
  const provider = presetProvider
  const isCustom = provider === 'custom_mcp'
  const isBjorn = provider === 'bjorn_lunden_mcp'

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [authType, setAuthType] = useState<McpAuthType>('api_key')
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(isBjorn ? 'Bjorn Lunden' : '')
    setUrl('')
    setAuthType('api_key')
    setSecret('')
    setError(null)
    setSaving(false)
  }, [provider, isBjorn])

  // Björn Lundén can be connected without credentials (sandbox until the
  // client signs in); custom servers need name + URL + secret.
  const canSave = isBjorn
    ? true
    : secret.trim().length > 0 && name.trim().length > 0 && url.trim().length > 0

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await installMcpConnection({
        provider,
        api_key: secret.trim(),
        display_name: name.trim() || undefined,
        server_url: url.trim() || undefined,
        auth_type: authType,
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
      <div className="grid gap-2">
        <Label htmlFor="mcp-connection-url">{t('integrations.mcp.servers.url')}</Label>
        <Input
          id="mcp-connection-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={isBjorn ? 'Optional — sandbox is used when empty' : 'https://...'}
        />
      </div>
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
      <div className="grid gap-2">
        <Label htmlFor="mcp-connection-secret">
          {isBjorn
            ? t('integrations.mcp.servers.bjornApiKey')
            : t('integrations.mcp.servers.secret')}
        </Label>
        <Input
          id="mcp-connection-secret"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={isBjorn ? 'Optional until client login is available' : ''}
        />
      </div>
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
