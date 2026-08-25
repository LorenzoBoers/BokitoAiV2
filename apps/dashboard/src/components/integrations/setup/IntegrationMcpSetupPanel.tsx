import type { IntegrationSetupConfig } from '../../../lib/integration-setup'
import { McpConnectionForm, type McpConnectPreset } from '../../mcp/McpConnectionForm'

type Props = {
  config: IntegrationSetupConfig
  onSaved: () => void
  onCancel: () => void
}

export function IntegrationMcpSetupPanel({ config, onSaved, onCancel }: Props) {
  const preset: McpConnectPreset =
    config.mcpPreset === 'king_accountancy' || config.mcpPreset === 'bjorn_lunden_mcp'
      ? config.mcpPreset
      : 'custom_mcp'

  return (
    <McpConnectionForm
      presetProvider={preset}
      onSaved={onSaved}
      onCancel={onCancel}
      showActions
    />
  )
}
