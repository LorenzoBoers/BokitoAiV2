import type { IntegrationSetupConfig } from '../../../lib/integration-setup'
import { McpConnectionForm, type McpConnectPreset } from '../../mcp/McpConnectionForm'

type Props = {
  config: IntegrationSetupConfig
  onSaved: () => void
  onCancel: () => void
}

export function IntegrationMcpSetupPanel({ config, onSaved, onCancel }: Props) {
  const preset: McpConnectPreset =
    config.mcpPreset === 'bjorn_lunden_mcp' ? 'bjorn_lunden_mcp' : 'custom_mcp'

  return (
    <McpConnectionForm
      presetProvider={preset}
      onSaved={onSaved}
      onCancel={onCancel}
      showActions
    />
  )
}
