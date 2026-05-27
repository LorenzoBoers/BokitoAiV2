import type { Integration } from '../../data/integrations-data'
import type { IntegrationProviderRow } from '../../lib/integrations-api'
import { resolveSetupConfig } from '../../lib/integration-setup'
import { IntegrationOAuthSetupPanel } from './setup/IntegrationOAuthSetupPanel'
import { IntegrationMcpSetupPanel } from './setup/IntegrationMcpSetupPanel'

type Props = {
  integration: Integration
  provider?: IntegrationProviderRow | null
  onSaved: () => void
  onBack: () => void
}

export function IntegrationSetupPanel({ integration, provider, onSaved, onBack }: Props) {
  const config = resolveSetupConfig(integration, provider)

  if (config.mode === 'oauth2') {
    return <IntegrationOAuthSetupPanel integration={integration} config={config} />
  }

  return (
    <IntegrationMcpSetupPanel config={config} onSaved={onSaved} onCancel={onBack} />
  )
}
