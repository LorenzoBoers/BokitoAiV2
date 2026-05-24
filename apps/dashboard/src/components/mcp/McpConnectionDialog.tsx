import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { IntegrationHostLogo } from '../integrations/IntegrationHostLogo'
import { useIntegrationBrand } from '../../context/IntegrationBrandContext'
import { installMcpConnection, type McpAuthType } from '../../lib/mcp-integrations'

export type McpConnectPreset = 'custom_mcp' | 'bjorn_lunden_mcp'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  presetProvider?: McpConnectPreset
}

export function McpConnectionDialog({ open, onOpenChange, onSaved, presetProvider }: Props) {
  const { t } = useTranslation('nav')
  const provider = presetProvider ?? 'custom_mcp'
  const isCustom = provider === 'custom_mcp'
  const isBjorn = provider === 'bjorn_lunden_mcp'
  const brand = useIntegrationBrand(provider)

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [authType, setAuthType] = useState<McpAuthType>('api_key')
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setName(isBjorn ? 'Bjorn Lunden' : '')
      setUrl('')
      setAuthType('api_key')
      setSecret('')
      setError(null)
      setSaving(false)
    } else if (isBjorn) {
      setName('Bjorn Lunden')
    }
  }, [open, isBjorn])

  const canSave =
    secret.trim().length > 0 &&
    (isBjorn ? true : name.trim().length > 0 && url.trim().length > 0)

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await installMcpConnection({
        provider,
        api_key: secret.trim(),
        display_name: name.trim() || undefined,
        server_url: isCustom ? url.trim() : undefined,
        auth_type: isCustom ? authType : undefined,
      })
      onSaved()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Install failed')
    } finally {
      setSaving(false)
    }
  }

  const title = isBjorn
    ? t('integrations.mcp.servers.dialogBjornTitle')
    : t('integrations.mcp.servers.addTitle')

  const description = isBjorn
    ? t('integrations.mcp.servers.dialogBjornDescription')
    : t('integrations.mcp.servers.modalDescription')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <IntegrationHostLogo
              logoUrl={brand.logoUrl}
              logoDarkUrl={brand.logoDarkUrl}
              initials={brand.initials}
              color={brand.color}
              name={brand.name}
              hostSlug={brand.hostSlug}
              size="md"
            />
            <div className="min-w-0">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="mcp-connection-name">{t('integrations.mcp.servers.name')}</Label>
            <Input
              id="mcp-connection-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('integrations.mcp.servers.name')}
            />
          </div>
          {isCustom ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="mcp-connection-url">{t('integrations.mcp.servers.url')}</Label>
                <Input
                  id="mcp-connection-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>
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
            </>
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
            />
          </div>
          {error ? <p className="text-xs text-status-error">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t('integrations.mcp.servers.cancel')}
          </Button>
          <Button type="button" disabled={!canSave || saving} onClick={() => void handleSave()}>
            {saving ? t('integrations.mcp.servers.saving') : t('integrations.mcp.servers.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
