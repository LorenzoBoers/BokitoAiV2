import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Integration } from '../../data/integrations-data'
import type { IntegrationProviderRow } from '../../lib/integrations-api'
import { resolveSetupConfig } from '../../lib/integration-setup'
import { IntegrationOAuthSetupPanel } from './setup/IntegrationOAuthSetupPanel'
import { IntegrationMcpSetupPanel } from './setup/IntegrationMcpSetupPanel'
import { Button } from '../ui/button'

type Props = {
  integration: Integration
  provider?: IntegrationProviderRow | null
  onSaved: () => void
  onBack: () => void
}

/** WhatsApp connects via the channel settings card, not an OAuth/MCP dialog. */
function WhatsAppSetupPanel() {
  const { t } = useTranslation('nav')
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">{t('integrations.hub.setup.whatsappBody')}</p>
      <Button asChild size="sm">
        <Link to="/settings/channels#whatsapp">{t('integrations.hub.setup.whatsappOpenSettings')}</Link>
      </Button>
    </div>
  )
}

export function IntegrationSetupPanel({ integration, provider, onSaved, onBack }: Props) {
  const config = resolveSetupConfig(integration, provider)

  if (integration.id === 'whatsapp' || config.platformSlug === 'whatsapp') {
    return <WhatsAppSetupPanel />
  }

  if (config.mode === 'oauth2' || config.mode === 'remote_mcp_oauth') {
    return <IntegrationOAuthSetupPanel integration={integration} config={config} />
  }

  return (
    <IntegrationMcpSetupPanel config={config} onSaved={onSaved} onCancel={onBack} />
  )
}
