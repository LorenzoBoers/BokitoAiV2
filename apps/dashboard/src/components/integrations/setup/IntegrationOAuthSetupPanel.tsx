import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Integration } from '../../../data/integrations-data'
import { useAuth } from '../../../context/AuthContext'
import { buildIntegrationSetupReturnUrl } from '../../../lib/integration-setup-url'
import type { IntegrationSetupConfig } from '../../../lib/integration-setup'
import { resolveRegistryEntry } from '../../../lib/integrations/registry'
import { startProviderOAuth } from '../../../lib/integration-oauth-flow'
import { Button } from '../../ui/button'

type Props = {
  integration: Integration
  config: IntegrationSetupConfig
}

export function IntegrationOAuthSetupPanel({ integration, config }: Props) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const registryEntry = resolveRegistryEntry(integration.id, config.platformSlug)

  const handleContinue = async () => {
    setError(null)
    setLoading(true)
    const returnUrl = buildIntegrationSetupReturnUrl(integration.id)
    try {
      if (!registryEntry?.oauthStrategy) {
        setError(t('integrations.hub.setup.error'))
        return
      }
      const authorizeUrl = await startProviderOAuth(registryEntry, returnUrl, {
        authToken: token,
      })
      window.location.assign(authorizeUrl)
    } catch (e) {
      if (e instanceof Error && e.message === 'LOGIN_REQUIRED') {
        setError(t('integrations.hub.setup.oauthLoginRequired'))
      } else {
        setError(e instanceof Error ? e.message : t('integrations.hub.setup.error'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">{t('integrations.hub.setup.oauthHint')}</p>
      <ul className="text-xs text-text-muted space-y-1.5 list-disc pl-4">
        <li>{t('integrations.hub.setup.oauthStepSignIn', { name: integration.name })}</li>
        <li>{t('integrations.hub.setup.oauthStepReturn')}</li>
      </ul>
      {error ? <p className="text-xs text-status-error">{error}</p> : null}
      <Button className="w-full" disabled={loading} onClick={() => void handleContinue()}>
        {loading
          ? t('integrations.hub.setup.oauthContinuing')
          : t('integrations.hub.setup.oauthContinue')}
      </Button>
    </div>
  )
}
