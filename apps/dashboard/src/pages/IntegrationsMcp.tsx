import IntegrationsTabs from '../components/shell/IntegrationsTabs'
import McpSettingsContent from './McpSettingsContent'

/** MCP tool servers under the unified Integrations surface. */
export default function IntegrationsMcp() {
  return (
    <div className="[&_h1]:hidden">
      <IntegrationsTabs />
      <McpSettingsContent />
    </div>
  )
}
