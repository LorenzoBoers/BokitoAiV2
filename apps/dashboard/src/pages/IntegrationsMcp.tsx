import McpSettingsContent from './McpSettingsContent'

/** MCP management under Integrations hub (page title from AppHeader). */
export default function IntegrationsMcp() {
  return (
    <div className="[&_h1]:hidden">
      <McpSettingsContent />
    </div>
  )
}
