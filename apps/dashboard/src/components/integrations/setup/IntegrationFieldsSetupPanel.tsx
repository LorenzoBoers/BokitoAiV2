import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { Label } from '../../ui/label'
import { formatApiErrorMessage } from '../../ui/ApiErrorBanner'
import { installMcpIntegration, type IntegrationProviderRow } from '../../../lib/integrations-api'
import { moduleSlugFromPathname } from '../../../lib/integration-setup-url'

type Props = {
  provider: IntegrationProviderRow
  onSaved: () => void
  onCancel: () => void
}

/** A preset connection: the fields the API lists; the server builds the URL and auth. */
export function IntegrationFieldsSetupPanel({ provider, onSaved, onCancel }: Props) {
  const { t, i18n } = useTranslation('nav')
  const fields = provider.fields ?? []
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dutch = i18n.language.startsWith('nl')
  const ready = fields.every((f) => !f.required || (values[f.key] ?? '').trim().length > 0)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await installMcpIntegration({
        provider: provider.slug,
        api_key: '',
        display_name: provider.name,
        fields: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])),
        module_slug: moduleSlugFromPathname(window.location.pathname) ?? undefined,
      })
      onSaved()
    } catch (err) {
      setError(formatApiErrorMessage(err, t('integrations.mcp.servers.save')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-4" data-testid="integration-fields-setup">
      {fields.map((field) => (
        <div key={field.key} className="grid gap-2">
          <Label htmlFor={`preset-${field.key}`}>{dutch ? field.label_nl : field.label}</Label>
          <Input
            id={`preset-${field.key}`}
            type={field.secret ? 'password' : 'text'}
            value={values[field.key] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            placeholder={field.placeholder}
            autoComplete="off"
          />
        </div>
      ))}
      {error ? <p className="text-xs text-status-error">{error}</p> : null}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('integrations.mcp.servers.cancel')}
        </Button>
        <Button type="button" disabled={!ready || saving} onClick={() => void save()}>
          {saving ? t('integrations.mcp.servers.saving') : t('integrations.mcp.servers.save')}
        </Button>
      </div>
    </div>
  )
}
